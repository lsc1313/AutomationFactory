import assert from "node:assert/strict";
import {detectExceptions,summarizeExceptions} from "./engine.js";
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
console.log("EXCEPTION ENGINE TESTS OK");
