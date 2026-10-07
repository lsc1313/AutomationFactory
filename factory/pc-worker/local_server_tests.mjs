import assert from "node:assert/strict";
import {createLocalServer} from "./local_server.js";

process.env.PC_LOCAL_TOKEN="test-token";
process.env.PC_ALLOWED_ORIGIN="https://factory.example,https://staging.example";
const s=createLocalServer();
await new Promise(r=>s.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+s.address().port;
try{
 let r=await fetch(base+"/health");
 assert.equal(r.status,401);
 r=await fetch(base+"/health",{headers:{authorization:"Bearer test-token"}});
 assert.equal(r.status,200);
 const j=await r.json();
 assert.equal(j.service,"exception-factory-pc");
 assert.equal(j.max_bytes_by_type.image,20*1024*1024);
 assert.equal(j.max_bytes_by_type.pdf,30*1024*1024);
 assert.equal(j.max_bytes_by_type.zip,50*1024*1024);
 assert.equal(j.max_bytes_by_type.other,8*1024*1024);

 r=await fetch(base+"/extract",{method:"OPTIONS",headers:{origin:"https://factory.example","access-control-request-method":"POST"}});
 assert.equal(r.status,204);
 assert.equal(r.headers.get("access-control-allow-origin"),"https://factory.example");

 r=await fetch(base+"/extract",{method:"OPTIONS",headers:{origin:"https://evil.example","access-control-request-method":"POST"}});
 assert.equal(r.status,403);
 assert.equal(r.headers.get("access-control-allow-origin"),null);
}finally{
 await new Promise(r=>s.close(r));
 delete process.env.PC_ALLOWED_ORIGIN;
}
console.log("PC LOCAL SERVER TESTS OK");
