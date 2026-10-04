import {validateExtraction} from "../intake/extraction_adapter.js";
export function chooseExtractionProvider(route,{pcAvailable=false,cloudOcrConfigured=false}={}){
 const adapter=route?.adapter||route?.route?.adapter||"";
 if(adapter==="pdf_text")return {provider:"worker_pdf_text",cost_class:"free",mode:"text"};
 if(["pdf_ocr","image_ocr"].includes(adapter)){
  if(pcAvailable)return {provider:"pc_ocr",cost_class:"local",mode:"ocr"};
  if(cloudOcrConfigured)return {provider:"cloud_ocr",cost_class:"metered",mode:"ocr"};
  return {provider:"review_queue",cost_class:"none",mode:"manual",reason:"OCR_PROVIDER_UNAVAILABLE"};
 }
 return {provider:"review_queue",cost_class:"none",mode:"manual",reason:"EXTRACTION_ROUTE_UNSUPPORTED"};
}
export function validateProviderResult(result){
 const v=validateExtraction(result||{});
 const confidence=Number(result?.confidence??0);
 const issues=[...(v.issues||[])];
 if(confidence&&confidence<0.8)issues.push("EXTRACTION_LOW_CONFIDENCE");
 return {ok:v.ok&&issues.length===0,confidence,issues,text:result?.text||"",headers:result?.headers||[],rows:result?.rows||[]};
}
export function buildExtractionJob({job_id,file_id,name,route,options={}}){
 const selected=chooseExtractionProvider(route,options);
 return {job_id,file_id,name,provider:selected.provider,mode:selected.mode,cost_class:selected.cost_class,status:selected.provider==="review_queue"?"needs_review":"queued",reason:selected.reason||null,created_at:new Date().toISOString()};
}
