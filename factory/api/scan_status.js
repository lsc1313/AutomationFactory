import {getExtractions} from "../extraction/queue.js";import {runBatchSupplierScan} from "../scan/scan_pipeline.js";
function parse(v){try{return JSON.parse(v||"{}")}catch{return {}}}
export async function scanStatus(db,ids=[],options={}){
 const jobs=await getExtractions(db,ids);const counts={queued:0,claimed:0,completed:0,failed:0};for(const j of jobs)counts[j.status]=(counts[j.status]||0)+1;
 const pending=jobs.some(j=>j.status==="queued"||j.status==="claimed"),failed=jobs.filter(j=>j.status==="failed").map(j=>({id:j.extraction_job_id,error:j.error_text||"extraction_failed"}));
 const files=jobs.filter(j=>j.status==="completed").map(j=>{const r=parse(j.result_json),x=r.intake||{};return {file_name:j.source_ref?.split("/").pop()||j.intake_file_id,document_type:x.document_type||"unknown",status:x.status||"needs_review",normalized_rows:x.normalized_rows||[],issues:x.issues||[]}});
 const scan=!pending&&files.length?runBatchSupplierScan(files,options):null;return {status:pending?"processing":failed.length?"review_required":scan?.status||"ready",counts,failed,files,scan};
}
