import assert from "node:assert/strict";import {config} from "./client.js";import {extractDocument} from "./extractor.js";
assert.equal(config({FACTORY_BASE_URL:"https://x/ ",PC_WORKER_TOKEN:"t"}).token,"t");
const t=await extractDocument({name:"a.txt",bytes:new TextEncoder().encode("hello"),mode:"text"});assert.equal(t.text,"hello");
// Capability checks belong to runtime/heartbeat. Do not feed deliberately invalid PDF bytes to an installed Poppler binary.
const unsupported=await extractDocument({name:"a.bin",bytes:new Uint8Array([1]),mode:"ocr"});assert.equal(unsupported.error,"LOCAL_EXTRACTOR_UNSUPPORTED");
console.log("PC WORKER TESTS OK");
