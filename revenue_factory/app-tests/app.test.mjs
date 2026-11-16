import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,stat} from 'node:fs/promises';import os from 'node:os';
import http from 'node:http';import path from 'node:path';
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
test('rejects creative orders with no actual product photos before payment',async t=>{
 const {base}=await setup(t);const admin=await login(base,'admin@example.com','some_secure_password_123');
 const r=await send(base,'/api/app/orders',{method:'POST',body:{kind:'creative',input:{brand:'온유',name:'텀블러',audience:'직장인',features:['500ml 용량']}},...admin});
 assert.equal(r.status,400);assert.match(r.data.error,/2~6장/);
});
test('first-run setup works only locally and only once',async t=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'rf-setup-'));const app=createApp({dataFile:path.join(folder,'db.json'),outputRoot:path.join(folder,'outputs')});const addr=await app.start({port:0});const base=`http://127.0.0.1:${addr.port}`;t.after(async()=>{await app.stop();await rm(folder,{recursive:true,force:true});});
 assert.equal((await send(base,'/api/app/setup-status')).data.setupAllowed,true);
 const first=await send(base,'/api/app/setup',{method:'POST',body:{email:'initial@example.com',password:'secure_admin_pass_456'}});assert.equal(first.status,201);
 const again=await send(base,'/api/app/setup',{method:'POST',body:{email:'new@example.com',password:'secure_admin_pass_456'}});assert.equal(again.status,403);
 assert.equal((await send(base,'/api/app/setup-status')).data.setupAllowed,false);
 const auth=await login(base,'initial@example.com','secure_admin_pass_456');assert.equal(auth.user.role,'admin');
});
function rawProxyGet(base,host,proto){
 return new Promise((resolve,reject)=>{
  const url=new URL(base+'/app');
  const req=http.get({hostname:url.hostname,port:url.port,path:url.pathname,headers:{Host:host,'X-Forwarded-Proto':proto}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
  req.on('error',reject);
 });
}
test('private tailnet HTTPS proxy accepts exact host while rejecting spoofed hosts and insecure forwarding',async t=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'rf-tailnet-'));
 const app=createApp({dataFile:path.join(folder,'db.json'),outputRoot:path.join(folder,'outputs'),secureCookie:true,publicHost:'revenue-box.example.ts.net',trustProxy:true});
 await app.store.bootstrapAdmin('admin@example.com','some_secure_password_123');
 const addr=await app.start({port:0}); const base='http://127.0.0.1:'+addr.port;
 t.after(async()=>{await app.stop();await rm(folder,{recursive:true,force:true});});
 const host={'Host':'revenue-box.example.ts.net','X-Forwarded-Proto':'https'};
 assert.equal(await rawProxyGet(base,'revenue-box.example.ts.net','https'),200);
 assert.equal(await rawProxyGet(base,'revenue-box.example.ts.net','http'),403);
 assert.equal(await rawProxyGet(base,'other.example.ts.net','https'),403);
 assert.equal((await send(base,'/app')).status,200);
 const logged=await new Promise((resolve,reject)=>{
  const target=new URL(base);const payload=JSON.stringify({email:'admin@example.com',password:'some_secure_password_123'});
  const req=http.request({hostname:target.hostname,port:target.port,path:'/api/app/login',method:'POST',headers:{Host:'revenue-box.example.ts.net','X-Forwarded-Proto':'https',Origin:'https://revenue-box.example.ts.net','Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,cookie:res.headers['set-cookie']?.[0]||''}));});
  req.on('error',reject);req.end(payload);
 });
 assert.equal(logged.status,200); assert.match(logged.cookie,/Secure/);
});
