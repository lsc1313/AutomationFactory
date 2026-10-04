import assert from "node:assert/strict";
import {runSupplierAudit} from "./supplier_audit.js";
const orders=[
 {order_id:"O-1",sku:"SKU-1",quantity:2,unit_cost:10,status:"paid"},
 {order_id:"O-2",sku:"SKU-2",quantity:1,unit_cost:20,status:"cancelled"},
 {order_id:"O-3",sku:"ABC-999",quantity:1,unit_cost:30,status:"paid"}
];
const invoices=[
 {invoice_id:"I-1",order_id:"O-1",sku:"SKU-1",quantity:2,unit_cost:12,total:24},
 {invoice_id:"I-2",order_id:"O-2",sku:"SKU-2",quantity:1,unit_cost:20,total:20},
 {invoice_id:"I-3",order_id:"",sku:"ABC999X",description:"special item",quantity:1,unit_cost:99,total:99}
];
const priceList=[{sku:"SKU-1",unit_cost:10},{sku:"SKU-2",unit_cost:20},{sku:"ABC-999",unit_cost:30}];
const r=runSupplierAudit({orders,invoices,priceList},{candidateThreshold:.2});
assert.equal(r.status,"review_required");
assert.equal(r.audit.verified_invoice_lines,2);
assert.equal(r.audit.total_invoice_lines,3);
assert.equal(r.matching.confirmed,2);
assert.equal(r.review_queue.length,1);
assert.equal(r.policy.fuzzy_matches_used_for_money_calculation,false);
assert.ok(r.exceptions.some(x=>x.type==="OVERCHARGE"));
assert.ok(r.exceptions.some(x=>x.type==="CANCELLED_ORDER_BILLED"));
assert.equal(r.audit.money_exposure,24);
assert.ok(!r.exceptions.some(x=>x.order_id===""&&x.sku==="ABC999X"));
console.log("SUPPLIER AUDIT PIPELINE TESTS OK");
