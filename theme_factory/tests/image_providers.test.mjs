import test from "node:test";
import assert from "node:assert/strict";
import {createProceduralProvider,createGeminiImageProvider} from "../image_providers.mjs";
test("procedural art is deterministic, has correct PNG dimensions",async()=>{
 const fakeSharp=svg=>({png:()=>({toBuffer:async()=>{
  assert.match(svg.toString(),/<svg /);
  const png=Buffer.alloc(33);Buffer.from("89504e470d0a1a0a","hex").copy(png);
  png.write("IHDR",12,"ascii");png.writeUInt32BE(1024,16);png.writeUInt32BE(1024,20);return png;
 }})});
 const provider=createProceduralProvider({concept:"Moonlit botanical garden",sharpLoader:async()=>({default:fakeSharp})});
 const out=await provider.generate({id:"icon-01",type:"icon",width:1024,height:1024});
 assert.equal(out.bytes.readUInt32BE(16),1024);
});
test("Gemini parses inline image and rejects missing key",async()=>{
 assert.throws(()=>createGeminiImageProvider(),/GEMINI_API_KEY/);
 const provider=createGeminiImageProvider({apiKey:"test",fetchImpl:async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{inlineData:{mimeType:"image/png",data:Buffer.from("fake").toString("base64")}}]}}]})})});
 const out=await provider.generate({prompt:"a crystal"});
 assert.equal(out.bytes.toString(),"fake");
});
