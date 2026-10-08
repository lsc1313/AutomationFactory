const LABELS={
 OVERCHARGE:"Potential price overcharge",QUANTITY_MISMATCH:"Quantity mismatch",
 DUPLICATE_BILLING:"Potential duplicate billing",CANCELLED_ORDER_BILLED:"Cancelled order billed",
 SUPPLIER_COST_CHANGED:"Supplier cost changed"
};
function money(v,currency){return {amount:Number(Number(v||0).toFixed(2)),currency:currency||"UNSPECIFIED"}}
export function buildEvidenceReport(auditResult,{currency="UNSPECIFIED",scanMode="free"}={}){
 const exceptions=(auditResult.exceptions||[]).map((e,i)=>({
  id:`EX-${String(i+1).padStart(4,"0")}`,
  type:e.type,label:LABELS[e.type]||e.type,
  finding:"potential_discrepancy",recommendation:"review_recommended",
  order_id:e.order_id||"",sku:e.sku||"",
  expected:e.expected,actual:e.actual,difference:e.difference,
  potential_leakage:money(["OVERCHARGE","DUPLICATE_BILLING","CANCELLED_ORDER_BILLED"].includes(e.type)?Math.max(0,Number(e.difference||0)):0,currency),
  reason:e.reason||"",evidence:e.evidence||[],confidence:e.confidence??null
 }));
 const typeCounts={};for(const e of exceptions)typeCounts[e.type]=(typeCounts[e.type]||0)+1;
 const review=(auditResult.review_queue||[]).map((r,i)=>({
  id:`RV-${String(i+1).padStart(4,"0")}`,order_id:r.order_id||"",sku:r.sku||"",
  status:r.status,reason:r.reason,confidence:r.confidence,candidate_count:(r.candidates||[]).length
 }));
 return {
  report_version:"1.0",report_type:"supplier_leak_scan",scan_mode:scanMode,
  disclaimer:"Potential discrepancies are automated review signals, not definitive billing or accounting conclusions.",
  headline:{
   transactions_checked:auditResult.audit?.verified_invoice_lines||0,
   input_lines:auditResult.audit?.total_invoice_lines||0,
   potential_discrepancies:exceptions.length,
   potential_money_exposure:money(auditResult.audit?.money_exposure||0,currency),
   human_review_required:review.length
  },
  findings_by_type:typeCounts,findings:exceptions,review_queue:review,
  controls:{confirmed_matches_only:auditResult.policy?.confirmed_matches_only===true,fuzzy_matches_excluded_from_money:auditResult.policy?.fuzzy_matches_used_for_money_calculation===false}
 };
}
export function buildFreeScanSummary(report,{detailLimit=3}={}){
 return {
  report_type:report.report_type,scan_mode:"free",
  headline:report.headline,findings_by_type:report.findings_by_type,
  sample_findings:report.findings.slice(0,detailLimit).map(x=>({type:x.type,label:x.label,order_id:x.order_id,sku:x.sku,potential_leakage:x.potential_leakage,recommendation:x.recommendation})),
  hidden_finding_count:Math.max(0,report.findings.length-detailLimit),
  review_required:report.review_queue.length,
  disclaimer:report.disclaimer
 };
}
