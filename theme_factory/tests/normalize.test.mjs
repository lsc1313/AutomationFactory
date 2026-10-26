import test from "node:test";
import assert from "node:assert/strict";
import {normalizeImage} from "../normalize.mjs";
test("normalization rejects empty output",async()=>{
 await assert.rejects(normalizeImage(Buffer.from("source"),{width:1440,height:3200},{sharpLoader:async()=>()=>({resize(){return this},png(){return this},async toBuffer(){return Buffer.from("bad")}})}),/invalid PNG/);
});
test("normalization validates input",async()=>{
 await assert.rejects(normalizeImage(Buffer.alloc(0),{width:1,height:1}),/empty image/);
});
