import test from "node:test";
import assert from "node:assert/strict";
import {createCloudflareImageProvider} from "../cloudflare_provider.mjs";
test("rejects missing credentials and billable flag",()=>{
 assert.throws(()=>createCloudflareImageProvider({}),/required/);
 assert.throws(()=>createCloudflareImageProvider({accountId:"x",apiToken:"x",allowBillable:true}),/billable/);
});
test("submits a capped image request without live network",async()=>{
 let body;
 const provider=createCloudflareImageProvider({accountId:"test",apiToken:"fake",fetchImpl:async(_url,options)=>{
 body=JSON.parse(options.body);
 return {ok:true,headers:{get:()=>"image/png"},arrayBuffer:async()=>Buffer.alloc(24).buffer};
 }});
 const result=await provider.generate({prompt:"moon",width:1440,height:3200});
 assert.equal(body.width,1024);assert.equal(body.height,2048);assert.ok(result.bytes.length>=24);
});
