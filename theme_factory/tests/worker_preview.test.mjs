import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker_preview.mjs";
const req=(path,method="GET",headers={},body)=>new Request("https://example.com"+path,{method,headers,body});
test("health reports configuration without exposing secret",async()=>{
 const r=await worker.fetch(req("/health"),{CLOUDFLARE_AI_TOKEN:"private"});
 const t=await r.text();assert.equal(r.status,200);assert.ok(!t.includes("private"));assert.match(t,/productionReady/);
});
test("image preview requires admin token",async()=>{
 const r=await worker.fetch(req("/api/preview-image","POST",{"content-type":"application/json"},'{"prompt":"moon"}'),{ADMIN_TOKEN:"secret",CLOUDFLARE_AI_TOKEN:"token"});
 assert.equal(r.status,401);
});
test("image preview disabled by default",async()=>{
 const r=await worker.fetch(req("/api/preview-image","POST",{"authorization":"Bearer secret","content-type":"application/json"},'{"prompt":"moon"}'),{ADMIN_TOKEN:"secret",CLOUDFLARE_AI_TOKEN:"token",CLOUDFLARE_ACCOUNT_ID:"account"});
 assert.equal(r.status,403);
});

test("readiness stays false until explicit enable and all bindings exist",async()=>{
 const env={CLOUDFLARE_AI_TOKEN:"private",CLOUDFLARE_ACCOUNT_ID:"account",ADMIN_TOKEN:"admin",THEME_QUOTA_DB:{prepare(){}}};
 let result=await (await worker.fetch(req("/health"),env)).json();
 assert.equal(result.previewReady,false);assert.equal(result.previewEnabled,false);assert.equal(result.quotaConfigured,true);
 env.THEME_AI_PREVIEW_ENABLED="1";
 result=await (await worker.fetch(req("/health"),env)).json();
 assert.equal(result.previewReady,true);assert.equal(result.previewEnabled,true);
 assert.ok(!JSON.stringify(result).includes("private"));
});
