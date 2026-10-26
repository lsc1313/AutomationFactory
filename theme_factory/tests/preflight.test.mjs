import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
test("preflight script is read-only and reports key hardware fields",async()=>{
 const s=await readFile(new URL("../adapters/preflight.py",import.meta.url),"utf8");
 for(const field of ["cudaAvailable","gpuMemoryGB","freeDiskGB","dependencies","modelPathExists"])assert.ok(s.includes(field));
 assert.ok(!s.includes("pip install"));
 assert.ok(!s.includes("from_pretrained"));
});
