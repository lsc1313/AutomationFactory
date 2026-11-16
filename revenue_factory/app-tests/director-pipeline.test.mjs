import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateDirectorMedia,validateDirectorPlan,produceDirectorCreative,runShortsDirector } from '../director-pipeline.mjs';
const png=(seed)=>'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(1800,seed)]).toString('base64');
const good={name:'텀블러',brand:'온유',audience:'직장인',features:['500ml 용량','뚜껑이 있습니다'],priceKrw:19900,imageDataUrls:[png(1),png(2)]};
const scenes=[{tts:'직장인을 위한 텀블러 상품을 소개합니다.',subtitle:'텀블러 소개'},{tts:'이 제품은 500ml 용량으로 안내되어 있습니다.',subtitle:'500ml 용량'},{tts:'뚜껑이 있는 형태의 텀블러입니다.',subtitle:'뚜껑 구성'},{tts:'온유 텀블러 상세 정보를 확인해 보세요.',subtitle:'자세히 보기'}];
test('requires multiple verified distinct photos',()=>{assert.equal(validateDirectorMedia(good).images.length,2);assert.throws(()=>validateDirectorMedia({...good,imageDataUrls:[]}),/2~6장/);assert.throws(()=>validateDirectorMedia({...good,imageDataUrls:[png(1),png(1)]}),/중복/);assert.throws(()=>validateDirectorMedia({...good,imageDataUrls:['data:image/png;base64,AAAA',png(2)]}),/사진/);});
test('director plan rejects empty or unsupported claims',()=>{assert.equal(validateDirectorPlan({scenes},good).length,4);assert.throws(()=>validateDirectorPlan({scenes:scenes.slice(0,2)},good),/4~7/);assert.throws(()=>validateDirectorPlan({scenes:[{...scenes[0],tts:'최저가 완치 효과 보장 상품입니다.'},...scenes.slice(1)]},good),/광고 주장/);});
test('builds a separate review job and requires video audio attestation',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'director-ad-'));try{const result=await produceDirectorCreative(good,dir,{director:async({images})=>{assert.equal(images.length,2);return validateDirectorPlan({scenes},good);},renderer:async({jobDir,scenes,images})=>{assert.equal(scenes.length,4);assert.equal(images.length,2);await writeFile(path.join(jobDir,'advertisement.mp4'),Buffer.alloc(70000,1));return {filename:'advertisement.mp4',bytes:70000,hasAudio:true,scenes:4,qualityGate:'passed'};}});assert.match(result.job,/^creative-/);assert.ok(result.files.includes('advertisement.mp4'));assert.equal((await readFile(path.join(dir,result.job,'brief.json'),'utf8')).includes('Shopping Director'),true);}finally{await rm(dir,{force:true,recursive:true});}});
test('isolated Director subprocess invokes existing ShortsAI AI gateway and scene normalizer, never uploader',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'rf-mock-shortsaai-'));
 const home=path.join(root,'ShortsAI_CLEAN'),jobDir=path.join(root,'job');
 try{
  await mkdir(path.join(home,'modules','ai'),{recursive:true});
  await mkdir(path.join(home,'modules','shopping'),{recursive:true});
  await mkdir(jobDir,{recursive:true});
  await writeFile(path.join(home,'package.json'),JSON.stringify({type:'module'}));
  await writeFile(path.join(home,'modules','ai','index.js'),
   'export async function callAI(prompt){ if(!prompt.includes("상품 광고")) throw Error("Wrong business director prompt"); return JSON.stringify({work_instructions:{scenes:[{tts:"직장인을 위한 텀블러 상품을 소개합니다.",subtitle:"온유 텀블러"},{tts:"이 제품은 500ml 용량으로 안내되어 있습니다.",subtitle:"500ml 용량"},{tts:"뚜껑이 있는 형태의 텀블러입니다.",subtitle:"뚜껑 구성"},{tts:"온유 텀블러 상세 정보를 확인해 보세요.",subtitle:"상품 안내"}]}}); }');
  await writeFile(path.join(home,'modules','shopping','director.js'),
   'export function normalizeShoppingScenes(data,product){if(product.images.length<2)throw Error("images");return data.work_instructions.scenes;}');
  const scenes=await runShortsDirector({shortsHome:home,product:validateDirectorMedia(good).product,images:['photo1.png','photo2.png'],jobDir});
  assert.equal(scenes.length,4);
  assert.ok(scenes[0].voice.includes('텀블러'));
  assert.match(await readFile(path.join(jobDir,'director-bridge.mjs'),'utf8'),/normalizeShoppingScenes/);
 }finally{await rm(root,{recursive:true,force:true});}
});
