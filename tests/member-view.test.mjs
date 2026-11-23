import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers.mjs';

const { filterMembers } = loadTs('src/app/admin/members/memberView.ts');
const members = [
 { id:'pending',name:'山田太郎',email:'member@example.test',account_status:'pending' },
 { id:'review',name:'佐藤',email:'review@example.test',account_status:'review' },
 { id:'invited',name:'鈴木',email:'invite@example.test',account_status:'invited' },
 { id:'active',name:'山田花子',email:'ACTIVE@example.test',account_status:'active' },
 { id:'deleted',name:'山田旧会員',email:'',account_status:'deleted' },
];
test('承認待ちには要確認を含み、本人の設定待ちと分ける',()=>{
 assert.deepEqual(filterMembers(members,'pending','').map(m=>m.id),['pending','review']);
 assert.deepEqual(filterMembers(members,'invited','').map(m=>m.id),['invited']);
});
test('通常一覧から削除済みを外し、削除済みフィルターでは履歴を探せる',()=>{
 assert.equal(filterMembers(members,'all','').length,4);
 assert.deepEqual(filterMembers(members,'deleted','山田').map(m=>m.id),['deleted']);
});
test('状態と名前・メールの検索を組み合わせ、空白や大文字小文字を吸収する',()=>{
 assert.deepEqual(filterMembers(members,'all','山 田').map(m=>m.id),['pending','active']);
 assert.deepEqual(filterMembers(members,'active','active@example.test').map(m=>m.id),['active']);
 assert.equal(filterMembers(members,'pending','存在しない').length,0);
});
