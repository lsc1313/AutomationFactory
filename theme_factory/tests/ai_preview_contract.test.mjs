import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.mjs";
const url="https://example.test/api/preview-image";
const makeReq=()=>new Request(url,{method:"POST",headers:{"authorization":"Bearer admin","content-type":"application/json"},body:JSON.stringify({prompt:"a blue moonlit mountain"})});
const env=(db)=>({ADMIN_TOKEN:"admin",CLOUDFLARE_AI_TOKEN:"private",CLOUDFLARE_ACCOUNT_ID:"acct",THEME_AI_PREVIEW_ENABLED:"1",THEME_QUOTA_DB:db});
const quota=(changes=1)=>({prepare(){return{bind(){return{async run(){return{success:true,meta:{changes}}}}}}}}});
test("missing quota binding fails closed without calling AI",async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error("unexpected")};
 try{const res=await worker.fetch(makeReq(),env(undefined));assert.equal(res.status,503);assert.equal(calls,0)}
 finally{globalThis.fetch=original}
});
test("exhausted daily quota returns 429 without AI call",async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error("unexpected")};
 try{const res=await worker.fetch(makeReq(),env(quota(0)));assert.equal(res.status,429);assert.equal(calls,0)}
 finally{globalThis.fetch=original}
});
test("authorized single preview returns image bytes from mocked Cloudflare API",async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(u,options)=>{calls++;assert.match(u.toString(),/\/ai\/run\//);assert.equal(options.headers.Authorization,"Bearer private");assert.equal(JSON.parse(options.body).prompt,"a blue moonlit mountain");return new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"image/png"}})};
 try{const res=await worker.fetch(makeReq(),env(quota(1)));assert.equal(res.status,200);assert.equal(res.headers.get("content-type"),"image/png");assert.deepEqual([...new Uint8Array(await res.arrayBuffer())],[1,2,3]);assert.equal(calls,1)}
 finally{globalThis.fetch=original}
});
test("upstream failure is returned without token leakage",async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response("secret internal error",{status:403});
 try{const res=await worker.fetch(makeReq(),env(quota(1)));assert.equal(res.status,502);assert.ok(!(await res.text()).includes("private"))}
 finally{globalThis.fetch=original}
});
test("network failure returns controlled error",async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error("network error")};
 try{const res=await worker.fetch(makeReq(),env(quota(1)));assert.equal(res.status,502);assert.equal((await res.json()).error,"ai_network_failed")}
 finally{globalThis.fetch=original}
});
