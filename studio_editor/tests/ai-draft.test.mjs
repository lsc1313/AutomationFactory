import test from 'node:test';
import assert from 'node:assert/strict';
import {parseKeyFile,normalizeDraft,parseModelJson,generateAiDraft} from '../ai-draft.mjs';
const media=[{id:'a',name:'사진1.jpg',group:'image'},{id:'b',name:'영상2.mp4',group:'video'}];
const out={title:'테스트 광고',notes:'사진을 검토하세요',scenes:[
 {mediaIndex:0,duration:4,narration:'첫 번째 사진 소개입니다.',caption:'사진 소개',captionPosition:'top'},
 {mediaIndex:1,duration:4,narration:'두 번째 동영상 소개입니다.',caption:'영상 소개',captionPosition:'bottom'}]};
test('extracts existing Gemini key without leaking .env data',()=>{
 assert.equal(parseKeyFile('FOO=bar\nGEMINI_API_KEY="abc123"\nOTHER=x'),'abc123');
 assert.equal(parseKeyFile('GEMINI_API_KEY=abc-123 # comment'),'abc-123');
});
test('validates AI media indices and safe scene fields',()=>{
 const x=normalizeDraft(out,media);assert.equal(x.scenes[1].mediaId,'b');assert.equal(x.scenes[0].captionPosition,'top');
 assert.throws(()=>normalizeDraft({...out,scenes:[{...out.scenes[0],mediaIndex:9},out.scenes[1]]},media),/연결/);
 assert.throws(()=>normalizeDraft({...out,scenes:[]},media),/장면/);
});
test('AI draft sends actual image/frame bytes to Gemini but never synthesizes video',async()=>{
 let called=false,used=[];
 const draft=await generateAiDraft({key:'test-secret',media,requirements:'광고 장면을 만들어줘',productFacts:'사진과 일치하는 사실만',
  mediaPath:f=>f.name,sampler:async(file,isVideo)=>{used.push([file,isVideo]);return 'ZmFrZQ=='},
  fetchFn:async(url,opts)=>{called=true;assert.match(url,/generateContent/);assert.equal(opts.headers['x-goog-api-key'],'test-secret');const body=JSON.parse(opts.body);assert.equal(body.contents[0].parts.filter(p=>p.inline_data).length,2);return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(out)}]}}]})}}});
 assert.ok(called);assert.deepEqual(used,[['사진1.jpg',false],['영상2.mp4',true]]);assert.equal(draft.scenes.length,2);
});
test('fails closed on AI quota errors rather than fabricating captions',async()=>{
 await assert.rejects(()=>generateAiDraft({key:'test',media:[media[0]],requirements:'광고 장면 만들기',mediaPath:()=>'',sampler:async()=>'',fetchFn:async()=>({ok:false,status:429,json:async()=>({error:{message:'Quota exceeded'}})})}),/429/);
 assert.equal(parseModelJson('```json\n{"scenes":[]}\n```').scenes.length,0);
});