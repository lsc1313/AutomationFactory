import assert from "node:assert/strict";import {hasObjectStorage,objectKey,storeSource,readSource,deleteSource} from "./object_storage.js";
const mem=new Map(),env={FACTORY_FILES:{put:async(k,v)=>mem.set(k,v),get:async k=>mem.has(k)?{arrayBuffer:async()=>mem.get(k),httpMetadata:{contentType:"application/pdf"}}:null,delete:async k=>mem.delete(k)}};
assert.equal(hasObjectStorage({}),false);assert.equal(hasObjectStorage(env),true);assert.ok(objectKey({jobId:"J",fileId:"F",name:"a b.pdf"}).endsWith("a_b.pdf"));
const file=new File([new Uint8Array([1,2,3])],"scan.pdf",{type:"application/pdf"});const s=await storeSource(env,{jobId:"J",fileId:"F",file});assert.equal(s.stored,true);assert.ok(await readSource(env,s.key));assert.equal(await deleteSource(env,s.key),true);
const no=await storeSource({}, {jobId:"J",fileId:"F",file});assert.equal(no.stored,false);
console.log("OBJECT STORAGE TESTS OK");