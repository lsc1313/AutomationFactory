import { randomBytes } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { writeCreativePack, validateProduct } from './core.mjs';
import { writeSalesReport } from './report.mjs';
import { createJobRecord, approveJob, zipJob, getJob, saveJob } from './workflow.mjs';
import { renderStatus, renderVideo } from './render.mjs';
const uuid=()=>`ord_${randomBytes(12).toString('hex')}`;
export const PRODUCTS={creative:{title:'상품 광고 패키지',price:49000,description:'상품 이미지 시안 3장, 25초 세로 MP4, 카피·스토리보드'},report:{title:'매출 보고서',price:30000,description:'CSV 매출 정리, 상품별 집계, 보고서 및 ZIP'}};
const ISO=()=>new Date().toISOString();
const validOrderId=id=>{if(!/^ord_[a-f0-9]{24}$/.test(id||''))throw new Error('올바른 주문번호가 아닙니다.');return id;};
export function visibleOrder(order,user){if(!order||(!['admin'].includes(user.role)&&order.userId!==user.id))throw new Error('접근 권한이 없습니다.');return order;}
export async function createOrder(store,{user,kind,input,idempotencyKey}){
 if(!PRODUCTS[kind])throw new Error('지원되지 않는 상품입니다.');
 if(idempotencyKey!=null&&(typeof idempotencyKey!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(idempotencyKey)))throw new Error('잘못된 중복 요청 키입니다.');
 if(kind==='creative')validateProduct(input);
 if(kind==='report' && (typeof input?.csv!=='string'||input.csv.length>500_000))throw new Error('CSV는 500KB 이하의 텍스트여야 합니다.');
 const now=ISO();
 return store.transaction(db=>{
  const prev=db.orders.find(o=>o.userId===user.id&&idempotencyKey&&o.idempotencyKey===idempotencyKey);
  if(prev){if(prev.kind!==kind)throw new Error('같은 요청 키에 다른 상품을 사용할 수 없습니다.');return {...prev,duplicated:true};}
  const order={id:uuid(),userId:user.id,kind,priceKrw:PRODUCTS[kind].price,status:'AWAITING_PAYMENT',paymentStatus:'UNPAID',createdAt:now,updatedAt:now,brief:input,idempotencyKey:idempotencyKey||null,jobId:null,error:null};
  db.orders.push(order);return order;
 });
}
export async function listOrders(store,user){const db=await store.read();return db.orders.filter(o=>user.role==='admin'||o.userId===user.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(({brief,...rest})=>rest);}
export async function getOrder(store,user,id){const db=await store.read();return visibleOrder(db.orders.find(o=>o.id===validOrderId(id)),user);}
export async function recordPayment(store,admin,id,reference){if(admin.role!=='admin')throw new Error('운영자만 결제를 확인할 수 있습니다.');if(typeof reference!=='string'||reference.trim().length<3||reference.length>150)throw new Error('결제 증빙 문자열을 입력하세요.');return store.transaction(db=>{const o=db.orders.find(o=>o.id===validOrderId(id));if(!o)throw new Error('주문을 찾을 수 없습니다.');if(o.paymentStatus==='PAID')return o;if(o.status!=='AWAITING_PAYMENT')throw new Error('입금 대기 주문이 아닙니다.');o.paymentStatus='PAID';o.status='QUEUED';o.updatedAt=ISO();db.payments.push({orderId:id,amountKrw:o.priceKrw,verifiedBy:admin.id,reference:reference.trim(),verifiedAt:ISO(),method:'manual-confirmation'});return o;});}
export async function flagOrderFailed(store,id,error){return store.transaction(db=>{const o=db.orders.find(o=>o.id===id);if(!o)return null;o.status='FAILED';o.error=String(error).slice(0,300);o.updatedAt=ISO();return o;});}
export async function runOrder(store,outputRoot,id){
 const current=(await store.read()).orders.find(o=>o.id===id);
 if(!current||current.status!=='QUEUED'||current.paymentStatus!=='PAID')return null;
 await store.transaction(db=>{const o=db.orders.find(x=>x.id===id);if(o.status==='QUEUED'){o.status='PROCESSING';o.updatedAt=ISO();}});
 try{
  const result=current.kind==='creative' ? await writeCreativePack(current.brief,outputRoot) : await writeSalesReport(current.brief.csv,outputRoot);
  let job=await createJobRecord(outputRoot,result,current.kind);
  if(current.kind==='creative'){
   const status=await renderStatus();if(!status.available)throw new Error(status.reason);
   const brief=JSON.parse(await readFile(path.join(outputRoot,result.job,'brief.json'),'utf8'));
   const video=await renderVideo(path.join(outputRoot,result.job),brief);
   job=await saveJob(outputRoot,result.job,{...job,id:undefined,files:[...job.files,video.filename],video});
  } else await zipJob(outputRoot,result.job);
  return store.transaction(db=>{const o=db.orders.find(x=>x.id===id);o.jobId=result.job;o.status=current.kind==='creative'?'NEEDS_REVIEW':'DELIVERED';o.updatedAt=ISO();o.brief=null;return o;});
 }catch(err){await flagOrderFailed(store,id,err.message);return null;}
}
export async function approveOrder(store,outputRoot,admin,id,checks){if(admin.role!=='admin')throw new Error('운영자만 승인할 수 있습니다.');const order=await getOrder(store,admin,id);if(order.status!=='NEEDS_REVIEW'||!order.jobId)throw new Error('검수 대기 중인 주문만 승인 가능합니다.');await approveJob(outputRoot,order.jobId,checks);await zipJob(outputRoot,order.jobId);return store.transaction(db=>{const o=db.orders.find(x=>x.id===id);o.status='DELIVERED';o.updatedAt=ISO();o.deliveredAt=o.updatedAt;return o;});}
export async function retryOrder(store,admin,id){if(admin.role!=='admin')throw new Error('운영자만 재시도할 수 있습니다.');return store.transaction(db=>{const o=db.orders.find(x=>x.id===validOrderId(id));if(!o||o.status!=='FAILED'||o.paymentStatus!=='PAID')throw new Error('실패한 결제 완료 주문만 재시도할 수 있습니다.');o.status='QUEUED';o.error=null;o.updatedAt=ISO();return o;});}
export async function productFilePath(store,outputRoot,user,id,filename){const o=await getOrder(store,user,id);if(o.status!=='DELIVERED'||!o.jobId)throw new Error('아직 납품 가능한 주문이 아닙니다.');if(!['delivery.zip','advertisement.mp4','report.html'].includes(filename))throw new Error('해당 파일은 다운로드할 수 없습니다.');const job=await getJob(outputRoot,o.jobId);if(!job)throw new Error('작업이 없습니다.');return path.resolve(outputRoot,o.jobId,filename);}
export async function createCustomer(store,admin,email,password){if(admin.role!=='admin')throw new Error('운영자만 고객 계정을 만들 수 있습니다.');return store.createUser(email,password,'customer');}
// Operator-only preview. Never reuse customer delivery authorization for unapproved material.
export async function previewVideoPath(store,outputRoot,user,id){
 if(user.role!=='admin')throw new Error('운영자만 검수 영상을 볼 수 있습니다.');
 const order=await getOrder(store,user,id);
 if(order.kind!=='creative'||!order.jobId||order.status!=='NEEDS_REVIEW')throw new Error('광고 검수 대기 중에만 영상을 미리 볼 수 있습니다.');
 const job=await getJob(outputRoot,order.jobId);
 if(job.kind!=='creative'||!job.files?.includes('advertisement.mp4'))throw new Error('영상 파일이 존재하지 않습니다.');
 return path.resolve(outputRoot,order.jobId,'advertisement.mp4');
}
