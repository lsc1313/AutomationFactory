import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const temp=await mkdtemp(path.join(os.tmpdir(),'studio-guest-test-'));
const token=randomBytes(32).toString('hex');
const hash=createHash('sha256').update(token).digest('hex');
const revoke=path.join(temp,'revoked');
process.env.STUDIO_GUEST_MODE='1';
process.env.STUDIO_GUEST_TOKEN_HASH=hash;
process.env.STUDIO_GUEST_EXPIRES_AT=String(Date.now()+3600_000);
process.env.STUDIO_GUEST_STOP_FILE=revoke;
process.env.STUDIO_TRUST_PROXY='1';
process.env.STUDIO_DATA_DIR=temp;
const {createStudioServer}=await import('../server.mjs');

test('external guest is isolated, invite-authenticated, restricted and immediately revocable',async t=>{
 const server=createStudioServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 const host='guest-studio.trycloudflare.com';
 const headers={Host:host,'X-Forwarded-Proto':'https'};
 const request=(endpoint,options={})=>fetch(base+endpoint,{...options,headers:{...headers,...options.headers},redirect:'manual'});
 let response=await request('/api/me');assert.equal(response.status,401);
 response=await request('/api/setup-state');assert.equal(response.status,200);
 assert.equal((await response.json()).setupNeeded,false);
 response=await request('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'attack-password-123'})});
 assert.equal(response.status,403);
 response=await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'attack-password-123'})});
 assert.equal(response.status,403);
 response=await request('/invite/'+'f'.repeat(64));assert.equal(response.status,403);
 const evilStatus=await new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/invite/'+token,method:'GET',
    headers:{Host:'attacker.example.org','X-Forwarded-Proto':'https'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});
  req.once('error',reject);req.end();
 });
 assert.equal(evilStatus,403,'unknown public hosts are denied');
 response=await request('/invite/'+token);
 assert.equal(response.status,303);
 assert.equal(response.headers.get('location'),'/app');
 const cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie?.startsWith('studio_session='));
 assert.match(response.headers.get('set-cookie'),/Secure/);
 response=await request('/api/me',{headers:{Cookie:cookie}});
 assert.equal(response.status,200);
 const user=await response.json();assert.ok(user.csrf);
 const authed={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':user.csrf};
 response=await request('/api/library',{headers:{Cookie:cookie}});
 assert.equal(response.status,200);
 const state=await response.json();assert.deepEqual(state.projects,[]);assert.deepEqual(state.media,[]);
 response=await request('/api/guest/link',{headers:{Cookie:cookie}});assert.equal(response.status,403);
 response=await request('/api/guest/stop',{method:'POST',headers:authed,body:'{}'});assert.equal(response.status,403);
 response=await request('/api/guest/start',{method:'POST',headers:authed,body:'{}'});assert.equal(response.status,403);
 response=await request('/api/ai/config',{method:'POST',headers:authed,body:JSON.stringify({key:'a'.repeat(40)})});assert.equal(response.status,403);
 for(let i=0;i<8;i++){
  response=await request('/api/voice/preview',{method:'POST',headers:authed,body:JSON.stringify({voice:'off',text:'hello'})});
  assert.equal(response.status,400);
 }
 response=await request('/api/voice/preview',{method:'POST',headers:authed,body:JSON.stringify({voice:'off',text:'hello'})});
 assert.equal(response.status,429,'guest cannot exhaust unlimited voice previews');
 await writeFile(revoke,'revoked');
 response=await request('/api/me',{headers:{Cookie:cookie}});assert.equal(response.status,403,'revoked guest link immediately becomes unusable');
});
