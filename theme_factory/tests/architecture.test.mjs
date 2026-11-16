import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {validateArchitecture,architecturePlan} from "../architecture.mjs";
import {buildFromArchitecture} from "../build_architecture.mjs";
const example={schemaVersion:1,slug:"silver-garden",name:"Silver Garden",concept:"silver leaves and moon",style:"ornamental painting",palette:["#123456","#abcdef"],quality:{minUniqueAssets:2},assets:[{id:"wallpaper-01",type:"wallpaper",width:1440,height:3200,prompt:"Moon garden scene"},{id:"icon-phone",type:"icon",width:1024,height:1024,prompt:"Distinct telephone symbol"}]};
test("architecture preserves explicit per-asset sizes and prompts",()=>{
 const p=architecturePlan(example);
 assert.equal(p.tasks.length,2);
 assert.equal(p.tasks[0].width,1440);
 assert.match(p.tasks[1].prompt,/telephone symbol/);
 assert.match(p.tasks[0].prompt,/#123456/);
});
test("architecture blocks duplicate ids and invalid dimensions",()=>{
 assert.throws(()=>validateArchitecture({...example,assets:[example.assets[0],example.assets[0]]}),/duplicate/);
 assert.throws(()=>validateArchitecture({...example,assets:[{...example.assets[0],width:-1}]}),/dimensions/);
 assert.throws(()=>validateArchitecture({...example,slug:"../escape"}),/slug/);
});
function png(w,h,marker){
 const b=Buffer.alloc(48);Buffer.from("89504e470d0a1a0a","hex").copy(b,0);
 b.write("IHDR",12,"ascii");b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);b.write(marker,28,"ascii");return b;
}
test("architecture runner writes verified ZIP, manifest and resumes without regenerating",async()=>{
 const root=await mkdtemp(join(tmpdir(),"architecture-test-"));
 try{
  const path=join(root,"architecture.json");await writeFile(path,JSON.stringify(example));
  let calls=0;
  const provider={costCents:0,generate:async task=>{calls++;return {bytes:png(task.width,task.height,task.id)}}};
  const sharpLoader=async()=>({default:(buf)=>({resize:()=>({png:()=>({toBuffer:async()=>buf})})})});
  const opts={architecturePath:path,outputRoot:join(root,"out"),provider,sharpLoader,mode:"test-mock"};
  const result=await buildFromArchitecture(opts);
  assert.equal(result.images,2);assert.equal(result.manifest.assets.length,2);
  assert.equal(result.manifest.quality.uniqueAssets,2);
  const zip=await readFile(result.archive);
  assert.equal(zip.readUInt32LE(0),0x04034b50);
  assert.equal(calls,2);
  await buildFromArchitecture(opts);
  assert.equal(calls,2);
  const state=JSON.parse(await readFile(join(root,"out",example.slug,"progress.json")));
  assert.equal(state.status,"complete");
 }finally{await rm(root,{recursive:true,force:true})}
});
