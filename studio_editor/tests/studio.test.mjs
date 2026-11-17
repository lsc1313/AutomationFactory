import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';

const dir=await mkdtemp(path.join(os.tmpdir(),'studio-test-'));
process.env.STUDIO_DATA_DIR=dir;
const {createStudioServer,makeAss,DEFAULT_VOICE,VOICES,audioPlan,imageFilter,synthesizeVoice}=await import('../server.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const a=makeAss({caption:'상품 {100%} 구매',captionStyle:'minimal',captionPosition:'top'},4);
test('ASS subtitles escape syntax, show safe upper positioning',()=>{assert.match(a,/Style: Captions,Malgun Gothic,43/);assert.match(a,/100%/);assert.doesNotMatch(a,/\{100%\}/);assert.match(a,/4\.00/);});
test('editor UI and localhost-only bootstrap',async t=>{
 const s=createStudioServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${s.address().port}`;
 t.after(async()=>{await new Promise(r=>s.close(r));await rm(dir,{recursive:true,force:true});});
 let response=await fetch(base+'/app');assert.equal(response.status,200);assert.match(await response.text(),/Studio Editor/);
 let x=await (await fetch(base+'/api/setup-state')).json();assert.equal(x.setupNeeded,true);
 response=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'secure_test_password_123'})});assert.equal(response.status,201);
 response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'secure_test_password_123'})});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0],user=await response.json();
 const headers={'Content-Type':'application/json','X-CSRF-Token':user.csrf,Cookie:cookie};
 response=await fetch(base+'/api/new',{method:'POST',headers,body:'{}'});assert.equal(response.status,201);const p=(await response.json()).project;
 response=await fetch(base+'/api/projects',{method:'POST',headers,body:JSON.stringify({...p,title:'안전한 프로젝트'})});assert.equal(response.status,200);
 response=await fetch(base+'/api/library',{headers:{Cookie:cookie}});x=await response.json();assert.equal(x.projects[0].title,'안전한 프로젝트');
 response=await fetch(base+'/api/new',{method:'POST',headers:{Cookie:cookie},body:'{}'});assert.equal(response.status,403);
});
test('AI voice defaults to Korean female and audio plan keeps selected music/voice',()=>{
 assert.equal(DEFAULT_VOICE,'ko-KR-SunHiNeural');
 assert.ok(VOICES.includes('ko-KR-JiMinNeural'));
 assert.ok(VOICES.includes('ko-KR-SeoHyeonNeural'));
 const x=audioPlan({voice:'ko-KR-YuJinNeural',bgmId:'abc',bgmVolume:0.18});
 assert.deepEqual(x,{voice:'ko-KR-YuJinNeural',bgmId:'abc',bgmVolume:0.18});
});

test('scene motion applies distinct left/right transforms with 1.2x tempo',()=>{
 const left=imageFilter('pan-left',72),right=imageFilter('pan-right',72),zoom=imageFilter('zoom-in',72);
 assert.match(left,/zoompan/);
 assert.match(left,/min\(1,on\/59\)/);
 assert.match(left,/1\.20/);
 assert.notEqual(left,right);
 assert.match(left,/1-min/);
 assert.match(right,/zoom\)\*min/);
 assert.match(zoom,/0\.20\*min/);
});
test('voice renderer uses Edge CLI then Python module if PATH lacks script',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'studio-voice-test-'));
 const p=path.join(tmp,'test-speech.mp3');
 const attempts=[];
 await synthesizeVoice('ko-KR-SunHiNeural','미리 듣기입니다',p,tmp,async(exe,args)=>{
  attempts.push(exe);
  if(exe==='edge-tts')throw new Error('command not found');
  assert.equal(exe,'python');
  assert.deepEqual(args.slice(0,2),['-m','edge_tts']);
  await writeFile(p,Buffer.alloc(1000,1));
 });
 assert.deepEqual(attempts,['edge-tts','python']);
 await rm(tmp,{recursive:true,force:true});
});
