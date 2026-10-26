import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildPackage,zipEntries} from "../zip.mjs";
const png=Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
test("ZIP writer emits standard ZIP signatures",()=>{const zip=zipEntries([["hello.txt","hello"]]);assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50)});
test("package requires image magic and emits ZIP",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"theme-pack-"));
 try{
  await mkdir(join(dir,"assets"));
  await writeFile(join(dir,"product.json"),JSON.stringify({slug:"moon-dragon",title:"Moon Dragon",description:"Wallpaper set",wallpapers:[{file:"assets/wallpaper.png",width:1,height:1}]}));
  await writeFile(join(dir,"assets/wallpaper.png"),png);
  const out=join(dir,"output.zip"),result=await buildPackage(dir,out);
  assert.equal(result.assets,1);assert.ok((await readFile(out)).length>png.length);
  await writeFile(join(dir,"assets/wallpaper.png"),Buffer.from("not an image"));
  await assert.rejects(buildPackage(dir,out),/unsupported image/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
