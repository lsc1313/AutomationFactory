import assert from "node:assert/strict";
import {inspectImage,ingestImageExtraction} from "./image_pipeline.js";
const png=Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
assert.equal(inspectImage(png,{name:"invoice.png"}).adapter,"image_ocr");
assert.equal(inspectImage(Uint8Array.from([1,2,3]),{name:"bad.png"}).valid,false);
const result=ingestImageExtraction({name:"invoice.png",mime:"image/png"},{
 confidence:.95,text:"Invoice Number INV-2 Supplier ACME",
 tables:[{headers:["Invoice Number","SKU","Qty","Supplier Cost"],rows:[{"Invoice Number":"INV-2","SKU":"S2","Qty":4,"Supplier Cost":20}]}]
});
assert.equal(result.normalized_rows[0].invoice_id,"INV-2");
assert.equal(result.normalized_rows[0].sku,"S2");
assert.equal(result.plan.document.document_type,"invoice");
const weak=ingestImageExtraction({name:"scan.jpg",mime:"image/jpeg"},{confidence:.3,text:""});
assert.equal(weak.plan.status,"needs_review");
console.log("IMAGE INTAKE TESTS OK");
