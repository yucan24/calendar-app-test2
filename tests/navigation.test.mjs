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

test('ログイン済みでログインURLを開くと両権限とも本人の支払い確認へ移動する', async () => {
  for (const profile of visitors) {
    const page = loadTs('src/app/login/page.tsx', {
      ...publicPageMocks(profile),
      'next/headers':{cookies:async()=>({})},
      'next/navigation':{redirect(url){throw Error('redirect:'+url);}},
      '@/lib/login':{}, '@/lib/session':loadTs('src/lib/session.ts'),
      '@/components/SubmitButton':()=>null,
    }).default;
    if (profile) await assert.rejects(page({}), /^Error: redirect:\/user\/payment-check$/);
    else assert.ok(hrefs(await page({})).includes('/register'));
  }
});

test('アプリの入口は両権限とも支払い確認へ進み、未ログインならログインへ進む', async () => {
  for (const profile of visitors) {
    const page = loadTs('src/app/page.tsx', {
      '@/lib/auth': { getCurrentProfile: async () => profile },
      'next/navigation': { redirect(url) { throw Error('redirect:' + url); } },
    }).default;
    await assert.rejects(page(), profile ? /^Error: redirect:\/user\/payment-check$/ : /^Error: redirect:\/login$/);
  }
});

function textContent(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(' ');
  return textContent(node.props?.children);
}

function paymentPage(actor) {
  return loadTs('src/app/user/payment-check/page.tsx', {
    'next/link': () => null,
    '@/components/LogoutButton': () => null,
    '@/lib/auth': { requireUser: async () => actor },
    '@/lib/supabase': { supabase: postgresClient(db) },
    '@/lib/navigation': navigation,
    '@/lib/month': month,
  }).default;
}

test('管理者も一般会員も本人分だけの未払い・返金・履歴を表示し、権限に合う画面へ進める', async () => {
  for (const role of ['admin', 'user']) {
    const team = await createTeam(db), otherTeam = await createTeam(db);
    await db.query('update profiles set role=$2 where id=$1', [team.adminId, role]);
    const other = (await db.query("insert into profiles(group_id,name,role) values($1,$2,'user') returning id", [team.groupId, `同じチームの別会員-${team.groupId}`])).rows[0];
    const currentMonth = month.getCurrentTargetMonth();
    for (const [groupId, userId, amount, status, title, note] of [
      [team.groupId, team.adminId, 1234, 'unpaid', '本人請求', '本人の未払いメモ'],
      [team.groupId, team.adminId, 432, 'unpaid', '返金', '本人の返金メモ'],
      [team.groupId, team.adminId, 777, 'paid', '本人の支払済み', '本人の支払済みメモ'],
      [team.groupId, team.adminId, 888, 'exempt', '本人の免除', '本人の免除メモ'],
      [team.groupId, other.id, 99998, 'unpaid', '他人の請求', '表示してはいけない同一チームの請求'],
      [otherTeam.groupId, otherTeam.adminId, 99999, 'unpaid', '別チームの請求', '表示してはいけない別チームの請求'],
    ]) await db.query('insert into billing_items(group_id,user_id,target_month,category,title,amount,status,note) values($1,$2,$3,\'trip\',$4,$5,$6,$7)', [groupId, userId, currentMonth, title, amount, status, note]);
    const view = await paymentPage({ id: team.adminId, group_id: team.groupId, role })();
    const text = textContent(view);
    assert.ok(text.includes('未払い合計'));
    assert.ok(text.includes(month.formatYen(1234)));
    assert.ok(text.includes(month.formatYen(432)));
    assert.ok(text.includes('本人の未払いメモ'));
    assert.ok(text.includes('本人の返金メモ'));
    assert.ok(text.includes('本人の支払済みメモ'));
    assert.ok(text.includes('本人の免除メモ'));
    assert.ok(!text.includes('表示してはいけない'));
    assert.ok(!text.includes(month.formatYen(99998)));
    assert.ok(!text.includes(month.formatYen(99999)));
    const urls = hrefs(view);
    assert.ok(urls.includes(role === 'admin' ? '/admin' : '/user'));
    assert.equal(urls.includes('/user/calendar'), role === 'user');
    assert.ok(text.includes(role === 'admin' ? '確認して管理者画面へ進む' : '確認してカレンダーへ進む'));
    const rows = (await db.query('select status,amount from billing_items where user_id=$1 order by amount', [team.adminId])).rows;
    assert.deepEqual(rows, [{ status: 'unpaid', amount: 432 }, { status: 'paid', amount: 777 }, { status: 'exempt', amount: 888 }, { status: 'unpaid', amount: 1234 }]);
  }
});

test('未払いがない場合も管理者・一般会員とも確認画面から次へ進める', async () => {
  for (const role of ['admin', 'user']) {
    const team = await createTeam(db);
    const view = await paymentPage({ id: team.adminId, group_id: team.groupId, role })();
    assert.ok(textContent(view).includes('未払い・未清算項目はありません'));
    assert.ok(hrefs(view).includes(role === 'admin' ? '/admin' : '/user/calendar'));
  }
});

test('管理者の一覧から本人の支払い確認を開き直せる', async () => {
  const page = loadTs('src/app/admin/page.tsx', {
    '@/lib/auth': { requireAdmin: async () => ({ name: '管理者' }) },
    '@/components/LogoutButton': () => null,
    'next/link': () => null,
  }).default;
  const view = await page();
  assert.ok(hrefs(view).includes('/user/payment-check'));
  assert.ok(hrefs(view).includes('/admin/coach-work'));
  assert.ok(textContent(view).includes('支払い確認'));
});

test('未ログインで支払い確認を開いても請求を読み取らずログインへ戻す', async () => {
  const page = loadTs('src/app/user/payment-check/page.tsx', {
    '@/lib/auth': { requireUser: async () => { throw Error('redirect:/login'); } },
    '@/lib/supabase': { supabase: { from() { assert.fail('認証前に請求を読んではいけない'); } } },
    '@/components/LogoutButton': () => null,
    'next/link': () => null,
  }).default;
  await assert.rejects(page(), /^Error: redirect:\/login$/);
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
