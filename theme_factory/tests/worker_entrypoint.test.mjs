import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.mjs";
test("production health remains available",async()=>{
 const r=await worker.fetch(new Request("https://example.test/health"),{});
 assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.app,"Theme Factory");
 assert.equal(data.productionReady,false);
});
test("production AI preview is denied without configuration",async()=>{
 const r=await worker.fetch(new Request("https://example.test/api/preview-image",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:"moon"})}),{});
 assert.equal(r.status,401);
});
