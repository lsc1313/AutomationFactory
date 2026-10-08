import {finalizeExtraction} from "../extraction/extraction_bridge.js";import {runBatchSupplierScan} from "../scan/scan_pipeline.js";
function roleType(role){return role==="orders"?"order":role==="invoices"?"invoice":role==="priceList"?"price_list":""}
export function mergeDirectAndExtracted({direct_files=[],extracted_files=[]}={}){
 const out=[...direct_files];for(const x of extracted_files){const finalized=finalizeExtraction({file:{name:x.name||"file"},result:x.result||{}}),forced=roleType(x.role);out.push({file_name:x.name||"",document_type:forced||finalized.document_type||"unknown",status:forced&&finalized.normalized_rows?.length?"ready":finalized.status,normalized_rows:finalized.normalized_rows||[],issues:finalized.issues||[]})}return out
}
export function runMixedScan(input={},options={}){const files=mergeDirectAndExtracted(input);return runBatchSupplierScan(files,{scanMode:"free",currency:options.currency||"UNSPECIFIED"})}
