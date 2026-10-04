import {handlePcWorkerApi} from "./pc_worker.js";
import {ingestUploadedFiles} from "./upload.js";
import {runSupplierAudit} from "../audit/supplier_audit.js";
import {buildEvidenceReport,buildFreeScanSummary} from "../report/evidence_report.js";

function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
export async function handleFactoryApi(request,path,env){
 if(path.startsWith("/api/factory/pc-worker/"))return await handlePcWorkerApi(request,path,env);
 if(path==="/api/factory/upload"&&request.method==="POST"){const r=await ingestUploadedFiles(request);return response(r,r.status||200)}
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
