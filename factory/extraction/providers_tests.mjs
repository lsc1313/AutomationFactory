import assert from "node:assert/strict";import {chooseExtractionProvider,validateProviderResult,buildExtractionJob} from "./providers.js";
assert.equal(chooseExtractionProvider({adapter:"pdf_text"}).provider,"worker_pdf_text");
assert.equal(chooseExtractionProvider({adapter:"image_ocr"},{pcAvailable:true}).provider,"pc_ocr");
assert.equal(chooseExtractionProvider({adapter:"pdf_ocr"},{cloudOcrConfigured:true}).provider,"cloud_ocr");
assert.equal(chooseExtractionProvider({adapter:"image_ocr"}).provider,"review_queue");
const low=validateProviderResult({text:"invoice",confidence:.6,headers:["sku"],rows:[{sku:"A"}]});assert.equal(low.ok,false);assert.ok(low.issues.includes("EXTRACTION_LOW_CONFIDENCE"));
const j=buildExtractionJob({job_id:"J1",file_id:"F1",name:"scan.pdf",route:{adapter:"pdf_ocr"},options:{pcAvailable:true}});assert.equal(j.status,"queued");assert.equal(j.cost_class,"local");
console.log("EXTRACTION PROVIDER TESTS OK");