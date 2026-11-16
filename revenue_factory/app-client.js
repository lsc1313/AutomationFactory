'use strict';
let current=null,csrf=null,orders=[];const $=id=>document.getElementById(id);
function el(tag,text,cls){const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;}
async function api(url,body,method){const opts={method:method||(body===undefined?'GET':'POST'),credentials:'same-origin',headers:{}};if(body!==undefined){opts.headers['Content-Type']='application/json';opts.headers['X-CSRF-Token']=csrf||'';opts.body=JSON.stringify(body);}const res=await fetch(url,opts);const x=await res.json();if(!res.ok)throw Error(x.error||'요청 오류');return x;}
async function showLogin(){current=null;csrf=null;$('app-view').classList.add('hidden');$('setup-view').classList.add('hidden');$('login-view').classList.remove('hidden');$('logout').classList.add('hidden');$('profile').textContent='로그인이 필요합니다.';}
async function loadSession(){try{const x=await api('/api/app/me');current=x.user;csrf=x.csrf;$('login-view').classList.add('hidden');$('setup-view').classList.add('hidden');$('app-view').classList.remove('hidden');$('logout').classList.remove('hidden');$('profile').textContent=current.email+' · '+(current.role==='admin'?'운영자':'고객');document.querySelectorAll('.admin-only').forEach(x=>x.classList.toggle('hidden',current.role!=='admin'));await refreshOrders();go('overview');}catch{const status=await api('/api/app/setup-status').catch(()=>({setupAllowed:false}));if(status.setupAllowed){$('login-view').classList.add('hidden');$('app-view').classList.add('hidden');$('setup-view').classList.remove('hidden');}else await showLogin();}}
function go(name){if(name==='admin'&&current?.role!=='admin')return;document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('hidden',x.dataset.view!==name));document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('on',x.dataset.tab===name));$('sidebar')?.classList.remove('open');document.querySelector('.sidebar').classList.remove('open');if(name==='orders'||name==='admin')void refreshOrders();}
$('menu').onclick=()=>document.querySelector('.sidebar').classList.toggle('open');document.querySelectorAll('[data-tab]').forEach(x=>x.onclick=()=>go(x.dataset.tab));document.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>go(x.dataset.go));

$('setup-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),btn=e.target.querySelector('button');btn.disabled=true;try{await api('/api/app/setup',{email:f.get('email'),password:f.get('password')});e.target.reset();await showLogin();$('login-error').textContent='관리자 계정이 생성됐습니다. 새 계정으로 로그인하세요.';}catch(err){$('setup-error').textContent=err.message;}finally{btn.disabled=false;}};
$('login-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),b=e.target.querySelector('button');b.disabled=true;$('login-error').textContent='';try{await api('/api/app/login',{email:f.get('email'),password:f.get('password')});e.target.reset();await loadSession();}catch(err){$('login-error').textContent=err.message;}finally{b.disabled=false;}};
$('logout').onclick=async()=>{try{await api('/api/app/logout',{});}finally{await showLogin();}};
$('password-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),target=$('password-message');target.textContent='';try{await api('/api/app/password',{currentPassword:f.get('currentPassword'),newPassword:f.get('newPassword')});target.textContent='비밀번호가 변경됐습니다. 다시 로그인해 주세요.';e.target.reset();await showLogin();}catch(err){target.textContent=err.message;}};
const idempotency=()=>Array.from(crypto.getRandomValues(new Uint8Array(16))).map(v=>v.toString(16).padStart(2,'0')).join('');
async function fileData(file){
 if(!file.type.startsWith('image/'))throw Error('이미지 파일만 등록할 수 있습니다.');
 if(file.size>20_000_000)throw Error('원본 사진은 20MB 이하여야 합니다.');
 // Phone camera HEIC/large JPEG -> supported JPEG, resized before transfer to PC.
 const bitmap=await createImageBitmap(file).catch(()=>{throw Error('사진을 변환할 수 없습니다. 휴대폰 사진을 JPG로 저장해 등록하세요.');});
 try{
  const max=1600,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const context=canvas.getContext('2d');if(!context)throw Error('이미지 처리 기능을 사용할 수 없습니다.');
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const data=canvas.toDataURL('image/jpeg',0.88);
  if(data.length>6_600_000)throw Error('사진이 너무 큽니다. 더 작은 사진을 등록하세요.');
  return data;
 }finally{bitmap.close();}
}
async function submitOrder(form,kind,build,target,ownerPreview=false){
 const buttons=[...form.querySelectorAll('button[type=submit]')];buttons.forEach(x=>x.disabled=true);
 target.textContent='사진 전송과 요청을 준비하는 중입니다.';
 try{
  const input=await build(new FormData(form)),key=idempotency();
  const url=ownerPreview?'/api/app/owner-preview':'/api/app/orders';
  const x=await api(url,ownerPreview?{input,idempotencyKey:key}:{kind,input,idempotencyKey:key});
  target.textContent=ownerPreview?'PC의 ShortsAI 제작 대기열에 등록했습니다. 주문 목록에서 진행 상황을 확인하세요.':`주문 ${x.order.id} 접수 완료. 운영자 결제 확인을 기다립니다.`;
  form.reset();$('photo-preview')?.replaceChildren();await refreshOrders();go('orders');
 }catch(err){target.textContent='오류: '+err.message;}finally{buttons.forEach(x=>x.disabled=false);}
}
async function buildCreativeInput(f){
 const photos=f.getAll('photos').filter(x=>x instanceof File&&x.size);
 if(photos.length<2||photos.length>6)throw Error('서로 다른 상품 사진 2~6장을 등록하세요.');
 const imageDataUrls=await Promise.all(photos.map(fileData));
 return {imageDataUrls,brand:f.get('brand'),name:f.get('name'),audience:f.get('audience'),
 priceKrw:f.get('priceKrw'),features:String(f.get('features')).split('\n').map(x=>x.trim()).filter(Boolean),
 landingUrl:f.get('landingUrl')};
}
$('creative-form').onsubmit=e=>{e.preventDefault();void submitOrder(e.target,'creative',buildCreativeInput,$('creative-message'),e.submitter?.id==='start-owner-preview');};
$('photos').addEventListener('change',e=>{
 const preview=$('photo-preview');preview.replaceChildren();
 const files=[...e.target.files];$('photo-count').textContent=files.length+'장 선택됨';
 for(const f of files.slice(0,6)){
  const img=el('img');img.alt=f.name;img.src=URL.createObjectURL(f);
  img.onload=()=>URL.revokeObjectURL(img.src);preview.append(img);
 }
});
$('report-form').onsubmit=e=>{e.preventDefault();void submitOrder(e.target,'report',async f=>{const file=f.get('file');const csv=file?.size?await file.text():String(f.get('csv'));if(csv.length>500000)throw Error('CSV 최대 500KB');return{csv};},$('report-message'));};
$('customer-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{const x=await api('/api/app/customers',{email:f.get('email'),password:f.get('password')});$('customer-message').textContent=`계정 ${x.customer.email} 생성 완료. 비밀번호는 별도로 안전하게 전달하세요.`;e.target.reset();}catch(err){$('customer-message').textContent=err.message;}};
const labels={AWAITING_PAYMENT:'입금 확인 대기',QUEUED:'제작 대기',PROCESSING:'제작 중',NEEDS_REVIEW:'광고 검수 대기',DELIVERED:'납품 완료',FAILED:'작업 실패'};
function action(text,cb,cls='secondary'){const b=el('button',text,cls);b.type='button';b.onclick=async()=>{b.disabled=true;try{await cb();await refreshOrders();}catch(e){window.alert(e.message);}finally{b.disabled=false;}};return b;}
const dl=(id,filename,label)=>{const a=el('a',label);a.href=`/api/app/download/${id}/${filename}`;a.download=filename;return a;};
function renderOrders(element,all=false){element.replaceChildren();const items=all?orders:orders.filter(o=>o.userId===current.id);if(!items.length){element.append(el('p','아직 주문이 없습니다.','muted'));return;}for(const o of items){const card=el('article',undefined,'order'),head=el('div',undefined,'order-head');const title=el('strong',o.kind==='creative'?'상품 광고 제작':'매출 자동화 보고서');head.append(title,el('span',labels[o.status]||o.status,'status'));card.append(head,el('div',`${o.id} · ${o.priceKrw.toLocaleString('ko-KR')}원 · ${new Date(o.createdAt).toLocaleString('ko-KR')}${all?' · 고객ID '+o.userId:''}`,'desc'));
 if(o.status==='AWAITING_PAYMENT')card.append(el('p','결제 미연동: 운영자에게 입금 확인을 요청하세요.','muted-tag'));
 if(o.status==='FAILED')card.append(el('p',`작업 오류: ${o.error||'알 수 없음'}`,'error'));
 const acts=el('div',undefined,'actions');if(o.status==='DELIVERED'){acts.append(dl(o.id,'delivery.zip','결과물 ZIP 다운로드'));if(o.kind==='creative')acts.append(dl(o.id,'advertisement.mp4','MP4 다운로드'));}
 if(all && current.role==='admin'){
  if(o.status==='AWAITING_PAYMENT'){
   const input=el('input');input.placeholder='은행 입금 내역/거래번호 (직접 확인 후 입력)';input.setAttribute('aria-label','확인된 결제 증빙');acts.append(input,action('입금 확인 · 제작 시작',async()=>{if(!confirm('외부 결제 내역을 실제로 확인했습니까?'))return;await api(`/api/app/orders/${o.id}/payment`,{reference:input.value});}));
  }
  if(o.status==='FAILED')acts.append(action('실패 주문 재시도',()=>api(`/api/app/orders/${o.id}/retry`,{})));
  if(o.status==='NEEDS_REVIEW'){
   const box=el('div',undefined,'review'),checks={};
   box.append(el('strong','제작 영상 미리보기 · 승인 전 확인'));
   const help=el('p','아래 영상을 재생해 화면·자막·상품정보를 실제로 확인한 뒤 검수 항목을 선택하세요. 고객에게는 승인 전 공개되지 않습니다.','muted small');
   const video=el('video');video.controls=true;video.preload='metadata';video.playsInline=true;video.className='review-player';video.setAttribute('aria-label','검수용 광고 영상');
   video.src=`/api/app/preview/${o.id}/advertisement.mp4`;
   const fallback=el('p','영상 재생이 안 되면 새로고침 후 확인하거나 검수 영상 파일을 열어 주세요.','muted small');
   const previewLink=el('a','검수 영상 새 탭에서 열기');previewLink.href=video.src;previewLink.target='_blank';previewLink.rel='noopener noreferrer';
   box.append(help,video,previewLink,fallback,el('strong','광고 검수 및 최종 납품 승인'));
for(const [key,label]of [['rights','사진·콘텐츠 사용권 확인'],['accuracy','상품 정보·가격 검증'],['claims','과장·허위 주장 검증'],['channels','채널별 광고 표시 확인']]){const l=el('label',undefined,'checkline'),input=el('input');input.type='checkbox';checks[key]=input;l.append(input,document.createTextNode(label));box.append(l);}box.append(action('검수 승인 · ZIP 납품',async()=>{await api(`/api/app/orders/${o.id}/approve`,{checks:Object.fromEntries(Object.entries(checks).map(([k,v])=>[k,v.checked]))});}));card.append(box);
  }
 }
 card.append(acts);element.append(card);}}
async function refreshOrders(){if(!current)return;const x=await api('/api/app/orders');orders=x.orders;const total=current.role==='admin'?orders:orders.filter(o=>o.userId===current.id);$('metric-all').textContent=total.length;$('metric-work').textContent=total.filter(o=>['QUEUED','PROCESSING','NEEDS_REVIEW'].includes(o.status)).length;$('metric-done').textContent=total.filter(o=>o.status==='DELIVERED').length;renderOrders($('order-list'));if(current.role==='admin')renderOrders($('admin-orders'),true);}
$('refresh-orders').onclick=()=>refreshOrders().catch(e=>alert(e.message));
api('/api/app/health').then(x=>{$('system-health').textContent=!x.renderer.available?'영상 렌더러 설치 필요':!x.director?.ready?'ShortsAI 디렉터 연결 필요':'렌더러 · ShortsAI 경로 확인됨';}).catch(()=>{$('system-health').textContent='서버 연결 오류';});
void loadSession();if('serviceWorker'in navigator)navigator.serviceWorker.register('/app-sw.js').catch(()=>{});