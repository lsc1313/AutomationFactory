import assert from "node:assert/strict";
import {ingestArchive} from "./archive_pipeline.js";
function le16(n){return Uint8Array.of(n&255,(n>>8)&255)}
function le32(n){return Uint8Array.of(n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255)}
function cat(...p){const n=p.reduce((s,x)=>s+x.length,0),o=new Uint8Array(n);let i=0;for(const x of p){o.set(x,i);i+=x.length}return o}
function zipStored(files){const e=new TextEncoder(),locals=[],centrals=[];let off=0;for(const [name,body] of files){const n=e.encode(name),d=body instanceof Uint8Array?body:e.encode(body);const l=cat(le32(0x04034b50),le16(20),le16(0),le16(0),le16(0),le16(0),le32(0),le32(d.length),le32(d.length),le16(n.length),le16(0),n,d);locals.push(l);centrals.push(cat(le32(0x02014b50),le16(20),le16(20),le16(0),le16(0),le16(0),le16(0),le32(0),le32(d.length),le32(d.length),le16(n.length),le16(0),le16(0),le16(0),le16(0),le32(0),le32(off),n));off+=l.length}const cd=cat(...centrals);return cat(...locals,cd,le32(0x06054b50),le16(0),le16(0),le16(files.length),le16(files.length),le32(cd.length),le32(off),le16(0))}
const pdf=new TextEncoder().encode("%PDF-1.7\\n1 0 obj << /Type /Page >> endobj\\nstream\\nBT /F1 12 Tf (Invoice) Tj ET\\nendstream\\n%%EOF");
const bundle=zipStored([["orders.csv","Order ID,SKU,Qty,Supplier Cost\nA1,S1,2,10"],["invoice.pdf",pdf]]);
const result=await ingestArchive(bundle,{name:"customer_bundle.zip"});
assert.equal(result.counts.total,2);
assert.equal(result.files.find(x=>x.name==="orders.csv").result.normalized_rows[0].sku,"S1");
const pdfFile=result.files.find(x=>x.name==="invoice.pdf");
assert.equal(pdfFile.route.valid,true);
assert.ok(["pdf_text","pdf_ocr"].includes(pdfFile.route.adapter));
assert.equal(pdfFile.status,"awaiting_extraction");
assert.equal(result.status,"needs_review");
assert.equal(result.counts.awaiting,1);
assert.equal(result.counts.review,1);
console.log("ARCHIVE INTAKE TESTS OK");
