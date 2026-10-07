import {runMixedScan} from "../scan/mixed_scan.js";
import {issueUploadTicket} from "../pc-worker/upload_ticket.js";
import {pcStatus} from "../pc-worker/heartbeat.js";
import {scanStatus} from "./scan_status.js";
import {ensureFactorySchema} from "../intake/ensure_schema.js";
import {scanUploadedFiles} from "./scan.js";
import {handlePcWorkerApi} from "./pc_worker.js";
import {ingestUploadedFiles} from "./upload.js";
import {runSupplierAudit} from "../audit/supplier_audit.js";
import {buildEvidenceReport,buildFreeScanSummary} from "../report/evidence_report.js";

function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function factoryAuthorized(request,env){
 const required=String(env?.FACTORY_ACCESS_KEY||"").trim();
 if(!required)return true;
 const supplied=String(request.headers.get("x-factory-key")||"").trim();
 return supplied.length===required.length&&supplied===required;
}
export async function handleFactoryApi(request,path,env){
 if(env?.DB)await ensureFactorySchema(env.DB);
 if(!factoryAuthorized(request,env))return response({ok:false,error:"factory_unauthorized"},401);
 if(path.startsWith("/api/factory/pc-worker/"))return await handlePcWorkerApi(request,path,env);
 if(path==="/api/factory/mixed-scan"&&request.method==="POST"){let b;try{b=await request.json()}catch{return response({ok:false,error:"invalid_json"},400)}const direct=Array.isArray(b.direct_files)?b.direct_files:[],extracted=Array.isArray(b.extracted_files)?b.extracted_files:[];if(direct.length+extracted.length>20)return response({ok:false,error:"too_many_files"},413);const scan=runMixedScan({direct_files:direct,extracted_files:extracted},{currency:b.currency});return response({ok:true,scan})}
 if(path==="/api/factory/scan/status"&&request.method==="POST"){let b;try{b=await request.json()}catch{return response({ok:false,error:"invalid_json"},400)}const ids=Array.isArray(b?.extraction_job_ids)?b.extraction_job_ids.filter(Boolean).slice(0,20):[];if(!ids.length)return response({ok:false,error:"extraction_job_ids_required"},400);return response({ok:true,...await scanStatus(env.DB,ids,{currency:b?.currency||"UNSPECIFIED",scanMode:"free"})})}
 if(path==="/api/factory/scan"&&request.method==="POST"){const r=await scanUploadedFiles(request,env);return response(r,r.status||200)}
 if(path==="/api/factory/upload"&&request.method==="POST"){const r=await ingestUploadedFiles(request,env);return response(r,r.status||200)}
 if(path==="/api/factory/pc-upload-ticket"&&request.method==="POST"){const state=await pcStatus(env.DB,{worker_id:"home-pc"});if(state.status!=="online")return response({ok:false,error:"pc_offline"},409);const b=await request.json().catch(()=>({}));const t=await issueUploadTicket(env.DB,{worker_id:"home-pc",file_name:String(b.file_name||"").slice(0,180)});return response({ok:true,...t})}
 if(path==="/api/factory/pc-status"&&request.method==="GET")return response({ok:true,...await pcStatus(env.DB,{worker_id:"home-pc"})});
 if(path==="/api/factory/health"&&request.method==="GET")return response({ok:true,factory:"universal-intake",version:"1"});
 if(path==="/api/factory/audit"&&request.method==="POST"){
  let body;try{body=await request.json()}catch{return response({ok:false,error:"invalid_json"},400)}
  const orders=Array.isArray(body?.orders)?body.orders:[],invoices=Array.isArray(body?.invoices)?body.invoices:[],priceList=Array.isArray(body?.priceList)?body.priceList:[];
  if(!invoices.length)return response({ok:false,error:"invoices_required"},400);
  if(orders.length+invoices.length+priceList.length>5000)return response({ok:false,error:"payload_too_large",next:"use_batch_upload"},413);
  const audit=runSupplierAudit({orders,invoices,priceList,confirmedMappings:body?.confirmedMappings||{}},{candidateThreshold:body?.candidateThreshold});
  const report=buildEvidenceReport(audit,{currency:body?.currency||"UNSPECIFIED",scanMode:body?.scanMode||"free"});
  return response({ok:true,audit,report,free_summary:buildFreeScanSummary(report,{detailLimit:body?.detailLimit??3})});
 }
 return null;
}
