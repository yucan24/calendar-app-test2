import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createTestDatabase, createTeam, loadTs, postgresClient } from './helpers.mjs';

const migrationName='20261121010000_prevent_duplicate_tuition.sql';
const migration=readFileSync('supabase/migrations/'+migrationName,'utf8');
let db;
before(async()=>{db=await createTestDatabase();});
after(async()=>{await db?.close();});
const form=values=>{const f=new FormData();for(const[k,v]of Object.entries(values))f.set(k,v);return f;};
const member=async(t,suffix='user',enabled=true)=>(await db.query("insert into profiles(group_id,name,role,login_enabled) values($1,$2,'user',$3) returning *",[t.groupId,suffix+'-'+t.groupId,enabled])).rows[0];
const bills=async(t)=>(await db.query('select * from billing_items where group_id=$1 order by id',[t.groupId])).rows;
const call=async(t,month='2026-11',amount=5000,note='')=>(await db.query('select create_monthly_tuition($1,$2,$3,$4) as created_count',[t.adminId,month,amount,note])).rows[0].created_count;
function actions(t,client=postgresClient(db),actor={id:t.adminId,group_id:t.groupId}){
 return loadTs('src/app/admin/users/actions.ts',{'@/lib/auth':{requireAdmin:async()=>actor},'@/lib/supabase':{supabase:client},'@/lib/month':loadTs('src/lib/month.ts'),'next/cache':{revalidatePath(){}}});
}

test('月謝一括作成の同時要求・異なる金額の再送でも既存の請求を上書きしない',async()=>{
 const t=await createTeam(db);await member(t);await member(t,'second');
 const a=actions(t);await Promise.all(Array.from({length:12},()=>a.createTuitionForAllUsers(form({target_month:'2026-11',amount:'5000',note:'original'}))));
 const first=await bills(t);assert.equal(first.length,2);assert.ok(first.every(b=>b.amount===5000&&b.note==='original'));
 await a.createTuitionForAllUsers(form({target_month:'2026-11',amount:'9999',note:'retry'}));assert.deepEqual(await bills(t),first);
});

test('作成済み・支払済み・免除の月謝を保持し、追加の会員だけへ作成する',async()=>{
 const t=await createTeam(db),a=await member(t,'paid'),b=await member(t,'exempt');
 await db.query("insert into billing_items(group_id,user_id,target_month,category,title,amount,status,note,paid_at) values($1,$2,'2026-11','tuition','月謝',3000,'paid','paid-note',now()),($1,$3,'2026-11','tuition','月謝',0,'exempt','exempt-note',null)",[t.groupId,a.id,b.id]);
 const original=await bills(t);const c=await member(t,'new');assert.equal(await call(t),1);assert.equal((await bills(t)).length,3);assert.deepEqual((await bills(t)).filter(x=>x.user_id!==c.id),original);assert.equal(await call(t),0);
});

test('個別追加・月の変更・費目変更でも同じ会員の同月月謝は重複せず、他費目は複数保持する',async()=>{
 const t=await createTeam(db),m=await member(t),a=actions(t),input={user_id:m.id,target_month:'2026-11',category:'tuition',amount:'100'};
 await a.createBillingItem(form(input));const first=await bills(t);
 await assert.rejects(a.createBillingItem(form(input)),/月謝は既に登録/);assert.deepEqual(await bills(t),first);
 await a.createBillingItem(form({...input,target_month:'2026-12'}));let later=(await bills(t)).find(b=>b.target_month==='2026-12');
 await assert.rejects(a.updateBillingItem(form({...input,item_id:later.id})),/月謝は既に登録/);
 for(let i=0;i<2;i++)await a.createBillingItem(form({...input,category:'trip'}));const trip=(await bills(t)).find(b=>b.category==='trip');
 await assert.rejects(a.updateBillingItem(form({...input,item_id:trip.id})),/月謝は既に登録/);
 assert.equal((await bills(t)).length,4);assert.equal((await bills(t)).filter(b=>b.category==='trip').length,2);
 await assert.rejects(db.query("insert into billing_items(group_id,user_id,target_month,category,title,amount) values($1,$2,'2026-11','tuition','direct',1)",[t.groupId,m.id]),e=>e.code==='23505');
});

test('同じ月・同じ人名でもチームごとに分離し、未承認・停止・管理者を一括請求しない',async()=>{
 const t=await createTeam(db),other=await createTeam(db);await member(t);await member(other);
 await member(t,'suspended',false);await db.query("insert into profiles(group_id,name,role,account_status) values($1,$2,'user','pending'),($1,$3,'user','invited')",[t.groupId,'pending-'+t.groupId,'invited-'+t.groupId]);
 const a=actions(t);await a.createTuitionForAllUsers(form({target_month:'2026-11',amount:'100',p_admin_id:other.adminId,group_id:other.groupId}));
 assert.equal((await bills(t)).length,1);assert.equal((await bills(other)).length,0);assert.equal(await call(other),1);assert.equal(await call(t,'2026-12',0),1);
});

test('RPCは有効な管理者・有効な月・非負金額を必須にし、公開ロールから呼べない',async()=>{
 const t=await createTeam(db),m=await member(t);for(const actor of [null,m.id,'00000000-0000-4000-8000-000000000001'])await assert.rejects(db.query("select create_monthly_tuition($1,'2026-11',1,'')",[actor]),e=>e.code==='42501');
 for(const month of [null,'0000-01','2026-00','2026-13','banana'])await assert.rejects(call(t,month),e=>e.code==='22023');
 for(const amount of [null,-1])await assert.rejects(call(t,'2026-11',amount),e=>e.code==='22023');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(call(t),/permission denied/);}finally{await db.exec('reset role');}}
 await db.exec('set role service_role');try{assert.equal(await call(t),1);}finally{await db.exec('reset role');}
 await db.query("update profiles set login_enabled=false where id=$1",[t.adminId]);await assert.rejects(call(t,'2026-12'),e=>e.code==='42501');
});

test('一括作成の途中で失敗したら、その要求で作る全会員分をロールバックする',async()=>{
 const t=await createTeam(db);const members=await Promise.all([member(t,'a'),member(t,'b'),member(t,'c')]);const failed=members.map(m=>m.id).sort()[1];
 await db.exec(`create function qa_fail_tuition() returns trigger language plpgsql as $$ begin if new.user_id='${failed}'::uuid then raise exception 'QA atomic rollback'; end if; return new; end $$; create trigger qa_fail_tuition before insert on billing_items for each row execute function qa_fail_tuition();`);
 try{await assert.rejects(call(t),/QA atomic rollback/);assert.equal((await bills(t)).length,0);}finally{await db.exec('drop trigger qa_fail_tuition on billing_items; drop function qa_fail_tuition();');}
 assert.equal(await call(t),3);
});

test('既存の月謝が重複していればmigrationを停止し、元の請求を削除・変更しない',async()=>{
 const legacy=new PGlite({extensions:{pgcrypto}});try{
  await legacy.exec('create schema extensions; create role anon; create role authenticated; create role service_role bypassrls;');
  for(const name of readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')&&n<migrationName).sort())await legacy.exec(readFileSync('supabase/migrations/'+name,'utf8'));
  const t=await createTeam(legacy);await legacy.query("insert into billing_items(group_id,user_id,target_month,category,title,amount) values($1,$2,'2026-11','tuition','one',100),($1,$2,'2026-11','tuition','two',200)",[t.groupId,t.adminId]);
  const first=(await legacy.query('select * from billing_items order by id')).rows;
  await assert.rejects(legacy.exec('begin;'+migration+'commit;'),/月謝が重複/);await legacy.exec('rollback;');assert.deepEqual((await legacy.query('select * from billing_items order by id')).rows,first);
  assert.equal((await legacy.query("select to_regclass('billing_items_tuition_group_user_month_key') as idx")).rows[0].idx,null);
 }finally{await legacy.close();}
});

test('DBエラー時は一括作成の成功として扱わず呼び出し元へ失敗を返す',async()=>{
 const t=await createTeam(db);const a=actions(t,{rpc:async()=>({error:{message:'QA database failure'}})});await assert.rejects(a.createTuitionForAllUsers(form({target_month:'2026-11',amount:'100'})),/QA database failure/);
});
