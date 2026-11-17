import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';

const dir=await mkdtemp(path.join(os.tmpdir(),'studio-test-'));
process.env.STUDIO_DATA_DIR=dir;
const {createStudioServer,makeAss,DEFAULT_VOICE,VOICES,UNVERIFIED_VOICES,availableVoice,audioPlan,imageFilter,videoFilter,synthesizeVoice,windowsPythonPaths}=await import('../server.mjs');
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
 // Test media removal with a real persisted upload entry, linked scenes and archival.
 const mediaId='ab'.repeat(12),mediaPath=path.join(dir,'media',mediaId+'.jpg');
 await mkdir(path.join(dir,'media'),{recursive:true});
 await writeFile(mediaPath,Buffer.alloc(1800,3));
 await writeFile(path.join(dir,'media.json'),JSON.stringify([{id:mediaId,name:'실수로 올린 사진',group:'image',ext:'jpg',bytes:1800}]));
 const scene={id:'cd'.repeat(12),mediaId,duration:3,caption:'테스트',narration:'',voiceMediaId:null,effect:'zoom-in',captionPosition:'bottom',captionStyle:'impact'};
 response=await fetch(base+'/api/projects',{method:'POST',headers,body:JSON.stringify({...p,scenes:[scene]})});
 assert.equal(response.status,200);
 response=await fetch(base+'/api/media/remove',{method:'POST',headers,body:JSON.stringify({mediaId,projectId:p.id,confirm:false})});
 assert.equal(response.status,400);
 response=await fetch(base+'/api/media/remove',{method:'POST',headers,body:JSON.stringify({mediaId,projectId:p.id,confirm:true})});
 assert.equal(response.status,200);
 const removal=await response.json();
 assert.equal(removal.removedScenes,1);
 assert.equal(removal.project.scenes.length,0);
 const archived=await stat(path.join(dir,'trash',mediaId+'.jpg'));assert.equal(archived.size,1800);
 response=await fetch(base+'/api/library',{headers:{Cookie:cookie}});
 const after=await response.json();
 assert.equal(after.media.length,0);
 assert.equal(after.projects[0].scenes.length,0);
 response=await fetch(base+'/api/new',{method:'POST',headers:{Cookie:cookie},body:'{}'});assert.equal(response.status,403);
});
test('AI voice defaults to Korean female and audio plan keeps selected music/voice',()=>{
 assert.equal(DEFAULT_VOICE,'ko-KR-SunHiNeural');
 assert.ok(!VOICES.includes('ko-KR-JiMinNeural'));
 assert.ok(UNVERIFIED_VOICES.includes('ko-KR-JiMinNeural'));
 assert.ok(!VOICES.includes('ko-KR-SeoHyeonNeural'));
 assert.ok(UNVERIFIED_VOICES.includes('ko-KR-SeoHyeonNeural'));
 const x=audioPlan({voice:'ko-KR-InJoonNeural',bgmId:'abc',bgmVolume:0.18});
 assert.deepEqual(x,{voice:'ko-KR-InJoonNeural',bgmId:'abc',bgmVolume:0.18});
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
test('Windows TTS recognizes Python39 interpreter explicitly',()=>{
 const choices=windowsPythonPaths('C:/Users/Example/AppData/Local');
 assert.ok(choices.some(p=>p.includes('Python39')));
});
test('TTS runner tries Python helper with selected voice and preserves an audio file',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'studio-voice-test-'));
 const out=path.join(tmp,'test.mp3'),attempts=[];
 try{
  await synthesizeVoice('ko-KR-SunHiNeural','미리 듣기입니다',out,tmp,async(exe,args)=>{
   attempts.push({exe,args});
   await writeFile(out,Buffer.alloc(1200,7));
  },{platform:'win32',localAppData:'C:/Users/Example/AppData/Local'});
  assert.equal(attempts.length,1);
  assert.ok(attempts[0].args.some(a=>String(a).endsWith('tts_windows.py')));
  assert.ok(attempts[0].args.includes('--voice'));
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('video footage gets same zoom/pan effects as photo scenes',()=>{
 const p=videoFilter('pan-left',72),z=videoFilter('zoom-in',72);
 assert.match(p,/fps=24,split=2/);
 assert.match(p,/zoompan/);
 assert.match(p,/1\.20/);
 assert.notEqual(p,z);
});

test('all exported subtitle variants use transparent backgrounds with readable outline',()=>{
 for(const captionStyle of ['impact','minimal','boxed','clean']){
  const ass=makeAss({caption:'자막만',captionStyle,captionPosition:'top'},3);
  assert.match(ass,/&HFF000000,/);
  assert.match(ass,/Style: Captions,Malgun Gothic/);
  assert.doesNotMatch(ass,/&H64000000,/);
 }
});

test('voices that fail to synthesize are not advertised; old selections are safely migrated',()=>{
 for(const voice of ['ko-KR-JiMinNeural','ko-KR-SeoHyeonNeural','ko-KR-YuJinNeural']){
  assert.ok(UNVERIFIED_VOICES.includes(voice));
  assert.ok(!VOICES.includes(voice));
  assert.equal(availableVoice(voice),DEFAULT_VOICE);
 }
 assert.equal(availableVoice('ko-KR-InJoonNeural'),'ko-KR-InJoonNeural');
});

test('mobile editing steps and complete video playback controls are present',async()=>{
 const page=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const client=await readFile(new URL('../public/client.js',import.meta.url),'utf8');
 for(const label of ['1. 사진·영상 업로드','2. AI 영상 초안 만들기','3. 영상 확인·편집','4. 프로젝트 설정'])assert.ok(page.includes(label),label);
 for(const id of ['preview-full','full-video','full-review','full-download'])assert.ok(page.includes('id="'+id+'"'),id);
 assert.match(client,/startExport\(true\)/);
 assert.match(client,/anchor[.]after[(]props[)]/);
 assert.match(client,/mediaPanel\.parentElement!==layout/);
 const mobile=await readFile(new URL('../public/mobile-ui.js',import.meta.url),'utf8');
 const order=['project','media','ai','edit','captions','sound'];
 const locations=order.map(tab=>page.indexOf('data-mobile-tab="'+tab+'"'));
 assert.ok(locations.every((at,i)=>at>0&&(i===0||at>locations[i-1])),'mobile workflow tab order');
 assert.match(mobile,/dock\.append\(preview\)/);
 assert.match(mobile,/syncPreviewFrame/);
});

test('uploaded thumbnail selection is side-effect-free; explicit buttons are present',async()=>{
 const js=await readFile(new URL('../public/client.js',import.meta.url),'utf8');
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(js,/b\.onclick=\(\)=>\{selectedMediaId=f\.id;renderSelectedMedia\(\);\}/);
 assert.match(html,/id="delete-selected-media"/);
 assert.match(html,/id="add-selected-scene"/);
 assert.match(html,/id="selected-media-preview"/);
});

test('separate phone UI retains desktop AI editing and mobile controls',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const mobile=await readFile(new URL('../public/mobile-ui.js',import.meta.url),'utf8');
 const css=await readFile(new URL('../public/mobile-ui.css',import.meta.url),'utf8');
 for(const id of ['mobile-navigation','mobile-clip-details','ai-workflow'])assert.ok(html.includes(id)||mobile.includes(id),id);
 const timelineUI=await readFile(new URL('../public/timeline-ui.js',import.meta.url),'utf8');
 assert.ok(timelineUI.includes('v2-ratio'));
 for(const tab of ['edit','media','ai','captions','sound'])assert.ok(html.includes('data-mobile-tab="'+tab+'"'),tab);
 assert.match(css,/@media[(]max-width:900px[)]/);
 assert.match(css,/data-mobile-view="ai"/);
 assert.match(mobile,/positionEditorTools/);
});


test('guest invite is fully selectable and clipboard errors cannot fake success',async()=>{
 const page=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const client=await readFile(new URL('../public/client.js',import.meta.url),'utf8');
 for(const id of ['guest-share-dialog','guest-share-url','guest-copy-btn','guest-share-status'])assert.ok(page.includes('id="'+id+'"'),id);
 assert.match(client,/navigator\.clipboard\?\.writeText/);
 assert.match(client,/field\.select\(\)/);
 assert.match(client,/document\.execCommand\?\.\('copy'\)/);
 assert.match(client,/dialog\.showModal\(\)/);
 assert.doesNotMatch(client,/prompt\('아래 링크를 복사해서 지인에게 보내세요/);
});

test('one-click update identifies release and verifies the live service before claiming success',async()=>{
 const installer=await readFile(new URL('../windows/install-oneclick.ps1',import.meta.url),'utf8');
 const page=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(installer,/\$version = 'v1\.3\.9'/);
 assert.match(installer,/Verified running editor release/);
 assert.match(installer,/Wrong editor release downloaded/);
 assert.match(page,/id="guest-share-dialog"/);
 assert.match(page,/id="studio-build-label"/);
});
