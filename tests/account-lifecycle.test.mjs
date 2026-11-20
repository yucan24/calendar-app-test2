import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createTestDatabase, createTeam, loadTs, postgresClient, importTransactions, transactionId } from './helpers.mjs';
let db, legacy;
const policy=loadTs('src/lib/accountPolicy.ts'), session=loadTs('src/lib/session.ts');
const hash=value=>createHash('sha256').update(value).digest('hex');
const form=values=>{const f=new FormData();for(const[k,v]of Object.entries(values))f.set(k,v);return f;};
const initial={ok:false,message:''};
before(async()=>{db=await createTestDatabase(async d=>{
 const g=(await d.query("insert into groups(name) values('legacy') returning id")).rows[0].id;
 legacy=(await d.query("insert into profiles(group_id,name,email,role,login_code,login_enabled) values($1,'legacy-pin','legacy@example.test','admin','0012',true) returning *",[g])).rows[0];
 await d.query("insert into profiles(group_id,name,login_code,login_enabled) values($1,'legacy-disabled','0099',false)",[g]);
});});
after(async()=>db?.close());
async function member(team, patch={}) {
 const defaults={group_id:team.groupId,name:'account-'+randomBytes(8).toString('hex'),email:'member@example.test',role:'user',login_code:'1234',login_enabled:true,...patch};
 const c=Object.keys(defaults);return(await db.query(`insert into profiles(${c.join(',')}) values(${c.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(defaults))).rows[0];
}
async function issue(m,purpose='verify_email',actor=m.id,email=m.email) {
 const raw=randomBytes(32).toString('hex'), tokenHash=hash(raw);
 await db.query('select * from issue_app_account_token($1,$2,$3,$4,$5)',[m.id,purpose,tokenHash,email,actor]);
 return{raw,hash:tokenHash};
}
async function signIn(m,code='1234') {
 const h=hash(randomBytes(32).toString('hex'));
 const r=(await db.query('select * from authenticate_app_session($1,$2,$3)',[m.name,code,h])).rows[0];
 return{...r,hash:h};
}
function actions(actor,{failMail=false}={}) {
 const mails=[], client=postgresClient(db);
 const originalRpc=client.rpc.bind(client);
 client.rpc=async(name,args)=>{const result=await originalRpc(name,args);return name==='consume_app_account_token'&&!result.error?{...result,data:result.data[0]?.consume_app_account_token}:result;};
 const mocks={'server-only':{},'next/cache':{revalidatePath(){}},'next/navigation':{redirect:url=>{throw Error('redirect:'+url);}},
  '@/lib/supabase':{supabase:client},'@/lib/auth':{requireAdmin:async()=>{if(!actor)throw Error('redirect:/login');if(actor.role!=='admin')throw Error('redirect:/user');return actor;},requireLogin:async()=>actor,endSession:async()=>{}},
  '@/lib/accountPolicy':policy,'@/lib/session':session,'@/lib/authRateLimit':{allowAuthAttempt:async()=>true},
  '@/lib/accountEmail':{applicationUrl:()=> 'http://localhost:3010',sendAccountEmail:async mail=>{if(failMail)throw Error('SMTP unavailable');mails.push(mail);return 'sent';}}};
 const links=loadTs('src/lib/accountLinks.ts',mocks);mocks['@/lib/accountLinks']=links;
 return{mails,mocks,...links,...loadTs('src/app/register/actions.ts',mocks),...loadTs('src/app/admin/members/actions.ts',mocks),...loadTs('src/app/account/actions.ts',mocks),...loadTs('src/app/account/confirm/actions.ts',mocks),...loadTs('src/app/login/forgot-password/actions.ts',mocks)};
}
test('移行で既存の4桁・先頭0・会員ID・業務列を維持し、平文を除去する',async()=>{
 const m=(await db.query('select * from profiles where id=$1',[legacy.id])).rows[0];
 assert.equal(m.login_code,null);assert.match(m.login_code_hash,/^\$2a\$10\$/);
 for(const k of ['id','name','email','role','group_id','created_at','updated_at'])assert.deepEqual(m[k],legacy[k],k);
 assert.equal((await signIn(m,'0012')).outcome,'authenticated');
 assert.equal((await signIn(m,'0013')).outcome,'failed');
 assert.equal((await db.query("select account_status from profiles where name='legacy-disabled'")).rows[0].account_status,'review');
});
test('同じ4桁も異なるsaltになり、登録・変更後の平文は常にNULL',async()=>{
 const t=await createTeam(db),a=await member(t),b=await member(t);
 assert.notEqual(a.login_code_hash,b.login_code_hash);assert.equal(a.login_code,null);
 await db.query("select change_app_account($1,'1234',null,'0007')",[a.id]);
 assert.equal((await signIn(a,'1234')).outcome,'failed');assert.equal((await signIn(a,'0007')).outcome,'authenticated');
 assert.equal((await db.query('select login_code from profiles where id=$1',[a.id])).rows[0].login_code,null);
});
test('新規申請→管理者への自動通知→承認→初期設定メール→本人設定→ログイン',async()=>{
 const t=await createTeam(db),admin=(await db.query('select * from profiles where id=$1',[t.adminId])).rows[0],a=actions(admin),old=process.env.APP_GROUP_ID;
 process.env.APP_GROUP_ID=t.groupId;
 try{
  const name='new-'+t.groupId;
  await assert.rejects(a.registerMember(initial,form({name,email:'new@example.test',role:'admin',login_code:'9999',group_id:'forged'})),/^Error: redirect:\/register\/thanks$/);
  const m=(await db.query('select * from profiles where name=$1',[name])).rows[0];
  assert.equal(m.account_status,'pending');assert.equal(m.login_code_hash,null);assert.equal(m.role,'user');
  assert.equal(a.mails.length,1);assert.match(a.mails[0].subject,/申請/);
  assert.equal((await a.manageMember(initial,form({member_id:m.id,intent:'approve'}))).ok,true);
  assert.equal((await signIn(m,'9999')).outcome,'failed');
  const token=/token=([a-f0-9]{64})/.exec(a.mails[1].text)[1];
  await assert.rejects(a.confirmAccountLink(initial,form({token,new_code:'0003',confirmation:'0003'})),/^Error: redirect:\/account\/complete\?kind=setup$/);
  assert.equal((await signIn(m,'0003')).outcome,'authenticated');
  const updated=(await db.query('select * from profiles where id=$1',[m.id])).rows[0];
  assert.ok(updated.email_verified_at);assert.equal(updated.account_status,'active');
 }finally{if(old===undefined)delete process.env.APP_GROUP_ID;else process.env.APP_GROUP_ID=old;}
});
test('メール送信失敗でも申請・初期設定待ちを保持し、失敗表示と再送で復旧する',async()=>{
 const t=await createTeam(db),admin=(await db.query('select * from profiles where id=$1',[t.adminId])).rows[0];
 const m=await member(t,{login_code:null,login_enabled:false});
 const failed=actions(admin,{failMail:true});assert.equal((await failed.manageMember(initial,form({member_id:m.id,intent:'approve'}))).ok,false);
 assert.equal((await db.query('select account_status from profiles where id=$1',[m.id])).rows[0].account_status,'invited');
 assert.equal((await db.query('select delivery_status from app_account_notifications where profile_id=$1',[m.id])).rows[0].delivery_status,'failed');
 const retried=actions(admin);assert.equal((await retried.sendMemberMail(initial,form({member_id:m.id,intent:'retry_email'}))).ok,true);assert.equal(retried.mails.length,1);
});
test('会員一覧の承認・再送・削除は一覧全体へ操作結果を返す',async()=>{
 const t=await createTeam(db),admin=(await db.query('select * from profiles where id=$1',[t.adminId])).rows[0],m=await member(t,{login_code:null,login_enabled:false}),a=actions(admin);
 const approved=await a.performMemberAction(initial,form({operation:'manage',member_id:m.id,intent:'approve'}));
 assert.equal(approved.ok,true);assert.equal(approved.memberId,m.id);assert.match(approved.message,/承認しました/);assert.equal(a.mails.length,1);
 const resent=await a.performMemberAction(initial,form({operation:'mail',member_id:m.id,intent:'reset_email'}));
 assert.equal(resent.ok,true);assert.equal(a.mails.length,2);
 const deleted=await a.performMemberAction(initial,form({operation:'manage',member_id:m.id,intent:'delete',confirm_name:m.name}));
 assert.equal(deleted.ok,true);assert.match(deleted.message,/完全削除/);assert.equal(deleted.memberId,m.id);
 assert.equal((await db.query('select id from profiles where id=$1',[m.id])).rows.length,0);
});
test('承認済みでメールが失敗した場合も、保存された状態と送信失敗を一覧へ返す',async()=>{
 const t=await createTeam(db),admin=(await db.query('select * from profiles where id=$1',[t.adminId])).rows[0],m=await member(t,{login_code:null,login_enabled:false}),a=actions(admin,{failMail:true});
 const result=await a.performMemberAction(initial,form({operation:'manage',member_id:m.id,intent:'approve'}));
 assert.equal(result.ok,false);assert.equal(result.memberId,m.id);assert.match(result.message,/承認しました/);assert.match(result.message,/送信に失敗/);
 assert.equal((await db.query('select account_status from profiles where id=$1',[m.id])).rows[0].account_status,'invited');
});
test('会員管理から管理者自身の改名は行わず、セッションと名前を維持する',async()=>{
 const t=await createTeam(db),admin=(await db.query('select * from profiles where id=$1',[t.adminId])).rows[0],a=actions(admin);
 await db.query("update profiles set login_code='1234',email='admin@example.test' where id=$1",[admin.id]);
 const signed=await signIn(admin);
 const result=await a.performMemberAction(initial,form({operation:'profile',member_id:admin.id,name:'changed-admin',email:'admin@example.test'}));
 assert.equal(result.ok,false);assert.match(result.message,/アカウント設定/);
 assert.equal((await db.query('select name from profiles where id=$1',[admin.id])).rows[0].name,admin.name);
 assert.equal((await db.query('select * from get_app_session_profile($1)',[signed.hash])).rows.length,1);
});
test('会員一覧の共通送信先も未ログイン・一般会員の操作を拒否する',async()=>{
 const t=await createTeam(db),m=await member(t);
 const input=form({operation:'manage',member_id:m.id,intent:'delete',confirm_name:m.name});
 await assert.rejects(actions(null).performMemberAction(initial,input),/^Error: redirect:\/login$/);
 await assert.rejects(actions(m).performMemberAction(initial,input),/^Error: redirect:\/user$/);
 assert.equal((await db.query('select account_status from profiles where id=$1',[m.id])).rows[0].account_status,'active');
});
test('確認成功時は用途に合った完了ページへ転送し、同じリンクの再使用は拒否する',async()=>{
 const t=await createTeam(db),m=await member(t),a=actions(m);
 const verify=await issue(m);
 await assert.rejects(a.confirmAccountLink(initial,form({token:verify.raw})),/^Error: redirect:\/account\/complete\?kind=email$/);
 const reused=await a.confirmAccountLink(initial,form({token:verify.raw}));assert.equal(reused.ok,false);
 const change=await issue(m,'email_change',m.id,'new@example.test');
 await assert.rejects(a.confirmAccountLink(initial,form({token:change.raw})),/^Error: redirect:\/account\/complete\?kind=email-changed$/);
});
test('既存メールは未確認のまま復旧に使わず、確認リンクを押した時点で有効にする',async()=>{
 const t=await createTeam(db),m=await member(t),a=actions(m),previous=process.env.APP_GROUP_ID;process.env.APP_GROUP_ID=t.groupId;
 try{
  const input=form({name:m.name,email:m.email});const noMail=await a.requestAccountRecovery(initial,input);
  assert.equal(noMail.ok,true);assert.equal(a.mails.length,0);
  const token=await issue(m);const inspect=await db.query('select * from inspect_app_account_token($1)',[token.hash]);
  assert.equal(inspect.rows.length,1);assert.equal((await db.query('select consumed_at from app_account_tokens where token_hash=$1',[token.hash])).rows[0].consumed_at,null);
  await db.query('select consume_app_account_token($1)',[token.hash]);
  const sent=await a.requestAccountRecovery(initial,input);assert.equal(sent.message,noMail.message);assert.equal(a.mails.length,1);
 }finally{if(previous===undefined)delete process.env.APP_GROUP_ID;else process.env.APP_GROUP_ID=previous;}
});
test('復旧は名前＋メールで本人を特定し、共用メールでも別会員を変更しない',async()=>{
 const t=await createTeam(db),a=await member(t,{email_verified_at:new Date().toISOString()}),b=await member(t,{email_verified_at:new Date().toISOString()}),h=actions(a),old=process.env.APP_GROUP_ID;process.env.APP_GROUP_ID=t.groupId;
 try{
  const accepted=await h.requestAccountRecovery(initial,form({name:a.name,email:a.email}));
  const unknown=await h.requestAccountRecovery(initial,form({name:'unknown',email:a.email}));assert.equal(accepted.message,unknown.message);
  assert.equal(h.mails.length,1);const raw=/token=([a-f0-9]{64})/.exec(h.mails[0].text)[1];
  assert.equal((await h.confirmAccountLink(initial,form({token:raw,new_code:'5555',confirmation:'5554'}))).ok,false);
  await assert.rejects(h.confirmAccountLink(initial,form({token:raw,new_code:'5555',confirmation:'5555'})),/^Error: redirect:\/account\/complete\?kind=reset$/);
  assert.equal((await signIn(a,'5555')).outcome,'authenticated');assert.equal((await signIn(b,'1234')).outcome,'authenticated');
 }finally{if(old===undefined)delete process.env.APP_GROUP_ID;else process.env.APP_GROUP_ID=old;}
});
test('再設定トークンはハッシュのみを保存し、改ざん・期限切れ・再利用を拒否する',async()=>{
 const t=await createTeam(db),m=await member(t,{email_verified_at:new Date().toISOString()}),token=await issue(m,'reset',null);
 const stored=(await db.query('select * from app_account_tokens where token_hash=$1',[token.hash])).rows[0];
 assert.equal(JSON.stringify(stored).includes(token.raw),false);
 await assert.rejects(db.query("select consume_app_account_token($1,'9999')",[hash(token.raw+'tampered')]));
 await db.query("update app_account_tokens set expires_at=now()-interval '1 second' where id=$1",[stored.id]);
 await assert.rejects(db.query("select consume_app_account_token($1,'9999')",[token.hash]));
 const next=await issue(m,'reset',null);await db.query("select consume_app_account_token($1,'9999')",[next.hash]);
 await assert.rejects(db.query("select consume_app_account_token($1,'8888')",[next.hash]));
});
test('再設定で全セッションを失効し、同時に使った同じリンクは1回だけ成功する',async()=>{
 const t=await createTeam(db),m=await member(t,{email_verified_at:new Date().toISOString()});await signIn(m);await signIn(m);
 const token=await issue(m,'reset',null);
 const results=await Promise.allSettled([db.query("select consume_app_account_token($1,'3333')",[token.hash]),db.query("select consume_app_account_token($1,'4444')",[token.hash])]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await db.query('select count(*)::int as n from app_sessions where profile_id=$1',[m.id])).rows[0].n,0);
});
test('本人の名前・コード変更は現在コードが必要で、名前変更後は新しい名前でログインする',async()=>{
 const t=await createTeam(db),m=await member(t),a=actions(m);await signIn(m);
 assert.equal((await a.changeAccount(initial,form({name:'new-'+m.name,current_code:'0000',new_code:'5678',confirmation:'5678'}))).ok,false);
 await assert.rejects(a.changeAccount(initial,form({name:'new-'+m.name,current_code:'1234',new_code:'5678',confirmation:'5678'})),/redirect:\/login/);
 assert.equal((await signIn(m,'1234')).outcome,'failed');assert.equal((await signIn({...m,name:'new-'+m.name},'5678')).outcome,'authenticated');
});
test('新メールは確認前に書き換えず、確定後に旧リンク・旧セッションを失効する',async()=>{
 const t=await createTeam(db),m=await member(t,{email_verified_at:new Date().toISOString()}),a=actions(m);const signed=await signIn(m);
 const reset=await issue(m,'reset',null);
 assert.equal((await a.requestAccountEmail(initial,form({intent:'change',email:'new-address@example.test',current_code:'1234'}))).ok,true);
 assert.equal((await db.query('select email from profiles where id=$1',[m.id])).rows[0].email,m.email);
 const raw=/token=([a-f0-9]{64})/.exec(a.mails[0].text)[1];
 await db.query('select consume_app_account_token($1)',[hash(raw)]);
 const updated=(await db.query('select email,email_verified_at from profiles where id=$1',[m.id])).rows[0];assert.equal(updated.email,'new-address@example.test');assert.ok(updated.email_verified_at);
 assert.equal((await db.query('select * from get_app_session_profile($1)',[signed.hash])).rows.length,0);
 await assert.rejects(db.query("select consume_app_account_token($1,'7777')",[reset.hash]));
});
test('管理者も現在コードを閲覧・直接書換えできず、不正メールを拒否する',async()=>{
 const t=await createTeam(db),admin=(await db.query('select * from profiles where id=$1',[t.adminId])).rows[0],m=await member(t),a=actions(admin);
 assert.equal((await a.updateMemberProfile(initial,form({member_id:m.id,name:m.name,email:'invalid',login_code:'9999'}))).ok,false);
 assert.equal((await a.updateMemberProfile(initial,form({member_id:m.id,name:m.name,email:m.email,login_code:'9999'}))).ok,true);
 assert.equal((await signIn(m,'1234')).outcome,'authenticated');assert.equal((await signIn(m,'9999')).outcome,'failed');
});
test('本人確認後の管理者復旧はメール確認済みと偽らず、コードだけを再設定する',async()=>{
 const t=await createTeam(db),admin=(await db.query('select * from profiles where id=$1',[t.adminId])).rows[0],m=await member(t,{email:''}),a=actions(admin);
 assert.equal((await a.sendMemberMail(initial,form({member_id:m.id,intent:'manual_reset'}))).ok,false);
 const r=await a.sendMemberMail(initial,form({member_id:m.id,intent:'manual_reset',identity_confirmed:'on'}));assert.equal(r.ok,true);assert.equal(a.mails.length,0);
 const raw=new URL(r.url).searchParams.get('token');await db.query("select consume_app_account_token($1,'0088')",[hash(raw)]);
 assert.equal((await db.query('select email_verified_at from profiles where id=$1',[m.id])).rows[0].email_verified_at,null);
 assert.equal((await signIn(m,'0088')).outcome,'authenticated');
});
test('停止→再開で初期設定待ちを維持し、停止中はリンク・ログインを拒否する',async()=>{
 const t=await createTeam(db),m=await member(t,{login_code:null,login_enabled:false});
 await db.query("select * from manage_app_member($1,$2,'approve')",[t.adminId,m.id]);
 const token=await issue({...m,account_status:'invited'},'setup',t.adminId);
 await db.query("select * from manage_app_member($1,$2,'suspend')",[t.adminId,m.id]);
 await assert.rejects(db.query("select consume_app_account_token($1,'1111')",[token.hash]));
 await db.query("select * from manage_app_member($1,$2,'resume')",[t.adminId,m.id]);
 assert.equal((await db.query('select account_status from profiles where id=$1',[m.id])).rows[0].account_status,'invited');
});
test('他チーム・一般会員・自分自身の停止/降格/削除と偽造した復旧発行を拒否',async()=>{
 const t=await createTeam(db),other=await createTeam(db),m=await member(t);
 for(const action of ['suspend','role_user','delete'])await assert.rejects(db.query('select * from manage_app_member($1,$2,$3)',[t.adminId,t.adminId,action]));
 await assert.rejects(db.query("select * from manage_app_member($1,$2,'delete')",[other.adminId,m.id]));
 await assert.rejects(db.query("select * from manage_app_member($1,$2,'delete')",[m.id,t.adminId]));
 await assert.rejects(issue(m,'admin_reset',other.adminId));
});
test('履歴のない誤登録は完全削除し、同じ名前で申請し直せる',async()=>{
 const t=await createTeam(db),m=await member(t,{login_enabled:false});
 const result=(await db.query("select * from manage_app_member($1,$2,'delete')",[t.adminId,m.id])).rows[0];
 assert.equal(result.outcome_mode,'permanent');assert.equal((await db.query('select * from profiles where id=$1',[m.id])).rows.length,0);
 await member(t,{name:m.name});
});
test('削除前の会員名確認を必須にし、無関係な会員・データを変更しない',async()=>{
 const t=await createTeam(db),admin=(await db.query('select * from profiles where id=$1',[t.adminId])).rows[0],m=await member(t),a=actions(admin);
 assert.equal((await a.manageMember(initial,form({member_id:m.id,intent:'delete',confirm_name:'wrong'}))).ok,false);
 assert.equal((await db.query('select account_status from profiles where id=$1',[m.id])).rows[0].account_status,'active');
});
test('履歴のある会員を停止・降格・削除しても報酬・請求・立替を維持し精算できる',async()=>{
 const t=await createTeam(db),coach=await member(t,{role:'admin',coach_hourly_rate:1000});
 await db.query("insert into coach_work_logs(group_id,coach_id,work_date,coaching_minutes,travel_expense) values($1,$2,'2026-11-01',90,100)",[t.groupId,coach.id]);
 await db.query("insert into billing_items(group_id,user_id,target_month,category,title,amount,status) values($1,$2,'2026-11','tuition','月謝',200,'paid')",[t.groupId,coach.id]);
 const mocks={'@/lib/supabase':{supabase:postgresClient(db)},'@/lib/accounting':loadTs('src/lib/accounting.ts'),'@/lib/month':loadTs('src/lib/month.ts'),'@/lib/pagination':loadTs('src/lib/pagination.ts')};
 const payment=loadTs('src/app/admin/bank-reconciliation/paymentReport.ts',mocks);
 const report=()=>payment.buildMonthlyVirtualPaymentReport({id:t.adminId,group_id:t.groupId},'2026-11');
 const before=(await report()).totals;
 await db.query("select * from manage_app_member($1,$2,'suspend')",[t.adminId,coach.id]);assert.deepEqual((await report()).totals,before);
 await db.query("select * from manage_app_member($1,$2,'role_user')",[t.adminId,coach.id]);assert.deepEqual((await report()).totals,before);
 await db.query("select * from manage_app_member($1,$2,'delete')",[t.adminId,coach.id]);assert.deepEqual((await report()).totals,before);
 const deleted=(await db.query('select * from profiles where id=$1',[coach.id])).rows[0];assert.equal(deleted.account_status,'deleted');assert.equal(deleted.login_code_hash,null);assert.equal(deleted.email,'');
 assert.equal((await signIn(coach)).outcome,'failed');
 await assert.rejects(db.query("update profiles set login_enabled=true where id=$1",[coach.id]));
 await importTransactions(db,t,[{bankTransactionId:'archived-pay',withdrawalAmount:1447}]);const id=await transactionId(db,t,'archived-pay');
 await db.query("select match_bank_transaction_virtual_payment($1,$2,'coach_net_pay',$3,'2026-11',1447,null)",[t.adminId,id,coach.id]);
});
test('作成者参照だけでも完全削除せず予定の履歴を保持する',async()=>{
 const t=await createTeam(db),m=await member(t);
 const event=(await db.query("insert into calendar_events(group_id,created_by,title,start_at) values($1,$2,'history',now()) returning *",[t.groupId,m.id])).rows[0];
 assert.equal((await db.query("select * from manage_app_member($1,$2,'delete')",[t.adminId,m.id])).rows[0].outcome_mode,'history_preserved');
 assert.deepEqual((await db.query('select * from calendar_events where id=$1',[event.id])).rows[0],event);
});
test('公開ロールはコードハッシュ・復旧トークン・管理用RPCへアクセスできない',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  try{
   for(const table of ['profiles','app_account_tokens','app_account_notifications'])await assert.rejects(db.query('select * from '+table),/permission denied/);
   await assert.rejects(db.query("select consume_app_account_token($1,'1234')",['a'.repeat(64)]),/permission denied/);
   await assert.rejects(db.query('select * from manage_app_member($1,$2,$3)',[legacy.id,legacy.id,'delete']),/permission denied/);
  }finally{await db.exec('reset role');}
 }
});

test('管理者が同時に相互降格しても有効な管理者を1人残す',async()=>{
 const t=await createTeam(db),second=await member(t,{role:'admin'});
 const results=await Promise.allSettled([db.query("select * from manage_app_member($1,$2,'role_user')",[t.adminId,second.id]),db.query("select * from manage_app_member($1,$2,'role_user')",[second.id,t.adminId])]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await db.query("select count(*)::int as n from profiles where group_id=$1 and role='admin' and login_enabled",[t.groupId])).rows[0].n,1);
});
test('停止・削除した会員への新規請求と勤務追加を拒否し、過去勤務の修正は維持する',async()=>{
 const t=await createTeam(db),coach=await member(t,{role:'admin'}),admin={id:t.adminId,group_id:t.groupId,role:'admin'},a=actions(admin);
 const work=loadTs('src/app/admin/coach-work/actions.ts',{...a.mocks,'@/lib/month':loadTs('src/lib/month.ts')});
 const billing=loadTs('src/app/admin/users/actions.ts',{...a.mocks,'@/lib/month':loadTs('src/lib/month.ts')});
 const fields={coach_ids:coach.id,work_date:'2026-11-01',coaching_hours:'0.5',admin_hours:'0.25',travel_expense:'0',other_expense:'0'};
 await work.createCoachWorkLogs(form(fields));const row=(await db.query('select id from coach_work_logs where coach_id=$1',[coach.id])).rows[0];
 await db.query("select * from manage_app_member($1,$2,'delete')",[t.adminId,coach.id]);
 await assert.rejects(work.createCoachWorkLogs(form(fields)));
 await assert.rejects(billing.createBillingItem(form({user_id:coach.id,target_month:'2026-11',category:'tuition',amount:'100'})));
 await work.updateCoachWorkLog(form({...fields,log_id:row.id,coach_id:coach.id,coaching_hours:'1.5'}));
 assert.equal((await db.query('select coaching_minutes from coach_work_logs where id=$1',[row.id])).rows[0].coaching_minutes,90);
});
