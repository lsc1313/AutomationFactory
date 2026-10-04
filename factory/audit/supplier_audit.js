import {matchDataset} from "../matching/engine.js";
import {detectExceptions,summarizeExceptions} from "../exceptions/engine.js";

export function runSupplierAudit({orders=[],invoices=[],priceList=[],confirmedMappings={}}={},options={}){
 const matching=matchDataset(invoices,orders,{confirmedMappings,candidateThreshold:options.candidateThreshold??.55});
 const confirmed=matching.results.filter(x=>x.status==="confirmed");
 const review_queue=matching.results.filter(x=>x.status!=="confirmed").map(x=>({
  source_index:x.source_index,order_id:x.source.order_id||"",sku:x.source.sku||"",
  status:x.status,method:x.method,confidence:x.confidence,candidates:x.candidates||[],
  reason:x.status==="needs_review"?"ambiguous match requires human confirmation":"no safe match found"
 }));
 const safeInvoices=confirmed.map(x=>x.source);
 const safeOrderKeys=new Set(confirmed.map(x=>[String(x.target.order_id||""),String(x.target.sku||"")].join("::")));
 const safeOrders=orders.filter(o=>safeOrderKeys.has([String(o.order_id||""),String(o.sku||"")].join("::")));
 const exceptions=detectExceptions({orders:safeOrders,invoices:safeInvoices,priceList},options);
 const summary=summarizeExceptions(exceptions);
 return {
  status:review_queue.length?"review_required":"complete",
  audit:{...summary,verified_invoice_lines:safeInvoices.length,total_invoice_lines:invoices.length},
  matching:matching.summary,
  exceptions,
  review_queue,
  policy:{fuzzy_matches_used_for_money_calculation:false,confirmed_matches_only:true}
 };
}
