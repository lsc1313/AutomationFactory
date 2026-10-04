import {runSupplierAudit} from "../audit/supplier_audit.js";import {buildEvidenceReport,buildFreeScanSummary} from "../report/evidence_report.js";
const ROLE={order:"orders",purchase_order:"orders",invoice:"invoices",price_list:"priceList"};
export function assembleAuditInputs(files=[]){
 const out={orders:[],invoices:[],priceList:[]},review=[];for(const f of files){const type=f.document_type||f.intake?.plan?.document?.document_type||"unknown",status=f.status||f.intake?.plan?.status||"needs_review",rows=f.normalized_rows||f.intake?.normalized_rows||[];const role=ROLE[type];
  if(status!=="ready"||!role||!rows.length){review.push({file_name:f.file_name||f.name||"",document_type:type,status,reason:!role?"UNSUPPORTED_AUDIT_ROLE":!rows.length?"NO_STRUCTURED_ROWS":"FILE_REQUIRES_REVIEW"});continue}
  out[role].push(...rows.map(r=>({...r,_source_file:f.file_name||f.name||""})));
 }
 return {...out,review};
}
export function runBatchSupplierScan(files=[],options={}){
 const assembled=assembleAuditInputs(files);if(!assembled.orders.length||!assembled.invoices.length)return {status:"review_required",reason:"ORDERS_AND_INVOICES_REQUIRED",assembled,report:null,free_summary:null};
 const audit=runSupplierAudit(assembled,options),report=buildEvidenceReport(audit,{currency:options.currency||"UNSPECIFIED",scanMode:options.scanMode||"free"});return {status:assembled.review.length||audit.status==="review_required"?"review_required":"complete",assembled:{counts:{orders:assembled.orders.length,invoices:assembled.invoices.length,priceList:assembled.priceList.length},review:assembled.review},audit,report,free_summary:buildFreeScanSummary(report,{detailLimit:options.detailLimit??3})};
}
