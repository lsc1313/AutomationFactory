import assert from "node:assert/strict";
import {capabilityFor} from "./capabilities.js";
import {planBatch,flattenArchiveManifest,relateDocuments} from "./batch.js";

assert.equal(capabilityFor("orders.csv").mode,"native");
assert.equal(capabilityFor("supplier.xlsx").extractor,"spreadsheet_binary");
assert.equal(capabilityFor("invoice.pdf").extractor,"pdf_text_or_ocr");
assert.equal(capabilityFor("scan.webp").extractor,"image_ocr");
assert.equal(capabilityFor("bundle.zip").extractor,"archive_unpack");
assert.equal(capabilityFor("bad.exe").mode,"review");

const batch=planBatch([{name:"orders.csv",mime:"text/csv"},{name:"invoice.pdf",mime:"application/pdf"},{name:"mystery.exe"}]);
assert.equal(batch.counts.total,3);
assert.equal(batch.counts.native,1);
assert.equal(batch.counts.adapter,1);
assert.equal(batch.counts.review,1);
assert.equal(batch.status,"needs_review");

const archive=flattenArchiveManifest([{name:"orders.csv",size:10},{name:"invoices/a.pdf",size:20},{name:"folder/",directory:true}]);
assert.equal(archive.length,2);
assert.equal(archive[0].capability.mode,"native");
assert.equal(archive[1].capability.extractor,"pdf_text_or_ocr");

const links=relateDocuments([
 {file_name:"orders.csv",document_type:"order",normalized_rows:[{_row:1,order_id:"A1",sku:"S1"}]},
 {file_name:"invoice.pdf",document_type:"invoice",normalized_rows:[{_row:2,order_id:"A1",sku:"S1"}]}
]);
assert.ok(links.some(x=>x.key==="order_id:A1"&&x.refs.length===2));
assert.ok(links.some(x=>x.key==="sku:S1"&&x.refs.length===2));
console.log("UNIVERSAL INTAKE BATCH TESTS OK");
