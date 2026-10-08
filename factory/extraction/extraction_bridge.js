import {ingestPdfExtraction} from "../intake/pdf_pipeline.js";import {ingestImageExtraction} from "../intake/image_pipeline.js";
function ext(name){return String(name||"").toLowerCase().split(".").pop()}
export function finalizeExtraction({file={},result={}}={}){
 const e=ext(file.name);let intake;
 if(e==="pdf")intake=ingestPdfExtraction(file,result);
 else if(["png","jpg","jpeg","webp"].includes(e))intake=ingestImageExtraction(file,result);
 else return {status:"needs_review",issues:[{code:"EXTRACTION_FILE_KIND_UNSUPPORTED",severity:"review"}],intake:null};
 const issues=[...(intake.plan?.issues||[])];
 if(!Array.isArray(result.tables)||!result.tables.some(t=>Array.isArray(t?.headers)&&Array.isArray(t?.rows)))issues.push({code:"STRUCTURED_TABLE_EXTRACTION_REQUIRED",severity:"review"});
 return {status:issues.length?"needs_review":"ready",document_type:intake.plan?.document?.document_type||"unknown",confidence:intake.plan?.confidence||0,normalized_rows:intake.normalized_rows||[],issues,intake:{...intake,plan:{...intake.plan,issues,status:issues.length?"needs_review":"ready"}}};
}
