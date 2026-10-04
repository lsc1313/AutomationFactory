import assert from "node:assert/strict";
import {detectExceptions,summarizeExceptions,numericValue,nonBillableStatus} from "./engine.js";
const orders=[
 {order_id:"O1",sku:"A",quantity:2,unit_cost:10,status:"paid"},
 {order_id:"O2",sku:"B",quantity:1,unit_cost:20,status:"cancelled"},
 {order_id:"O3",sku:"C",quantity:3,unit_cost:5,status:"paid"}
];
const invoices=[
 {invoice_id:"I1",order_id:"O1",sku:"A",quantity:3,unit_cost:12,total:36},
 {invoice_id:"I2",order_id:"O2",sku:"B",quantity:1,unit_cost:20,total:20},
 {invoice_id:"I3",order_id:"O3",sku:"C",quantity:3,unit_cost:5,total:15},
 {invoice_id:"I3",order_id:"O3",sku:"C",quantity:3,unit_cost:5,total:15}
];
const priceList=[{sku:"A",unit_cost:10},{sku:"B",unit_cost:20},{sku:"C",unit_cost:6}];
const found=detectExceptions({orders,invoices,priceList});
for(const type of ["OVERCHARGE","QUANTITY_MISMATCH","DUPLICATE_BILLING","CANCELLED_ORDER_BILLED","SUPPLIER_COST_CHANGED"]) assert.ok(found.some(x=>x.type===type),type);
const over=found.find(x=>x.type==="OVERCHARGE");assert.equal(over.expected,10);assert.equal(over.actual,12);assert.equal(over.difference,6);assert.equal(over.confidence,1);
const sum=summarizeExceptions(found);assert.ok(sum.money_exposure>=41);assert.equal(sum.by_type.OVERCHARGE,1);
assert.equal(numericValue("₩12,500"),12500);
assert.equal(numericValue("$1,234.50"),1234.5);
assert.equal(numericValue("12 500"),12500);
assert.equal(numericValue("(3,000)"),-3000);
assert.equal(numericValue("(3)",{accountingNegative:false}),3);
assert.equal(numericValue("1,250원"),1250);
const formatted=detectExceptions({orders:[{order_id:"F1",sku:"S1",quantity:"2",unit_cost:"₩10,000"}],invoices:[{order_id:"F1",sku:"S1",quantity:"2",unit_cost:"₩11,500",total:"₩23,000"}]});
assert.equal(formatted.find(x=>x.type==="OVERCHARGE")?.difference,3000);
for(const s of ["cancelled","canceled","void","voided","fully refunded","returned","취소완료","전액환불","반품완료"]) assert.equal(nonBillableStatus(s),true,s);
for(const s of ["paid","fulfilled","partial refund","partially refunded","부분환불","일부 반품"]) assert.equal(nonBillableStatus(s),false,s);
const refunded=detectExceptions({orders:[{order_id:"R1",sku:"S1",quantity:1,status:"fully refunded"}],invoices:[{order_id:"R1",sku:"S1",quantity:1,total:5000}]});
assert.ok(refunded.some(x=>x.type==="CANCELLED_ORDER_BILLED"));
const partial=detectExceptions({orders:[{order_id:"R2",sku:"S2",quantity:1,status:"partial refund"}],invoices:[{order_id:"R2",sku:"S2",quantity:1,total:5000}]});
assert.ok(!partial.some(x=>x.type==="CANCELLED_ORDER_BILLED"));
const crossInvoice=detectExceptions({orders:[{order_id:"D1",sku:"S1",quantity:1}],invoices:[{invoice_id:"INV-1",order_id:"D1",sku:"S1",quantity:1,unit_cost:5000,total:5000},{invoice_id:"INV-2",order_id:"D1",sku:"S1",quantity:1,unit_cost:5000,total:5000}]});
assert.ok(crossInvoice.some(x=>x.type==="POSSIBLE_DUPLICATE_BILLING"));
assert.equal(summarizeExceptions(crossInvoice).money_exposure,0);
console.log("EXCEPTION ENGINE TESTS OK");
