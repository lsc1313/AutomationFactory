import assert from "node:assert/strict";
import vm from "node:vm";
import {factoryHtml} from "./page.js";

const h=factoryHtml();
assert.ok(h.includes("Exception Factory"));
assert.ok(h.includes('type="file"'));
assert.ok(h.includes("/api/factory/scan"));
assert.ok(h.includes("/api/factory/upload"));
assert.ok(h.includes("Universal Intake 분석 중"));
assert.ok(h.includes("추출 엔진 필요"));
assert.ok(h.includes("/api/factory/scan/status"));
assert.ok(h.includes("setTimeout"));
assert.ok(h.includes("roles.innerHTML=items.map"));
assert.ok(h.includes("flatMap(s=>s.normalized_rows||[])"));
assert.ok(h.includes("canonicalRows(rows)"));
assert.ok(h.includes("supplier unit cost"));
assert.ok(h.includes("quantity:['qty','quantity'"));

const script=h.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,"factory inline script missing");
assert.doesNotThrow(()=>new vm.Script(script),"factory browser script must parse");

console.log("FACTORY UI TESTS OK");
