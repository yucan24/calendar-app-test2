import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers.mjs';
const environment=loadTs('src/lib/environment.ts');
function setup(patch={}){
 const previous={...process.env};
 for(const key of ['SUPABASE_URL','VERCEL_ENV','EMAIL_DELIVERY_MODE','EMAIL_TEST_TO','SMTP_USER','SMTP_PASSWORD','EMAIL_FROM','APP_URL'])delete process.env[key];
 Object.assign(process.env,{SUPABASE_URL:'https://xvgqwdiyoorzejfozoca.supabase.co',SMTP_USER:'sender@example.test',SMTP_PASSWORD:'fake-test-only',...patch});
 const sent=[],config=[];let closed=0;
 const nodemailer={createTransport(options){config.push(options);return{sendMail:async mail=>{sent.push(mail);return{accepted:[mail.to],rejected:[]};},close(){closed++;}};}};
 const emailModule=loadTs('src/lib/accountEmail.ts',{'server-only':{},nodemailer,'@/lib/environment':environment});
 return{module:emailModule,sent,config,closed:()=>closed,restore(){for(const key of Object.keys(process.env))if(!Object.hasOwn(previous,key))delete process.env[key];Object.assign(process.env,previous);}};
}
const message={to:'member@example.test',subject:'account notification',text:'Confirm through a one-use link'};
test('テストDBではSMTP認証情報があっても既定で実送信しない',async()=>{
 const h=setup({VERCEL_ENV:'production',EMAIL_DELIVERY_MODE:'production'});try{assert.equal(await h.module.sendAccountEmail(message),'disabled');assert.equal(h.config.length,0);}finally{h.restore();}
});
test('テスト送信は指定宛先へ集約し、本来の会員へ送らない',async()=>{
 const h=setup({EMAIL_DELIVERY_MODE:'test',EMAIL_TEST_TO:'tester@example.test'});try{
  assert.equal(await h.module.sendAccountEmail(message),'sent');assert.equal(h.sent[0].to,'tester@example.test');assert.match(h.sent[0].subject,/テスト環境/);assert.ok(h.sent[0].text.includes(message.to));assert.equal(h.config[0].secure,true);assert.equal(h.config[0].requireTLS,true);assert.equal(h.closed(),1);
 }finally{h.restore();}
});
test('テスト送信で受信先が未指定ならSMTP接続前に拒否する',async()=>{
 const h=setup({EMAIL_DELIVERY_MODE:'test'});try{await assert.rejects(h.module.sendAccountEmail(message),/受信先/);assert.equal(h.config.length,0);}finally{h.restore();}
});
test('本番送信は有効化・認証設定を必須にし、設定済みなら自動送信する',async()=>{
 const h=setup({SUPABASE_URL:'https://wswntpyibylcrjjdmguy.supabase.co',VERCEL_ENV:'production'});
 try{
  await assert.rejects(h.module.sendAccountEmail(message),/有効/);
  process.env.EMAIL_DELIVERY_MODE='production';delete process.env.SMTP_PASSWORD;
  await assert.rejects(h.module.sendAccountEmail(message),/認証設定/);
  process.env.SMTP_PASSWORD='fake-test-only';assert.equal(await h.module.sendAccountEmail(message),'sent');assert.equal(h.sent[0].to,message.to);
 }finally{h.restore();}
});
test('案内URLはHostヘッダーから作らず、固定のアプリURLを使う',()=>{
 const h=setup({APP_URL:'https://calendar.example.test/base'});try{
  assert.equal(h.module.applicationUrl(),'https://calendar.example.test');process.env.APP_URL='javascript:alert(1)';assert.throws(()=>h.module.applicationUrl());process.env.APP_URL='https://user:secret@example.test';assert.throws(()=>h.module.applicationUrl());
 }finally{h.restore();}
});
