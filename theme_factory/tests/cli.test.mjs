import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {execFileSync} from "node:child_process";
const cli=resolve("theme_factory/cli.mjs");
test("CLI creates and lists persistent jobs",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"theme-factory-"));
 try {
  const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:"utf8"});
  const job=JSON.parse(run("create","Moon","Dragon"));
  assert.equal(job.concept,"Moon Dragon");
  const list=JSON.parse(run("list"));assert.equal(list.length,1);assert.equal(list[0].id,job.id);
  const started=JSON.parse(run("start",job.id));assert.equal(started.status,"running");
  const finished=JSON.parse(run("complete",job.id));assert.equal(finished.status,"completed");
 }finally{await rm(dir,{recursive:true,force:true});}
});
