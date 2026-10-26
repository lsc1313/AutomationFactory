import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {produceTheme} from "../produce.mjs";
test("rejects wrong-size generated image before writing",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"theme-output-"));
 try{
  const png=Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000","hex");
  const provider={costCents:0,generate:async()=>({bytes:png})};
  await assert.rejects(produceTheme({slug:"moon",concept:"Moon",wallpapers:1},provider,dir),/dimensions mismatch/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
