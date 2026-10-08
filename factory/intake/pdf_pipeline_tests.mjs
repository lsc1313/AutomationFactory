import assert from "node:assert/strict";
import {inspectPdf,routePdf,ingestPdfExtraction} from "./pdf_pipeline.js";
const enc=new TextEncoder();
const textPdf=enc.encode("%PDF-1.7\n1 0 obj << /Type /Page >> endobj\nstream\nBT /F1 12 Tf (Invoice) Tj ET\nendstream\n%%EOF");
const scanPdf=enc.encode("%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Subtype /Image >> endobj\n%%EOF");
assert.equal(inspectPdf(textPdf).mode,"text_extract");
assert.equal(routePdf(textPdf).adapter,"pdf_text");
assert.equal(inspectPdf(scanPdf).mode,"ocr_required");
assert.equal(routePdf(scanPdf).adapter,"pdf_ocr");
assert.equal(inspectPdf(enc.encode("not pdf")).valid,false);

const extracted=ingestPdfExtraction({name:"supplier_invoice.pdf",mime:"application/pdf"},{
 confidence:.96,
 text:"Invoice Number INV-9 Supplier ACME",
 tables:[{headers:["Invoice Number","SKU","Qty","Supplier Cost"],rows:[{"Invoice Number":"INV-9","SKU":"S1","Qty":2,"Supplier Cost":12.5}]}]
});
assert.equal(extracted.normalized_rows[0].invoice_id,"INV-9");
assert.equal(extracted.normalized_rows[0].sku,"S1");
assert.equal(extracted.normalized_rows[0].quantity,2);
assert.equal(extracted.plan.document.document_type,"invoice");

const weak=ingestPdfExtraction({name:"scan.pdf",mime:"application/pdf"},{confidence:.4,text:""});
assert.equal(weak.plan.status,"needs_review");
assert.ok(weak.plan.issues.some(x=>x.code==="PDF_EXTRACTION_LOW_CONFIDENCE"));
console.log("PDF ROUTING TESTS OK");
