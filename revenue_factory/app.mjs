/** Revenue Factory customer/order portal. Single-node backend; put behind HTTPS before internet use. */
import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { createOrder, listOrders, getOrder, recordPayment, approveOrder, retryOrder, runOrder, productFilePath, previewVideoPath, createCustomer, PRODUCTS } from './commerce.mjs';
import { renderStatus } from './render.mjs';
import { directorAvailability } from './director-pipeline.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const hardHeaders={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy':"default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"};
const json=(res,status,value,extra={})=>{res.writeHead(status,{...hardHeaders,...extra,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
const cookieToken=req=>(String(req.headers.cookie||'').match(/(?:^|;\s*)rf_session=([^;]+)/)||[])[1]||null;
const invalid=msg=>{const e=new Error(msg);e.status=400;return e;};
const allowCredentials=(req,res,host)=>{const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===host;}catch{return false;}};
async function body(req,max=7_500_000){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw invalid('요청이 너무 큽니다.');chunks.push(chunk);}let x;try{x=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw invalid('올바른 JSON이 아닙니다.');}if(!x||typeof x!=='object'||Array.isArray(x))throw invalid('객체만 요청할 수 있습니다.');return x;}
const publicAssets={'/app':'app.html','/app.css':'app.css','/app.js':'app-client.js','/app.webmanifest':'app.webmanifest','/app-sw.js':'app-sw.js','/icons/icon-192.png':'icons/icon-192.png','/icons/icon-512.png':'icons/icon-512.png'};
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png'};
function safeOrder(o){if(!o)return o;const {brief,...meta}=o;return meta;}
export function createApp({dataFile=process.env.REVENUE_DB || path.join(root,'private','app.json'),outputRoot=process.env.REVENUE_OUT || path.join(root,'output'),secureCookie=process.env.REVENUE_SECURE_COOKIE==='1',publicHost=process.env.REVENUE_PUBLIC_HOST||null,trustProxy=process.env.REVENUE_TRUST_PROXY==='1'}={}){
 const store=new Store(dataFile);const busy=new Set();const attempts=new Map();let closed=false;
 const runPending=async()=>{if(closed)return;const db=await store.read();for(const order of db.orders.filter(o=>o.status==='QUEUED')){if(busy.has(order.id))continue;if(busy.size>=1)break;busy.add(order.id);void runOrder(store,outputRoot,order.id).catch(e=>console.error('Order processing:',e.message)).finally(()=>{busy.delete(order.id);void runPending();});}};
 const serve=async(req,res)=>{
  const url=new URL(req.url||'/', 'http://localhost');
  try{
   const host=String(req.headers.host||'').toLowerCase();const hostname=host.split(':')[0];const local=['127.0.0.1','localhost'].includes(hostname);
   if(!local && (!publicHost||hostname!==publicHost.toLowerCase()))return json(res,403,{error:'승인되지 않은 호스트입니다.'});
   if(!local && (!secureCookie||!trustProxy||req.headers['x-forwarded-proto']!=='https'||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)))return json(res,403,{error:'공개 서비스는 로컬 HTTPS 프록시만 허용합니다.'});
   if(!['GET','POST'].includes(req.method))return json(res,405,{error:'지원하지 않는 메서드입니다.'});
   if(req.method==='POST'){
    if(!allowCredentials(req,res,host))return json(res,403,{error:'외부 출처 요청 차단'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,415,{error:'application/json 요청만 허용됩니다.'});
   }
   if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/app'))url.pathname='/app';
   if(req.method==='GET'&&publicAssets[url.pathname]){
    const filename=path.resolve(root,publicAssets[url.pathname]);const content=await readFile(filename);
    res.writeHead(200,{...hardHeaders,'Content-Type':types[path.extname(filename)]||'application/octet-stream',...(url.pathname==='/app-sw.js'?{'Service-Worker-Allowed':'/'}:{})});res.end(content);return;
   }
   if(req.method==='GET'&&url.pathname==='/api/app/health')return json(res,200,{ok:true,mode:publicHost?'https-proxy':'local',renderer:await renderStatus(),director:await directorAvailability(),payment:'manual-approval'});
   if(req.method==='GET'&&url.pathname==='/api/app/setup-status'){const db=await store.read();return json(res,200,{setupAllowed:local&&!db.users.some(u=>u.role==='admin')});}
   if(req.method==='POST'&&url.pathname==='/api/app/setup'){
    const db=await store.read();if(!local||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||db.users.some(u=>u.role==='admin'))return json(res,403,{error:'첫 설치는 PC에서만 가능합니다.'});
    const b=await body(req,3000);const ok=await store.bootstrapAdmin(b.email,b.password);if(!ok)return json(res,409,{error:'관리자 설정이 이미 완료됐습니다.'});return json(res,201,{ok:true});
   }
   if(req.method==='POST'&&url.pathname==='/api/app/login'){
    const key=req.socket.remoteAddress||'local';const now=Date.now();const a=attempts.get(key)||[];const active=a.filter(t=>now-t<15*60000);if(active.length>=10)return json(res,429,{error:'로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요.'});active.push(now);attempts.set(key,active);if(attempts.size>1000)attempts.clear();
    const b=await body(req,2000);let auth;try{auth=await store.login(b.email,b.password);}catch{auth=null;}
    if(!auth)return json(res,401,{error:'로그인 정보를 확인하세요.'});attempts.delete(key);
    return json(res,200,{user:auth.user,csrf:auth.csrf},{'Set-Cookie':`rf_session=${auth.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secureCookie&&!local?'; Secure':''}`});
   }
   const session=await store.session(cookieToken(req));
   if(req.method==='GET'&&url.pathname==='/api/app/me')return session?json(res,200,{user:session.user,csrf:session.session.csrf,products:PRODUCTS}):json(res,401,{error:'로그인이 필요합니다.'});
   if(!session)return json(res,401,{error:'로그인이 필요합니다.'});
   if(req.method==='POST' && req.headers['x-csrf-token']!==session.session.csrf)return json(res,403,{error:'CSRF 토큰 오류'});
   const user=session.user;
   if(req.method==='POST'&&url.pathname==='/api/app/logout'){await store.logout(cookieToken(req));return json(res,200,{ok:true},{'Set-Cookie':`rf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie&&!local?'; Secure':''}`});}
   if(req.method==='POST'&&url.pathname==='/api/app/password'){const b=await body(req,5000);await store.changePassword(user.id,b.currentPassword,b.newPassword);return json(res,200,{ok:true,relogin:true},{'Set-Cookie':'rf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
   if(req.method==='GET'&&url.pathname==='/api/app/orders')return json(res,200,{orders:await listOrders(store,user)});
   if(req.method==='POST'&&url.pathname==='/api/app/orders'){
    const b=await body(req,44_000_000);const o=await createOrder(store,{user,kind:b.kind,input:b.input,idempotencyKey:req.headers['idempotency-key']||b.idempotencyKey});await store.audit(user.id,'order-created',o.id);return json(res,201,{order:safeOrder(o),payment:{status:'AWAITING_MANUAL_VERIFICATION',amountKrw:o.priceKrw,notice:'결제는 운영자가 외부 입금 내역을 확인한 뒤 승인합니다. 이 앱은 카드 결제를 처리하지 않습니다.'}});
   }
   if(req.method==='POST'&&url.pathname==='/api/app/customers'){
    if(user.role!=='admin')return json(res,403,{error:'운영자 전용'});const b=await body(req,5000);
    const customer=await createCustomer(store,user,b.email,b.password);await store.audit(user.id,'customer-created',customer.id);return json(res,201,{customer});
   }
   const m=url.pathname.match(/^\/api\/app\/orders\/(ord_[0-9a-f]{24})(?:\/(payment|approve|retry))?$/);
   if(m){const id=m[1],action=m[2];if(req.method==='GET'&&!action)return json(res,200,{order:safeOrder(await getOrder(store,user,id))});if(req.method!=='POST')return json(res,405,{error:'POST 요청만 허용'});if(user.role!=='admin')return json(res,403,{error:'운영자 전용'});const b=await body(req,3000);
    if(action==='payment'){const o=await recordPayment(store,user,id,b.reference);await store.audit(user.id,'manual-payment-approved',id);void runPending();return json(res,200,{order:safeOrder(o)});}
    if(action==='approve'){const o=await approveOrder(store,outputRoot,user,id,b.checks);await store.audit(user.id,'delivery-approved',id);return json(res,200,{order:safeOrder(o)});}
    if(action==='retry'){const o=await retryOrder(store,user,id);void runPending();return json(res,200,{order:safeOrder(o)});}
   }
   // Operator-only video preview is intentionally available before final approval.
   // Customers cannot access creative files until an approved delivery exists.
   const preview=url.pathname.match(/^\/api\/app\/preview\/(ord_[0-9a-f]{24})\/advertisement\.mp4$/);
   if(preview&&req.method==='GET'){
    if(user.role!=='admin')return json(res,403,{error:'운영자만 검수 영상을 볼 수 있습니다.'});
    const filename=await previewVideoPath(store,outputRoot,user,preview[1]);
    const file=await readFile(filename);
    res.writeHead(200,{...hardHeaders,'Content-Type':'video/mp4','Content-Length':file.length,'Accept-Ranges':'none','Content-Disposition':'inline; filename="advertisement.mp4"'});
    res.end(file);return;
   }
   const d=url.pathname.match(/^\/api\/app\/download\/(ord_[0-9a-f]{24})\/(delivery\.zip|advertisement\.mp4|report\.html)$/);
   if(d&&req.method==='GET'){
    const filename=await productFilePath(store,outputRoot,user,d[1],d[2]);const file=await readFile(filename);res.writeHead(200,{...hardHeaders,'Content-Disposition':`attachment; filename="${d[2]}"`,'Content-Type':d[2].endsWith('.zip')?'application/zip':d[2].endsWith('.mp4')?'video/mp4':'text/html; charset=utf-8'});res.end(file);return;
   }
   return json(res,404,{error:'존재하지 않는 주소입니다.'});
  }catch(e){const status=e.code==='ENOENT'?404:e.status||(/접근 권한|운영자만/.test(e.message)?403:400);return json(res,status,{error:status===404?'파일을 찾을 수 없습니다.':e.message});}
 };
 const server=http.createServer(serve);
 const start=async({port=Number(process.env.REVENUE_APP_PORT||8040),bind=process.env.REVENUE_BIND||'127.0.0.1'}={})=>{
  if(bind!=='127.0.0.1'&&bind!=='localhost'&&(!publicHost||!secureCookie||process.env.REVENUE_TRUST_PROXY!=='1'))throw Error('외부 공개는 REVENUE_PUBLIC_HOST, REVENUE_SECURE_COOKIE=1, REVENUE_TRUST_PROXY=1이 모두 필요합니다.');
  await mkdir(path.dirname(dataFile),{recursive:true,mode:0o700});
  if(process.env.REVENUE_ADMIN_EMAIL&&process.env.REVENUE_ADMIN_PASSWORD)await store.bootstrapAdmin(process.env.REVENUE_ADMIN_EMAIL,process.env.REVENUE_ADMIN_PASSWORD);
  if(!(await store.read()).users.some(u=>u.role==='admin') && bind!=='127.0.0.1'&&bind!=='localhost')throw Error('공개 서버는 REVENUE_ADMIN_EMAIL / REVENUE_ADMIN_PASSWORD를 먼저 설정해야 합니다.');
  await store.transaction(db=>{for(const o of db.orders){if(o.status==='PROCESSING')o.status='QUEUED';}});
  await new Promise((resolve,reject)=>server.once('error',reject).listen(port,bind,resolve));void runPending();
  return server.address();
 };
 const stop=async()=>{closed=true;await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));};
 return {server,store,start,stop,runPending};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const instance=createApp();instance.start().then(addr=>console.log(`Revenue Factory App: http://127.0.0.1:${addr.port}/app`)).catch(e=>{console.error(e.message);process.exitCode=1;});
}