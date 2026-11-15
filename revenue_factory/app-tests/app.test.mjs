import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,stat} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createApp} from '../app.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(t){const folder=await mkdtemp(path.join(os.tmpdir(),'rf-app-'));const app=createApp({dataFile:path.join(folder,'db.json'),outputRoot:path.join(folder,'outputs')});await app.store.bootstrapAdmin('admin@example.com','some_secure_password_123');const address=await app.start({port:0});t.after(async()=>{await app.stop();await rm(folder,{recursive:true,force:true});});return {app,base:`http://127.0.0.1:${address.port}`,folder};}
async function send(base,route,{method='GET',body,token,csrf,headers={}}={}){const resp=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Cookie:`rf_session=${token}`}:{}) ,...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const type=resp.headers.get('content-type')||'';return{status:resp.status,cookie:resp.headers.get('set-cookie'),data:type.includes('json')?await resp.json():await resp.arrayBuffer()};}
async function login(base,email,password){const r=await send(base,'/api/app/login',{method:'POST',body:{email,password}});assert.equal(r.status,200);return {token:r.cookie.match(/rf_session=([^;]+)/)[1],csrf:r.data.csrf,user:r.data.user};}
test('auth required, CSRF protected, roles isolated, pay manually, produce and download report',async t=>{
 const {app,base}=await setup(t);const admin=await login(base,'admin@example.com','some_secure_password_123');
 assert.equal((await send(base,'/api/app/orders')).status,401);
 assert.equal((await send(base,'/api/app/customers',{method:'POST',body:{email:'x@example.com',password:'some_password_secure1!'},token:admin.token})).status,403);
 const created=await send(base,'/api/app/customers',{method:'POST',body:{email:'client@example.com',password:'longpassword_456!'},...admin});assert.equal(created.status,201);
 const customer=await login(base,'client@example.com','longpassword_456!');
 assert.equal((await send(base,'/api/app/customers',{method:'POST',body:{email:'x@example.com',password:'some_password_secure1!'},...customer})).status,403);
 const b={kind:'report',input:{csv:'date,product,quantity,unit_price\n2026-11-01,Cup,2,2500'},idempotencyKey:'abc123456789000'};
 let r=await send(base,'/api/app/orders',{method:'POST',body:b,...customer});assert.equal(r.status,201);const id=r.data.order.id;assert.equal(r.data.order.status,'AWAITING_PAYMENT');
 assert.equal((await send(base,'/api/app/orders',{method:'POST',body:b,...customer})).data.order.id,id);
 assert.equal((await send(base,`/api/app/download/${id}/delivery.zip`,{...customer})).status,400);
 assert.equal((await send(base,`/api/app/orders/${id}/payment`,{method:'POST',body:{reference:'bank verified 2026'},...customer})).status,403);
 r=await send(base,`/api/app/orders/${id}/payment`,{method:'POST',body:{reference:'bank verified 2026'},...admin});assert.equal(r.status,200);
 let done=false;for(let i=0;i<70;i++){await sleep(50);r=await send(base,`/api/app/orders/${id}`,customer);if(r.data.order.status==='DELIVERED'){done=true;break;}if(r.data.order.status==='FAILED')throw Error(r.data.order.error);}assert.equal(done,true);
 r=await send(base,`/api/app/download/${id}/delivery.zip`,customer);assert.equal(r.status,200);assert.equal(new Uint8Array(r.data)[0],0x50);
 const second=await send(base,'/api/app/customers',{method:'POST',body:{email:'other@example.com',password:'another_secure_pass1!'},...admin});assert.equal(second.status,201);const other=await login(base,'other@example.com','another_secure_pass1!');assert.equal((await send(base,`/api/app/orders/${id}`,other)).status,403);assert.equal((await send(base,`/api/app/download/${id}/delivery.zip`,other)).status,403);
});
test('invalid credentials, anti-CSRF and static app shell',async t=>{const {base}=await setup(t);assert.equal((await send(base,'/app')).status,200);assert.equal((await send(base,'/api/app/login',{method:'POST',body:{email:'admin@example.com',password:'wrong_password_123'}})).status,401);const admin=await login(base,'admin@example.com','some_secure_password_123');assert.equal((await send(base,'/api/app/orders',{method:'POST',token:admin.token,body:{kind:'report',input:{csv:'x'}}})).status,403);assert.equal((await send(base,'/api/app/orders',admin)).status,200);});
test('paid creative produces actual MP4 and approved ZIP includes MP4',async t=>{
 const {base,folder}=await setup(t);const admin=await login(base,'admin@example.com','some_secure_password_123');
 const brief={name:'텀블러',brand:'하루',audience:'직장인',features:['500ml 용량','스테인리스 외관'],priceKrw:19900};
 const resp=await send(base,'/api/app/orders',{method:'POST',body:{kind:'creative',input:brief},...admin});assert.equal(resp.status,201);const id=resp.data.order.id;
 const pay=await send(base,`/api/app/orders/${id}/payment`,{method:'POST',body:{reference:'verified test payment 123'},...admin});assert.equal(pay.status,200);
 let job;for(let i=0;i<200;i++){await sleep(50);const r=await send(base,`/api/app/orders/${id}`,admin);job=r.data.order;if(job.status==='NEEDS_REVIEW'||job.status==='FAILED')break;}
 assert.equal(job.status,'NEEDS_REVIEW',job.error);assert.ok(job.jobId);
 const approve=await send(base,`/api/app/orders/${id}/approve`,{method:'POST',body:{checks:{rights:true,accuracy:true,claims:true,channels:true}},...admin});assert.equal(approve.status,200);
 const video=await send(base,`/api/app/download/${id}/advertisement.mp4`,admin);assert.equal(video.status,200);assert.ok(video.data.byteLength>5000);
 const zip=await send(base,`/api/app/download/${id}/delivery.zip`,admin);assert.equal(zip.status,200);const data=Buffer.from(zip.data);assert.ok(data.includes(Buffer.from('advertisement.mp4')));
});
test('first-run setup works only locally and only once',async t=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'rf-setup-'));const app=createApp({dataFile:path.join(folder,'db.json'),outputRoot:path.join(folder,'outputs')});const addr=await app.start({port:0});const base=`http://127.0.0.1:${addr.port}`;t.after(async()=>{await app.stop();await rm(folder,{recursive:true,force:true});});
 assert.equal((await send(base,'/api/app/setup-status')).data.setupAllowed,true);
 const first=await send(base,'/api/app/setup',{method:'POST',body:{email:'initial@example.com',password:'secure_admin_pass_456'}});assert.equal(first.status,201);
 const again=await send(base,'/api/app/setup',{method:'POST',body:{email:'new@example.com',password:'secure_admin_pass_456'}});assert.equal(again.status,403);
 assert.equal((await send(base,'/api/app/setup-status')).data.setupAllowed,false);
 const auth=await login(base,'initial@example.com','secure_admin_pass_456');assert.equal(auth.user.role,'admin');
});