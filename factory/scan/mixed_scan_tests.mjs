import assert from "node:assert/strict";
import {mergeDirectAndExtracted,runMixedScan} from "./mixed_scan.js";

const files=mergeDirectAndExtracted({
  direct_files:[{file_name:"orders.csv",document_type:"order",status:"ready",normalized_rows:[{order_id:"A1",sku:"S1",quantity:1,unit_price:10}]}],
  extracted_files:[{name:"invoice.pdf",role:"invoices",result:{text:"Invoice A1 S1",confidence:.99,tables:[{headers:["Order ID","SKU","Qty","Unit Price"],rows:[["A1","S1","1","12"]]}]}}]
});
assert.equal(files.length,2);
assert.equal(files[0].document_type,"order");
assert.equal(files[1].document_type,"invoice");
assert.ok(files[1].normalized_rows.length);

const regression=runMixedScan({
  direct_files:[
    {file_name:"orders.csv",document_type:"order",status:"ready",normalized_rows:[
      {order_id:"A1001",sku:"TISSUE-01",quantity:2,unit_price:10000,status:"paid"},
      {order_id:"A1002",sku:"WIPES-01",quantity:3,unit_price:5000,status:"paid"},
      {order_id:"A1003",sku:"WATER-01",quantity:1,unit_price:8000,status:"cancelled"},
      {order_id:"A1004",sku:"TOWEL-01",quantity:2,unit_price:6000,status:"paid"},
      {order_id:"A1005",sku:"SOAP-01",quantity:1,unit_price:10000,status:"paid"}
    ]},
    {file_name:"supplier_price_list.csv",document_type:"price_list",status:"ready",normalized_rows:[
      {sku:"TISSUE-01",unit_cost:10000},{sku:"WIPES-01",unit_cost:5000},{sku:"WATER-01",unit_cost:8000},{sku:"TOWEL-01",unit_cost:6000},{sku:"SOAP-01",unit_cost:10000}
    ]}
  ],
  extracted_files:[{name:"supplier_invoice_ocr.pdf",role:"invoices",result:{
    text:"Supplier invoice",
    confidence:.99,
    tables:[{headers:["order_id","sku","qty","unit_price","line_total"],rows:[
      ["A1001","TISSUE-O1","2","11500","23000"],
      ["A1002","WIPES-01","4","5000","20000"],
      ["A1003","WATER-O1","1","8000","8000"],
      ["A1004","TOWEL-O1","2","6000","12000"],
      ["A1004","TOWEL-0O1","2","6000","12000"],
      ["A1005","SOAP-01","1","12000","12000"]
    ]}]
  }}]
},{currency:"KRW"});

assert.equal(regression.audit.audit.verified_invoice_lines,6);
assert.equal(regression.audit.review_queue.length,0);
assert.equal(regression.audit.audit.money_exposure,25000);
assert.equal(regression.audit.audit.exception_count,5);
assert.equal(regression.free_summary.headline.transactions_checked,6);\nassert.equal(regression.free_summary.headline.potential_discrepancies,5);\nassert.equal(regression.free_summary.headline.potential_money_exposure.amount,25000);\nassert.equal(regression.free_summary.headline.human_review_required,0);

console.log("MIXED SCAN TESTS OK");
