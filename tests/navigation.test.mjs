import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, createTestDatabase, createTeam, postgresClient } from './helpers.mjs';

const month = loadTs('src/lib/month.ts');
const navigation = loadTs('src/lib/navigation.ts');
let db;
before(async () => { db = await createTestDatabase(); });
after(async () => { await db?.close(); });

function hrefs(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(child => hrefs(child, result)); return result; }
  if (typeof node.type === 'function' && ['PageHeader','MonthNavigation'].includes(node.type.name)) return hrefs(node.type(node.props), result);
  if (node.props?.href) result.push(node.props.href);
  hrefs(node.props?.children, result);
  return result;
}

test('予定の戻り先はサーバーのタイムゾーンに依存せず日本時間で決める', () => {
  assert.equal(month.getJstDateKey('2026-07-31T15:00:00.000Z'), '2026-08-01');
  assert.equal(month.getJstDateKey('2026-12-31T15:00:00.000Z'), '2027-01-01');
});

test('月の検索範囲はうるう年・年末・最大年でも日本時間の月初を維持する', () => {
  assert.deepEqual(month.getTargetMonthUtcRange('2024-02'), { startIso: '2024-01-31T15:00:00.000Z', endIso: '2024-02-29T15:00:00.000Z' });
  assert.deepEqual(month.getTargetMonthUtcRange('9999-12'), { startIso: '9999-11-30T15:00:00.000Z', endIso: '9999-12-31T15:00:00.000Z' });
  assert.throws(() => month.getTargetMonthUtcRange('0000-01'));
});

test('前後月は4桁年を保持し、範囲外のリンクを判別できる', () => {
  assert.equal(month.getNextTargetMonth('0099-12'), '0100-01');
  assert.equal(month.getPrevTargetMonth('0100-01'), '0099-12');
  assert.equal(month.isValidTargetMonth(month.getPrevTargetMonth('0001-01')), false);
  assert.equal(month.isValidTargetMonth(month.getNextTargetMonth('9999-12')), false);
});

test('旧日別カレンダーURLはYYYY-MMへ変換して指定日と月を維持する', async () => {
  const page = loadTs('src/app/admin/calendar/day/page.tsx', {
    '@/lib/auth': { requireAdmin: async () => ({}) }, '@/lib/month': month,
    'next/navigation': { redirect(url) { throw Error('redirect:' + url); } },
  }).default;
  await assert.rejects(page({ searchParams: Promise.resolve({ year:'2026', month:'8', date:'2026-08-20' }) }), /^Error: redirect:\/admin\/calendar\?month=2026-08&date=2026-08-20$/);
  await assert.rejects(page({ searchParams: Promise.resolve({ year:'2026', month:'08' }) }), /^Error: redirect:\/admin\/calendar\?month=2026-08$/);
  await assert.rejects(page({ searchParams: Promise.resolve({ month:'2026-08' }) }), /^Error: redirect:\/admin\/calendar\?month=2026-08$/);
});

test('予定詳細の管理者・一般会員の戻るリンクは日本時間の予定月に戻る', async () => {
  const t = await createTeam(db);
  const event = (await db.query("insert into calendar_events(group_id,title,start_at) values($1,'月初の予定','2026-07-31T15:00:00Z') returning id", [t.groupId])).rows[0];
  const actor = { id:t.adminId, group_id:t.groupId, name:'QA' };
  const mocks = { 'next/link': () => null, 'next/navigation': { redirect(url) { throw Error('redirect:' + url); } }, '@/lib/auth': { requireAdmin: async()=>actor, requireUser: async()=>actor }, '@/lib/month':month, '@/lib/supabase': { supabase:postgresClient(db) }, '@/components/SubmitButton':()=>null, './AdminAttendanceSelect':()=>null, './actions':{} };
  for (const [source, path] of [['src/app/admin/calendar/[id]/page.tsx','/admin/calendar'], ['src/app/user/calendar/[id]/page.tsx','/user/calendar']]) {
    const page = await loadTs(source, mocks).default({params:Promise.resolve({id:event.id})});
    const back = hrefs(page).filter(url => url.startsWith(path+'?'));
    assert.ok(back.length);
    back.forEach(url => assert.equal(new URL(url,'https://example.test').searchParams.get('month'), '2026-08'));
  }
});

test('予定削除後も削除した予定の月へ戻る', async () => {
  const t = await createTeam(db), event=(await db.query("insert into calendar_events(group_id,title,start_at) values($1,'削除確認','2026-07-31T15:00:00Z') returning id",[t.groupId])).rows[0];
  const actions = loadTs('src/app/admin/calendar/[id]/actions.ts', { '@/lib/auth':{requireAdmin:async()=>({id:t.adminId,group_id:t.groupId})}, '@/lib/month':month, '@/lib/supabase':{supabase:postgresClient(db)}, 'next/cache':{revalidatePath(){}}, 'next/navigation':{redirect(url){throw Error('redirect:'+url);}} });
  const form=new FormData();form.set('id',event.id);
  await assert.rejects(actions.deleteEvent(form), /^Error: redirect:\/admin\/calendar\?month=2026-08$/);
  assert.equal((await db.query('select count(*)::int as n from calendar_events where id=$1',[event.id])).rows[0].n,0);
});

test('会計の全タブが選択月を引き継ぐ', () => {
  const page=loadTs('src/app/admin/accounting/AccountingWorkspaceNav.tsx',{'next/link':()=>null}).default({activeTab:'summary',targetMonth:'2026-08'});
  const urls=hrefs(page);assert.equal(urls.length,5);
  urls.forEach(url=>assert.equal(new URL(url,'https://example.test').searchParams.get('month'),'2026-08'));
});

const visitors = [null, { role:'user' }, { role:'admin' }];
function publicPageMocks(profile) {
  return {
    'next/link':()=>null,
    '@/lib/auth':{getCurrentProfile:async()=>profile},
    '@/lib/navigation':navigation,
    '@/components/AccountActionForm':()=>null,
    '@/components/CodeInput':()=>null,
    '@/components/LogoutButton':()=>null,
    './FeedbackForm':()=>null,
    './RegisterForm':()=>null,
    './actions':{},
  };
}

test('意見・登録・申請完了から、ログイン済み会員は権限別の一覧へ戻る', async () => {
  for (const profile of visitors) {
    const expected = profile?.role === 'admin' ? '/admin' : profile ? '/user' : '/login';
    for (const path of ['feedback', 'register', 'register/thanks']) {
      const page = await loadTs(`src/app/${path}/page.tsx`, publicPageMocks(profile)).default();
      assert.deepEqual(hrefs(page), [expected], `${path}: ${profile?.role || 'guest'}`);
    }
  }
});

test('確認フォームと期限切れ画面はログイン中なら設定へ戻り、有効な設定中に再設定へ誘導しない', async () => {
  for (const profile of visitors) for (const purpose of [null, 'setup', 'verify_email']) {
    const mocks = {
      ...publicPageMocks(profile),
      '@/lib/session':loadTs('src/lib/session.ts'),
      '@/lib/supabase':{supabase:{rpc:async()=>({data:purpose?[{purpose}]:[]})}},
    };
    const page = await loadTs('src/app/account/confirm/page.tsx', mocks).default({searchParams:Promise.resolve({token:'a'.repeat(64)})});
    assert.deepEqual(hrefs(page), profile ? ['/account'] : purpose ? ['/login'] : ['/login','/login/forgot-password']);
  }
});

test('アカウント完了画面は種類にかかわらず現在の認証状態に合う戻り先を表示する', async () => {
  for (const profile of visitors) for (const kind of ['setup','reset','email','email-changed','unknown']) {
    const page = await loadTs('src/app/account/complete/page.tsx', publicPageMocks(profile)).default({searchParams:Promise.resolve({kind})});
    assert.deepEqual(hrefs(page), [profile ? '/account' : '/login']);
  }
});

test('復旧依頼からログイン中の会員は設定へ戻り、未ログインならログインへ戻る', async () => {
  for (const profile of visitors) {
    const page = await loadTs('src/app/login/forgot-password/page.tsx', publicPageMocks(profile)).default();
    assert.deepEqual(hrefs(page), [profile ? '/account' : '/login']);
  }
});

test('ログイン済みでログインURLを開いても再入力を求めず一覧へ移動する', async () => {
  for (const profile of visitors) {
    const page = loadTs('src/app/login/page.tsx', {
      ...publicPageMocks(profile),
      'next/headers':{cookies:async()=>({})},
      'next/navigation':{redirect(url){throw Error('redirect:'+url);}},
      '@/lib/login':{}, '@/lib/session':loadTs('src/lib/session.ts'),
      '@/components/SubmitButton':()=>null,
    }).default;
    if (profile) await assert.rejects(page({}), new RegExp('^Error: redirect:'+(profile.role==='admin'?'/admin':'/user')+'$'));
    else assert.ok(hrefs(await page({})).includes('/register'));
  }
});

test('予定の出欠取得に失敗しても、戻る先は今月ではなく予定の月を維持する', async () => {
  const t = await createTeam(db), client = postgresClient(db);
  const event = (await db.query("insert into calendar_events(group_id,title,start_at) values($1,'取得失敗確認','2026-07-31T15:00:00Z') returning id",[t.groupId])).rows[0];
  const page = loadTs('src/app/admin/calendar/[id]/page.tsx', {
    'next/link':()=>null, 'next/navigation':{redirect(url){throw Error('redirect:'+url);}},
    '@/lib/auth':{requireAdmin:async()=>({id:t.adminId,group_id:t.groupId})},
    '@/lib/month':month,
    '@/lib/supabase':{supabase:{from(table){return table==='event_responses'?{select(){return{eq:async()=>({error:{message:'QA failure'}})};}}:client.from(table);}}},
    '@/components/SubmitButton':()=>null, './AdminAttendanceSelect':()=>null, './actions':{},
  }).default;
  assert.deepEqual(hrefs(await page({params:Promise.resolve({id:event.id})})), ['/admin/calendar?month=2026-08&date=2026-08-01']);
});

test('共通の月送りはカレンダーと会計タブのURLを保ち、範囲外の月を無効にする', () => {
  const MonthNavigation=loadTs('src/components/ui/MonthNavigation.tsx',{'@/components/PendingNavigationButton':()=>null,'@/lib/month':month}).default;
  for(const baseHref of ['/user/calendar','/admin/calendar','/admin/coach-work','/admin/accounting?tab=settings','/admin/accounting?tab=reconciliation']) {
    const nav=MonthNavigation({baseHref,previousMonth:'2026-07',currentMonth:'2026-08',nextMonth:'2026-09'});
    assert.deepEqual(hrefs(nav).map(h=>new URL(h,'https://example.test').searchParams.get('month')),['2026-07','2026-08','2026-09']);
    if(baseHref.includes('tab='))hrefs(nav).forEach(h=>assert.equal(new URL(h,'https://example.test').searchParams.get('tab'),new URL(baseHref,'https://example.test').searchParams.get('tab')));
  }
  const nav=MonthNavigation({baseHref:'/user/calendar',previousMonth:'0000-12',currentMonth:'2026-08',nextMonth:'10000-01'});
  assert.deepEqual(nav.props.children.map(c=>Boolean(c.props.disabled)),[true,false,true]);
});
