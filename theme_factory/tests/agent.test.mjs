import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
const agent=new URL("../agent.mjs",import.meta.url).pathname;
test("agent seeds, deduplicates and produces honest draft manifests",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"theme-agent-"));
 const env={...process.env,THEME_AGENT_DIR:dir,GEMINI_API_KEY:"",THEME_MAX_JOBS:"2"};
 const run=(...args)=>spawnSync(process.execPath,[agent,...args],{env,encoding:"utf8"});
 try{
  assert.equal(run("seed").status,0);
  assert.equal(run("enqueue","Celestial ocean").status,0);
  assert.equal(run("run").status,0);
  const state=JSON.parse(await readFile(join(dir,"state.json"),"utf8"));
  assert.equal(state.jobs.length,4);
  assert.equal(state.jobs.filter(x=>x.status==="draft_ready").length,2);
  const draft=JSON.parse(await readFile(join(dir,"drafts",state.jobs[0].slug,"product-draft.json"),"utf8"));
  assert.equal(draft.assetStatus,"not-generated");
  assert.equal(draft.wallpapers.length,4);
 }finally{await rm(dir,{recursive:true,force:true})}
});
