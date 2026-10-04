import assert from "node:assert/strict";
import {detectFileKind,classifyDocument,mapHeaders,buildIntakePlan,normalizeRows} from "./intake.js";

assert.equal(detectFileKind("supplier.xlsx").kind,"spreadsheet");
assert.equal(detectFileKind("scan.PDF").kind,"pdf");
assert.equal(detectFileKind("bundle.zip").kind,"archive");
assert.equal(detectFileKind("unknown.bin").supported,false);

assert.equal(classifyDocument({name:"supplier_invoice.pdf",text:"Invoice Number INV-1 Amount Due"}).document_type,"invoice");
assert.equal(classifyDocument({name:"PO-10.pdf",text:"Purchase Order PO Number 10"}).document_type,"purchase_order");
assert.equal(classifyDocument({name:"refund.csv",headers:["Order ID","Refund Amount"]}).document_type,"refund");
assert.equal(classifyDocument({name:"supplier_price_list.xlsx",headers:["SKU","Unit Cost"]}).document_type,"price_list");

const en=mapHeaders(["Order ID","SKU","Qty","Supplier Cost","Invoice Number"]);
assert.equal(en.fields.order_id.source_header,"Order ID");
assert.equal(en.fields.sku.source_header,"SKU");
assert.equal(en.fields.quantity.source_header,"Qty");
assert.equal(en.fields.unit_cost.source_header,"Supplier Cost");
assert.equal(en.fields.invoice_id.source_header,"Invoice Number");

const ko=mapHeaders(["주문번호","상품코드","주문수량","공급가","거래처"]);
assert.equal(ko.fields.order_id.source_header,"주문번호");
assert.equal(ko.fields.sku.source_header,"상품코드");
assert.equal(ko.fields.quantity.source_header,"주문수량");
assert.equal(ko.fields.unit_cost.source_header,"공급가");
assert.equal(ko.fields.supplier.source_header,"거래처");

const plan=buildIntakePlan({name:"invoice.xlsx",mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},{text:"Invoice Number",headers:["Invoice Number","SKU","Qty","Unit Cost","Total"]});
assert.equal(plan.file.kind,"spreadsheet");
assert.equal(plan.document.document_type,"invoice");
assert.equal(plan.status,"ready");

const orderPlan=buildIntakePlan({name:"orders.csv",mime:"text/csv"},{headers:["order_id","sku","qty","unit_price","status"]});assert.equal(orderPlan.status,"ready");assert.ok(orderPlan.mapping.confidence>=.7);\n\nconst normalized=normalizeRows([{"주문번호":"A-1","상품코드":"S-1","주문수량":2,"공급가":1000}],ko);
assert.equal(normalized[0].order_id,"A-1");
assert.equal(normalized[0].sku,"S-1");
assert.equal(normalized[0].quantity,2);
assert.equal(normalized[0].unit_cost,1000);

const uncertain=buildIntakePlan({name:"mystery.bin"},{text:"hello"});
assert.equal(uncertain.status,"needs_review");
assert.ok(uncertain.issues.some(x=>x.code==="UNSUPPORTED_FILE"));

console.log("UNIVERSAL INTAKE TESTS OK");
