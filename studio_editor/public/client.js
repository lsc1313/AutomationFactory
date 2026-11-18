'use strict';
let csrf='',library=[],projects=[],project=null,selected=0,dirty=false,poll=null,aiPoll=null,aiDraft=null,previewAnimation=null,openFullAfterRender=false,renderedProjectId=null;
let selectedMediaId=null;
const $=id=>document.getElementById(id);
function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
const rand=()=>[...crypto.getRandomValues(new Uint8Array(12))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function api(url,method='GET',body){const opt={method,credentials:'same-origin',headers:{}};if(body!==undefined){opt.headers['Content-Type']='application/json';opt.headers['X-CSRF-Token']=csrf;opt.body=JSON.stringify(body);}const res=await fetch(url,opt);const obj=await res.json();if(!res.ok)throw Error(obj.error||'오류');return obj;}
let signupMode=false;
function setSignupMode(mode){
 signupMode=Boolean(mode);
 $('login-btn').textContent=signupMode?'회원가입하고 시작':'로그인';
 $('signup-toggle').textContent=signupMode?'로그인으로 돌아가기':'회원가입';
 $('email').required=signupMode;
 $('password').setAttribute('autocomplete',signupMode?'new-password':'current-password');
 $('access-note').textContent=signupMode?'이메일과 12자 이상의 비밀번호로 계정을 만드세요.':'기존 사용자는 이메일 대신 owner를 입력하거나 비워두고 기존 비밀번호로 로그인하세요.';
}
$('signup-toggle').onclick=()=>setSignupMode(!signupMode);
async function session(){
 try{
  const x=await api('/api/me');
  csrf=x.csrf;
  $('gate').hidden=true;
  $('studio').hidden=false;
  document.body.dataset.guestMode='false';
  $('studio-user-email').textContent=x.email==='owner'?'기존 관리자 계정':x.email||'로그인됨';
  await reload();
 }catch{
  $('gate').hidden=false;$('studio').hidden=true;
  setSignupMode(false);
 }
}
$('access').onsubmit=async e=>{
 e.preventDefault();
 const password=$('password').value,email=$('email').value.trim();
 try{
  const result=await api(signupMode?'/api/register':'/api/login','POST',{email,password});
  csrf=result.csrf;
  $('password').value='';
  await session();
 }catch(err){$('access-note').textContent='오류: '+err.message;}
};
$('logout').onclick=async()=>{await api('/api/logout','POST',{}).catch(()=>{});csrf='';await session();};
async function reload(){const result=await api('/api/library');library=result.media;projects=result.projects;const last=project?.id;project=projects.find(p=>p.id===last)||projects[0]||null;if(!project){const r=await api('/api/new','POST',{});project=r.project;projects.push(project)}selected=Math.min(selected,Math.max(0,project.scenes.length-1));renderedProjectId=null;$('full-review').hidden=true;render();await updateAiStatus();}
function isAudio(m){return m.group==='music'}
function previewMedia(media,target){const src='/api/media/'+media.id;const e=node(media.group==='video'?'video':'img');e.src=src;if(media.group==='video'){e.muted=true;e.playsInline=true;e.loop=true;e.preload='metadata'}target.append(e);return e;}
function renderSelectedMedia(){
 const file=library.find(f=>f.id===selectedMediaId);
 const panel=$('selected-media-panel');
 panel.hidden=!file;
 for(const btn of document.querySelectorAll('#media-list .media-item'))btn.classList.remove('active');
 if(!file)return;
 const index=library.indexOf(file),btn=$('media-list').children[index];
 if(btn)btn.classList.add('active');
 $('selected-media-name').textContent=file.name;
 const target=$('selected-media-preview');target.replaceChildren();
 if(file.group==='image'){
  const img=node('img');img.src='/api/media/'+file.id;img.alt=file.name;target.append(img);
 }else if(file.group==='video'){
  const v=node('video');v.src='/api/media/'+file.id;v.controls=true;v.playsInline=true;v.preload='metadata';target.append(v);
 }else{
  const audio=node('audio');audio.src='/api/media/'+file.id;audio.controls=true;target.append(audio);
 }
 const sceneCount=project.scenes.filter(s=>s.mediaId===file.id).length;
 $('selected-media-note').textContent=sceneCount
  ?'현재 프로젝트에서 '+sceneCount+'개 장면에 사용 중입니다. 삭제하면 연결된 장면도 삭제됩니다.'
  :'미리보기만 선택한 상태입니다. 장면에 넣으려면 추가 버튼을 누르세요.';
 $('add-selected-scene').textContent=isAudio(file)?'+ 이 음악을 배경음악으로 선택':'+ 선택한 사진 장면 추가';
}
$('add-selected-scene').onclick=()=>{
 const file=library.find(f=>f.id===selectedMediaId);
 if(!file)return;
 if(isAudio(file)){
  project.bgmId=file.id;setDirty();render();return;
 }
 project.scenes.push({id:rand(),mediaId:file.id,duration:4,caption:'',narration:'',voiceMediaId:null,effect:'zoom-in',captionPosition:'bottom',captionStyle:'impact'});
 selected=project.scenes.length-1;setDirty();render();
};
$('delete-selected-media').onclick=async()=>{
 const file=library.find(f=>f.id===selectedMediaId);if(!file)return;
 const sceneCount=project.scenes.filter(s=>s.mediaId===file.id).length;
 const usedVoice=project.scenes.some(s=>s.voiceMediaId===file.id);
 const usedBgm=project.bgmId===file.id;
 const message='정말 '+file.name+'을(를) 라이브러리에서 제거할까요?'
  +(sceneCount?'\\n연결된 장면 '+sceneCount+'개도 삭제됩니다.':'')
  +((usedVoice||usedBgm)?'\\n연결된 음성·배경음악도 해제됩니다.':'')
  +'\\n원본은 PC 휴지통 보관 폴더로 이동합니다.';
 if(!confirm(message))return;
 try{
  if(dirty)await save();
  const result=await api('/api/media/remove','POST',{projectId:project.id,mediaId:file.id,confirm:true});
  const idx=library.findIndex(f=>f.id===file.id);if(idx>=0)library.splice(idx,1);
  project=result.project;projects=projects.map(p=>p.id===project.id?project:p);
  selected=Math.min(selected,Math.max(0,project.scenes.length-1));
  selectedMediaId=null;dirty=false;renderedProjectId=null;$('full-review').hidden=true;
  render();$('save-state').textContent='미디어 삭제 완료 · 프로젝트 자동 저장됨';
 }catch(err){alert('삭제할 수 없습니다: '+err.message);}
};
function setDirty(){
 dirty=true;renderedProjectId=null;
 $('full-review').hidden=true;
 $('full-video').pause();$('full-video').removeAttribute('src');
 $('save-state').textContent='저장되지 않은 변경';
}
const scenePreviewAudio=()=> $('voice-audio');
let previewRun=0;
function stopPreview(){
 previewRun++;
 scenePreviewAudio().pause();scenePreviewAudio().removeAttribute('src');scenePreviewAudio().hidden=true;
 if(previewAnimation){previewAnimation.cancel();previewAnimation=null}
 const vid=$('preview-video');vid.pause();
}
async function previewVoice(text= '안녕하세요. 자연스럽고 또렷하게 영상의 내용을 소개하겠습니다.',voice=project?.voice){
 const current=++previewRun;
 const status=$('voice-preview-status');
 if(voice==='off'){status.textContent='음성 없음이 선택되었습니다.';return;}
 if(!text.trim()){status.textContent='먼저 장면 대사를 입력하세요.';return;}
 status.textContent='선택한 목소리 생성 중…';
 try{
  const r=await api('/api/voice/preview','POST',{voice,text:text.slice(0,160)});
  if(current!==previewRun)return;
  const audio=scenePreviewAudio();
  audio.pause();audio.src=r.url;audio.hidden=false;
  try{await audio.play();status.textContent='음성 재생 중';}
  catch{status.textContent='모바일 자동재생이 제한됐습니다. 아래 재생 버튼을 눌러주세요.';}
  audio.onended=()=>{if(current===previewRun)status.textContent='재생 완료'};
 }catch(e){if(current===previewRun)status.textContent='미리듣기 실패: '+e.message;}
}
function animateCurrentScene(){
 const scene=project?.scenes?.[selected];if(!scene)return;
 if(previewAnimation){previewAnimation.cancel();previewAnimation=null;}
 const media=$('preview-video').hidden?$('preview-image'):$('preview-video');
 if(media.hidden)return;
 const from={
  'zoom-in':'scale(1.02) translateX(0%)',
  'zoom-out':'scale(1.22) translateX(0%)',
  'pan-left':'scale(1.22) translateX(8%)',
  'pan-right':'scale(1.22) translateX(-8%)',
  'none':'scale(1) translateX(0%)'
 };
 const to={
  'zoom-in':'scale(1.22) translateX(0%)',
  'zoom-out':'scale(1.02) translateX(0%)',
  'pan-left':'scale(1.22) translateX(-8%)',
  'pan-right':'scale(1.22) translateX(8%)',
  'none':'scale(1) translateX(0%)'
 };
 previewAnimation=media.animate([{transform:from[scene.effect]||from.none},{transform:to[scene.effect]||to.none}],
  {duration:Math.max(700,scene.duration*1000/1.2),fill:'forwards',easing:'linear'});
}
// Mobile editor: keep scene controls immediately beneath the preview, not pages below it.
function positionEditorTools(){
 const props=document.querySelector('.properties');
 const main=document.querySelector('.editor-main');
 const mediaPanel=document.querySelector('.media-panel');
 const layout=document.querySelector('.layout');
 const ai=$('ai-workflow'),settings=$('project-settings');
 const mobile=window.matchMedia('(max-width: 900px)').matches;
 if(mobile){
  if(mediaPanel.parentElement!==layout)layout.prepend(mediaPanel);
  const details=document.getElementById('mobile-clip-details');
  const sceneTimeline=main.querySelector('.timeline-wrap');
  const worktop=main.querySelector('.worktop');
  // Mobile also follows scene timeline → details → precision editing.
  const afterStoryboard=sceneTimeline||worktop;
  if(details&&details.previousElementSibling!==afterStoryboard)afterStoryboard.after(details);
  const anchor=details||afterStoryboard;
  if(anchor.nextElementSibling!==props)anchor.after(props);
  // The project settings are a full-width page in the Project tab,
  // not a nested narrow panel inside the timeline or Sound tab.
  if(settings.parentElement!==layout)layout.prepend(settings);
 }else{
  if(mediaPanel.parentElement!==layout)layout.prepend(mediaPanel);
  if(settings.parentElement!==mediaPanel)mediaPanel.append(settings);
  if(props.parentElement!==layout)layout.append(props);
 }
}
window.addEventListener('resize',positionEditorTools);

function safeDuration(){return project.scenes.reduce((sum,s)=>sum+(Number(s.duration)||0),0)}
function fmt(t){return Math.floor(t/60).toString().padStart(2,'0')+':'+Math.floor(t%60).toString().padStart(2,'0')}
function render(){if(project&&!['off','ko-KR-SunHiNeural','ko-KR-InJoonNeural','ko-KR-HyunsuNeural'].includes(project.voice)){
 project.voice='ko-KR-SunHiNeural';
 $('voice-availability-note').textContent='이전에 선택한 목소리는 현재 지원되지 않아 선희를 임시 선택했어요. 미리듣기로 확인 후 저장하세요.';
 dirty=true;
}
 const picker=$('project-picker');picker.replaceChildren();for(const p of projects){const o=node('option',p.title);o.value=p.id;picker.append(o)}picker.value=project.id;$('project-title').value=project.title;$('voice').value=project.voice||'ko-KR-SunHiNeural';$('ai-voice').value=project.voice||'ko-KR-SunHiNeural';$('bgm-volume').value=String(Math.round((project.bgmVolume??0.16)*100));$('volume-label').textContent=$('bgm-volume').value+'%';
const bgm=$('bgm');bgm.replaceChildren(new Option('사용 안 함',''));for(const m of library.filter(isAudio)){bgm.append(new Option(m.name,m.id))}bgm.value=project.bgmId||'';const aiBgm=$('ai-bgm');aiBgm.replaceChildren(new Option('배경음악 없음',''));for(const m of library.filter(isAudio)){aiBgm.append(new Option(m.name,m.id))}aiBgm.value=project.bgmId||'';
const media=$('media-list');media.replaceChildren();
for(const f of library){
 const b=node('button',undefined,'media-item '+(isAudio(f)?'audio':'')+(f.id===selectedMediaId?' active':''));
 b.type='button';b.title=f.name;b.setAttribute('aria-pressed',String(f.id===selectedMediaId));
 if(!isAudio(f))previewMedia(f,b);else b.append(node('div','♫  '+f.name,'audio-icon'));
 b.append(node('strong',f.name));
 b.onclick=()=>{selectedMediaId=f.id;renderSelectedMedia();};
 media.append(b);
}
renderSelectedMedia();
const tl=$('timeline');tl.replaceChildren();project.scenes.forEach((s,i)=>{const file=library.find(f=>f.id===s.mediaId),b=node('button',undefined,'scene-card'+(i===selected?' active':''));if(file)previewMedia(file,b);b.append(node('span',fmt(s.duration),'time-label'),node('span',s.caption||`장면 ${i+1}`,'name'));b.onclick=()=>{selected=i;render();};tl.append(b)});
$('total-time').textContent=fmt(safeDuration());$('bgm-track').textContent=library.find(f=>f.id===project.bgmId)?.name||'배경음악 없음';$('narration-track').textContent=project.scenes.map(s=>s.narration?'●':'○').join('  ')||'음성 대사 없음';
stopPreview();const scene=project.scenes[selected],file=scene&&library.find(f=>f.id===scene.mediaId);$('empty-props').hidden=!!scene;$('scene-props').hidden=!scene;$('selected-label').textContent=scene?'장면 '+(selected+1)+' / '+project.scenes.length:'선택된 장면 없음';$('scene-indicator').textContent=scene?`장면 ${selected+1} / ${project.scenes.length}`:'장면 없음';$('preview-time').textContent=scene?fmt(scene.duration):'00:00';
$('preview-placeholder').hidden=!!file;$('preview-image').hidden=true;$('preview-video').hidden=true;const v=$('preview-video');v.pause();if(file){const el=$(file.group==='video'?'preview-video':'preview-image');el.src='/api/media/'+file.id;el.hidden=false;}
$('preview-caption').textContent=scene?.caption||'';$('preview-caption').className='caption '+(scene?.captionStyle||'impact')+' '+(scene?.captionPosition||'bottom');
positionEditorTools();if(scene){const voicePicker=$('scene-voice-media');voicePicker.replaceChildren(new Option('AI 음성 설정 또는 무음 사용',''));for(const audio of library.filter(isAudio))voicePicker.append(new Option(audio.name,audio.id));voicePicker.value=scene.voiceMediaId||'';for(const [name,key] of [['scene-duration','duration'],['scene-narration','narration'],['scene-caption','caption'],['caption-style','captionStyle'],['caption-position','captionPosition'],['scene-effect','effect']]){$(name).value=scene[key]??''}}}
for(const [name,key] of [['scene-duration','duration'],['scene-narration','narration'],['scene-caption','caption'],['caption-style','captionStyle'],['caption-position','captionPosition'],['scene-effect','effect']]){$(name).addEventListener('input',e=>{const scene=project.scenes[selected];if(!scene)return;scene[key]=key==='duration'?Number(e.target.value):e.target.value;setDirty();if(key!=='narration')renderPreview();});}
$('scene-voice-media').onchange=e=>{if(!project.scenes[selected])return;project.scenes[selected].voiceMediaId=e.target.value||null;setDirty();};
function renderPreview(){stopPreview();$('preview-caption').textContent=project.scenes[selected]?.caption||'';$('preview-caption').className='caption '+(project.scenes[selected]?.captionStyle||'impact')+' '+(project.scenes[selected]?.captionPosition||'bottom');$('total-time').textContent=fmt(safeDuration());}
$('project-title').oninput=e=>{project.title=e.target.value;setDirty()};$('voice').onchange=e=>{project.voice=e.target.value;$('ai-voice').value=e.target.value;setDirty()};$('ai-voice').onchange=e=>{project.voice=e.target.value;$('voice').value=e.target.value;setDirty()};$('ai-bgm').onchange=e=>{project.bgmId=e.target.value||null;$('bgm').value=project.bgmId||'';setDirty();render()};$('bgm').onchange=e=>{project.bgmId=e.target.value||null;setDirty();render()};$('bgm-volume').oninput=e=>{project.bgmVolume=Number(e.target.value)/100;$('volume-label').textContent=e.target.value+'%';setDirty()};
$('project-picker').onchange=e=>{if(dirty&&!confirm('저장되지 않은 변경이 있습니다. 다른 프로젝트로 이동할까요?')){e.target.value=project.id;return;}project=projects.find(p=>p.id===e.target.value);selected=0;dirty=false;renderedProjectId=null;$('full-review').hidden=true;render()};
$('create-project').onclick=async()=>{if(dirty)await save();const r=await api('/api/new','POST',{});projects.push(r.project);project=r.project;selected=0;dirty=false;renderedProjectId=null;$('full-review').hidden=true;render();};
async function save(){const r=await api('/api/projects','POST',project);project=r.project;projects=projects.map(p=>p.id===project.id?project:p);dirty=false;$('save-state').textContent='저장됨';render();}
$('save-project').onclick=()=>save().catch(e=>alert(e.message));
function reorder(step){const i=selected,to=i+step;if(to<0||to>=project.scenes.length)return;[project.scenes[to],project.scenes[i]]=[project.scenes[i],project.scenes[to]];selected=to;setDirty();render()}
$('move-left').onclick=()=>reorder(-1);$('move-right').onclick=()=>reorder(1);
$('duplicate-scene').onclick=()=>{const s=project.scenes[selected];if(!s)return;project.scenes.splice(selected+1,0,{...s,id:rand()});selected++;setDirty();render()};
$('remove-scene').onclick=()=>{if(!project.scenes[selected]||!confirm('이 장면을 삭제할까요?'))return;project.scenes.splice(selected,1);selected=Math.min(selected,Math.max(0,project.scenes.length-1));setDirty();render()};
$('play-scene').onclick=async()=>{
 const scene=project?.scenes?.[selected];if(!scene)return;
 stopPreview();animateCurrentScene();
 const mode=scene.audioMode||(scene.sourceType==='video'?'original':'narration');
 const v=$('preview-video');
 if(!v.hidden){
  v.muted=!(mode==='original'||mode==='mix');
  const seek=Number(scene.sourceIn||0);
  if(v.readyState>=1)v.currentTime=seek;
  else v.addEventListener('loadedmetadata',()=>{v.currentTime=seek},{once:true});
  v.play().catch(e=>$('voice-preview-status').textContent='영상 재생 실패: '+e.message);
  const length=(scene.sourceType==='video'?(Number(scene.sourceOut||scene.duration||4)-seek)/(Number(scene.speed||1)):Number(scene.duration||4))*1000;
  const clipId=scene.id;
  setTimeout(()=>{if(project?.scenes?.[selected]?.id===clipId)v.pause()},Math.max(250,length));
 }
 if(mode==='original'||mode==='mute'){$('voice-preview-status').textContent=mode==='original'?'원본 영상 소리 사용':'음성 없음';return;}
 if(scene.voiceMediaId){
  const audio=scenePreviewAudio();audio.src='/api/media/'+scene.voiceMediaId;audio.hidden=false;
  audio.play().catch(e=>$('voice-preview-status').textContent='음성 재생 실패: '+e.message);return;
 }
 if(scene.narration&&project.voice!=='off')await previewVoice(scene.narration,project.voice);
 else $('voice-preview-status').textContent=project.voice==='off'?'음성 없음 설정입니다.':'이 장면에 대사가 없습니다.';
};
$('preview-voice-choice').onclick=()=>{stopPreview();return previewVoice(undefined,$('ai-voice').value)};
$('preview-voice-project').onclick=()=>{stopPreview();return previewVoice(undefined,$('voice').value)};
$('ai-voice').addEventListener('change',()=>{stopPreview();void previewVoice(undefined,$('ai-voice').value)});
$('voice').addEventListener('change',()=>{stopPreview();void previewVoice(undefined,$('voice').value)});

$('upload-files').onchange=async e=>{const files=[...e.target.files],label=$('save-state');for(const file of files){try{label.textContent='업로드 중: '+file.name;const res=await fetch('/api/upload?name='+encodeURIComponent(file.name),{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':csrf,'Content-Type':'application/octet-stream'},body:file});const result=await res.json();if(!res.ok)throw Error(result.error);library.push(result.media);selectedMediaId=result.media.id;}catch(err){alert(file.name+': '+err.message)}}render();e.target.value='';};
async function checkExport(){
 try{
  const state=await api('/api/export/status');
  $('export-status').textContent=state.status==='running'?'제작 중: '+state.step:state.status==='done'?'제작 완료 · 전체 영상 보기 또는 다운로드':state.status==='failed'?'제작 실패: '+state.error:'내보내기 대기';
  $('download-result').hidden=state.status!=='done';
  if(state.status==='done'){
   const url='/api/export/'+state.filename;
   $('download-result').href=url+'?download=1';
   $('download-result').download='StudioEditor.mp4';
   if(state.projectId===project.id&&!dirty){
    renderedProjectId=project.id;
    $('full-review').hidden=false;
    $('full-review-note').textContent='완성 영상 '+Math.round(state.duration||0)+'초 · '+Math.round((state.bytes||0)/1024)+'KB';
    const video=$('full-video');
    if(!video.src.endsWith(url))video.src=url;
    $('full-download').href=url+'?download=1';
    if(openFullAfterRender){
     $('full-review').scrollIntoView({block:'start',behavior:'smooth'});
     video.play().catch(()=>{$('full-review-note').textContent+=' · 휴대폰 재생 버튼을 눌러주세요.'});
    }
   }
   openFullAfterRender=false;
  }
  if(state.status==='failed'){
   $('full-review').hidden=false;
   $('full-review-note').textContent='MP4 제작 실패: '+state.error;
   $('full-video').removeAttribute('src');
   $('full-download').hidden=true;
   openFullAfterRender=false;
  }else if(state.status==='done')$('full-download').hidden=false;
  if(state.status!=='running'&&poll){clearInterval(poll);poll=null}
 }catch(e){$('export-status').textContent='영상 제작 상태 확인 실패: '+e.message;}
}
async function startExport(showFull=false){
 try{
  if(showFull&&renderedProjectId===project.id&&!dirty&&!$('full-review').hidden){
   $('full-review').scrollIntoView({block:'start',behavior:'smooth'});
   $('full-video').play().catch(()=>{});return;
  }
  await save();
  openFullAfterRender=showFull;
  await api('/api/export','POST',{projectId:project.id});
  $('export-status').textContent='MP4 제작 시작 · 장면 렌더링 중';
  $('full-review').hidden=false;
  $('full-download').hidden=true;
  $('full-review-note').textContent='음성과 장면을 합성하고 있습니다. 완료되면 여기서 재생할 수 있어요.';
  $('download-result').hidden=true;
  if(poll)clearInterval(poll);
  poll=setInterval(checkExport,2000);await checkExport();
 }catch(e){
  $('export-status').textContent='제작 요청 실패: '+e.message;
  $('full-review').hidden=false;
  $('full-review-note').textContent='제작 요청 실패: '+e.message;
 }
}
$('export-btn').onclick=()=>startExport(false);
$('preview-full').onclick=()=>startExport(true);
void session();

// AI-first workflow: vision-guided storyboard, user approval, then normal scene editor.
async function updateAiStatus(){try{const x=await api('/api/ai/status');$('ai-key-btn').textContent=x.configured?'AI 연결됨 · 키 변경':'AI 키 설정';if(!x.configured)$('ai-status').textContent='Gemini 무료 사용량이 있는 API 키를 등록하면 업로드한 사진·영상 내용을 분석하고 초안을 만들 수 있습니다.';}catch(e){$('ai-status').textContent='AI 연결 확인 실패: '+e.message;}}
$('ai-key-btn').onclick=async()=>{const key=prompt('Gemini API 키를 입력하세요. PC 로컬 설정에 저장되며 공개 화면에는 표시되지 않습니다.');if(key===null)return;try{await api('/api/ai/config','POST',{key:key.trim()});await updateAiStatus();$('ai-status').textContent='AI 키가 설정되었습니다. 업로드한 사진·영상으로 초안을 만들 수 있습니다.';}catch(e){alert(e.message)}};
$('ai-select-all').onclick=()=>{$('ai-status').textContent='AI 초안 생성 시 현재 프로젝트에 연결된 사진·영상이 우선 사용됩니다. 장면이 없다면 업로드한 전체 미디어를 사용합니다.'};
function aiMedia(){const all=library.filter(f=>f.group==='image'||f.group==='video');return all.slice(-10).map(f=>f.id);}
async function pollAi(){try{const x=await api('/api/ai/draft/status');$('ai-status').textContent=x.status==='running'?'AI 작업 중: '+(x.step||'준비 중'):x.status==='failed'?'AI 실패: '+x.error:x.status==='done'?'AI 초안을 생성했습니다. 내용을 확인하고 편집기로 가져오세요.':'대기';if(x.status==='running')return;clearInterval(aiPoll);aiPoll=null;$('ai-generate').disabled=false;if(x.status==='done'&&x.projectId===project.id){aiDraft=x.draft;showAiDraft()}}catch(e){clearInterval(aiPoll);aiPoll=null;$('ai-generate').disabled=false;$('ai-status').textContent=e.message}}
$('ai-generate').onclick=async()=>{try{const mediaIds=aiMedia();if(!mediaIds.length)throw Error('먼저 사진 또는 영상을 업로드하세요.');if(dirty)await save();const requirements=$('ai-requirements').value.trim();if(requirements.length<5)throw Error('원하는 영상을 5자 이상 설명해 주세요.');$('ai-generate').disabled=true;await api('/api/ai/draft','POST',{projectId:project.id,mediaIds,requirements,productFacts:$('ai-facts').value,style:$('ai-style').value,voice:$('ai-voice').value,bgmId:$('ai-bgm').value||null,bgmVolume:project.bgmVolume});$('ai-status').textContent='이미지 분석 및 영상 대사 생성 중…';if(aiPoll)clearInterval(aiPoll);aiPoll=setInterval(pollAi,1500);await pollAi()}catch(e){$('ai-generate').disabled=false;$('ai-status').textContent='초안 생성 실패: '+e.message}};
function showAiDraft(){const root=$('ai-review-scenes');root.replaceChildren();$('ai-review-note').textContent=(aiDraft.notes||'AI가 생성한 장면입니다. 실제 사진과 대사의 일치 여부를 확인하세요.')+' | 음성: '+(aiDraft.voice==='off'?'없음':aiDraft.voice||'여성 기본')+' | 음악: '+(library.find(x=>x.id===aiDraft.bgmId)?.name||'없음');aiDraft.scenes.forEach((scene,i)=>{const media=library.find(f=>f.id===scene.mediaId);const div=node('div',undefined,'ai-review-scene');div.append(node('small',`장면 ${i+1} · ${media?.name||'미디어'} · ${scene.duration}초`),node('b','대사: '+scene.narration),node('p','자막: '+scene.caption));root.append(div)});$('ai-draft-review').hidden=false;$('ai-draft-review').scrollIntoView({behavior:'smooth',block:'start'})}
$('ai-apply').onclick=async()=>{if(!aiDraft)return;const replace=project.scenes.length?confirm('현재 프로젝트의 장면을 AI 초안으로 교체할까요? 이전 장면은 별도 프로젝트에 저장해 두는 것을 권장합니다.'):true;if(!replace)return;project.scenes=aiDraft.scenes.map(s=>({...s,id:rand(),voiceMediaId:null}));project.textClips=[];project.title=aiDraft.title||project.title;project.voice=aiDraft.voice||'ko-KR-SunHiNeural';project.bgmId=aiDraft.bgmId||null;project.bgmVolume=Number(aiDraft.bgmVolume??0.16);selected=0;aiDraft=null;$('ai-draft-review').hidden=true;setDirty();await save();$('ai-status').textContent='초안을 편집기에 적용했습니다. 장면별 대사·자막·스타일·위치를 수정한 뒤 MP4를 제작하세요.';};
$('ai-cancel').onclick=()=>{$('ai-draft-review').hidden=true;aiDraft=null;};