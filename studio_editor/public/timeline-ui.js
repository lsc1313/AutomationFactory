'use strict';
/* Studio Editor precision controls. Extends, never replaces, the AI storyboard UI. */
(function(){
 const get=id=>document.getElementById(id);
 const create=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el};
 const safeNum=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 let playhead=0,dragSource=-1;
 function duration(clip){
  if(!clip)return 0;
  const speed=clamp(safeNum(clip.speed,1),.5,2),repeats=clamp(safeNum(clip.repeats,1),1,40);
  return (clip.sourceType==='video'?Math.max(.1,safeNum(clip.sourceOut,4)-safeNum(clip.sourceIn,0))/speed:safeNum(clip.duration,4))*repeats;
 }
 function total(){return project?.scenes?.reduce((v,s)=>v+duration(s),0)||0}
 function fileOf(scene){return library.find(f=>f.id===scene?.mediaId)}
 function sceneStart(index){return project.scenes.slice(0,index).reduce((a,c)=>a+duration(c),0)}
 function ensureV2(){
  if(!project)return;
  project.schemaVersion=2;project.ratio=project.ratio||'9:16';
  for(const scene of project.scenes){
   if(scene.sourceType)continue;
   const f=fileOf(scene),isVideo=f?.group==='video';
   scene.sourceType=isVideo?'video':'image';scene.sourceIn=isVideo?Math.max(0,safeNum(scene.sourceIn,0)):0;
   scene.sourceOut=isVideo?Math.max(scene.sourceIn+.1,Math.min(safeNum(f.duration,scene.sourceIn+(scene.duration||4)),safeNum(scene.sourceOut,scene.sourceIn+(scene.duration||4)))):0;
   if(isVideo)scene.duration=scene.sourceOut-scene.sourceIn;
   scene.speed=1;scene.repeats=1;scene.volume=1;
   scene.audioMode=isVideo?'original':'narration';scene.captionStart=0;scene.captionEnd=scene.duration||4;
   scene.captionSize=56;scene.transition='cut';scene.fit='fill';
  }
 }
 function selectedScene(){return project?.scenes?.[selected]||null}
 function applyChange(fn){
  if(!project)return;ensureV2();fn();setDirty();render();
 }
 function makeUI(){
  if(get('v2-editor'))return;
  const section=create('section');section.id='v2-editor';section.className='v2-editor';
  section.innerHTML=`
   <div class="v2-heading"><b>정밀 타임라인 편집</b><small>원본은 그대로 · 선택한 클립만 수정</small></div>
   <div class="v2-settings">
    <label>화면 비율<select id="v2-ratio"><option value="9:16">세로 9:16</option><option value="16:9">가로 16:9</option><option value="1:1">정사각 1:1</option></select></label>
    <label>재생 위치<input id="v2-playhead" type="range" min="0" max="1000" value="0"><output id="v2-time">00:00 / 00:00</output></label>
   </div>
   <div class="v2-actions">
    <button id="v2-split">✂ 현재 위치에서 분할</button>
    <button id="v2-repeat">↻ 클립 복제</button>
    <button id="v2-remove" class="danger">선택 클립 삭제</button>
    <button id="v2-forward">↑ 앞에 배치</button><button id="v2-back">↓ 뒤에 배치</button>
   </div>
   <div id="v2-clip-settings" class="v2-clip-settings" hidden>
    <div class="v2-heading"><b>선택한 클립 상세 설정</b><small id="v2-asset">원본 파일</small></div>
    <div class="v2-grid">
     <label class="v2-video-only">원본 시작(초)<input id="v2-in" type="number" min="0" step="0.1"></label>
     <label class="v2-video-only">원본 종료(초)<input id="v2-out" type="number" min="0.1" step="0.1"></label>
     <label class="v2-photo-only">사진 표시 시간(초)<input id="v2-duration" type="number" min="0.2" max="1800" step="0.1"></label>
     <label>반복 횟수<input id="v2-repeats" type="number" min="1" max="40" step="1"></label>
     <label class="v2-video-only">재생 속도<select id="v2-speed"><option value="0.5">0.5× 느리게</option><option value="0.75">0.75×</option><option value="1">1× 원래 속도</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2× 빠르게</option></select></label>
     <label>소리 선택<select id="v2-audio"><option value="original">원본 영상 소리 유지</option><option value="narration">AI 음성 사용</option><option value="mix">원본 + AI 음성</option><option value="mute">음성 없음</option></select></label>
     <label>원본 소리 음량<input id="v2-volume" type="range" min="0" max="200" step="5"><output id="v2-volume-text">100%</output></label>
     <label>화면 채우기<select id="v2-fit"><option value="fill">화면 채우기 (일부 잘림)</option><option value="fit">전체 보기 (여백 허용)</option></select></label>
     <label>장면 전환<select id="v2-transition"><option value="cut">바로 전환</option><option value="fade">페이드</option></select></label>
     <label>자막 시작(초)<input id="v2-caption-in" type="number" min="0" step="0.1"></label>
     <label>자막 종료(초)<input id="v2-caption-out" type="number" min="0" step="0.1"></label>
     <label>자막 크기<input id="v2-font" type="range" min="20" max="108" step="1"><output id="v2-font-text">56</output></label>
    </div>
    <small id="v2-hint">변경한 설정은 즉시 프로젝트에 반영되며 MP4 제작 시 사용됩니다.</small>
   </div>`;
  document.querySelector('.timeline-wrap').before(section);
  get('v2-ratio').onchange=e=>applyChange(()=>project.ratio=e.target.value);
  get('v2-playhead').oninput=e=>{
   playhead=total()*Number(e.target.value)/1000;
   const location=locate(playhead);
   if(location.index!==selected){selected=location.index;render();}
   const s=selectedScene(),v=get('preview-video');
   if(s?.sourceType==='video'&&!v.hidden&&v.readyState>=1){
    const single=duration({...s,repeats:1});
    const seconds=s.sourceIn+((location.offset%single)*s.speed);
    try{v.currentTime=seconds;}catch{v.addEventListener('loadedmetadata',()=>{v.currentTime=seconds},{once:true})}
   }
   updatePlayheadLabel();
  };
  get('v2-split').onclick=()=>{
   try{const loc=locate(playhead),s=project.scenes[loc.index];if(!s)throw Error('분할할 클립을 선택하세요.');
    if(s.repeats>1)throw Error('반복 횟수를 1로 변경한 뒤 분할해 주세요.');
    const at=loc.offset;
    if(at<.15||at>duration(s)-.15)throw Error('클립 양 끝에서 0.15초 이상 떨어진 위치에서 분할해 주세요.');
    applyChange(()=>{
     const a={...s},b={...s,id:rand()};
     if(s.sourceType==='video'){
      const cut=s.sourceIn+at*s.speed;a.sourceOut=cut;b.sourceIn=cut;
     }else{a.duration=at;b.duration=s.duration-at;}
     a.captionEnd=Math.min(s.captionEnd??duration(s),at);
     b.captionStart=Math.max(0,(s.captionStart||0)-at);
     b.captionEnd=Math.max(0,(s.captionEnd||duration(s))-at);
     project.scenes.splice(loc.index,1,a,b);selected=loc.index+1;
    });
   }catch(e){alert('분할 실패: '+e.message)}
  };
  get('v2-repeat').onclick=()=>applyChange(()=>{
   const s=selectedScene();if(!s)return;project.scenes.splice(selected+1,0,{...s,id:rand()});selected++;
  });
  get('v2-remove').onclick=()=>{if(!selectedScene())return;if(!confirm('선택한 클립만 타임라인에서 삭제할까요? 원본 파일은 유지됩니다.'))return;
   applyChange(()=>{project.scenes.splice(selected,1);selected=Math.max(0,Math.min(selected,project.scenes.length-1));playhead=sceneStart(selected);});
  };
  get('v2-forward').onclick=()=>reorder(-1);
  get('v2-back').onclick=()=>reorder(1);
  const fields={'v2-in':['sourceIn',Number],'v2-out':['sourceOut',Number],'v2-duration':['duration',Number],
   'v2-repeats':['repeats',Number],'v2-speed':['speed',Number],'v2-audio':['audioMode',String],
   'v2-volume':['volume',v=>Number(v)/100],'v2-fit':['fit',String],'v2-transition':['transition',String],
   'v2-caption-in':['captionStart',Number],'v2-caption-out':['captionEnd',Number],'v2-font':['captionSize',Number]};
  for(const [id,[key,parse]] of Object.entries(fields)){
   get(id).onchange=e=>{
    const s=selectedScene();if(!s)return;
    const value=parse(e.target.value),original=s[key];
    s[key]=value;
    if(s.sourceType==='video'&&s.sourceOut<=s.sourceIn){s[key]=original;alert('영상 종료 지점은 시작 지점보다 뒤여야 합니다.');render();return;}
    if(s.sourceType==='video'&&s.sourceOut>safeNum(fileOf(s)?.duration,Infinity)+.15){s[key]=original;alert('원본 영상의 길이를 초과했습니다.');render();return;}
    if(s.sourceType==='video')s.duration=(s.sourceOut-s.sourceIn)/s.speed;
    setDirty();render();
   };
  }
 }
 function locate(position){let pos=0;for(let i=0;i<project.scenes.length;i++){
  const d=duration(project.scenes[i]);if(position<pos+d||i===project.scenes.length-1)return {index:i,offset:Math.max(0,position-pos)};pos+=d;
 }return {index:-1,offset:0}}
 function clock(sec){return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(Math.floor(sec%60)).padStart(2,'0')}
 function updatePlayheadLabel(){
  get('v2-time').textContent=clock(playhead)+' / '+clock(total());
  get('v2-playhead').value=total()?Math.round(playhead/total()*1000):0;
 }
 function reorder(delta){const next=selected+delta;if(next<0||next>=project.scenes.length)return;
  applyChange(()=>{const item=project.scenes.splice(selected,1)[0];project.scenes.splice(next,0,item);selected=next;playhead=sceneStart(selected);});
 }
 function update(){
  if(!project)return;ensureV2();makeUI();
  get('v2-ratio').value=project.ratio||'9:16';
  get('v2-clip-settings').hidden=!selectedScene();
  playhead=clamp(playhead,0,total());updatePlayheadLabel();
  const s=selectedScene(),file=fileOf(s);
  if(s){
   get('v2-asset').textContent=file?.name||'미디어 없음';
   const video=s.sourceType==='video';
   for(const e of document.querySelectorAll('.v2-video-only'))e.hidden=!video;
   for(const e of document.querySelectorAll('.v2-photo-only'))e.hidden=video;
   for(const [id,value] of Object.entries({
    'v2-in':s.sourceIn||0,'v2-out':s.sourceOut||0,'v2-duration':s.duration||4,'v2-repeats':s.repeats||1,
    'v2-speed':s.speed||1,'v2-audio':s.audioMode||'mute','v2-volume':Math.round((s.volume??1)*100),
    'v2-fit':s.fit||'fill','v2-transition':s.transition||'cut','v2-caption-in':s.captionStart||0,
    'v2-caption-out':s.captionEnd??duration(s),'v2-font':s.captionSize||56
   }))get(id).value=String(value);
   get('v2-volume-text').textContent=Math.round((s.volume??1)*100)+'%';
   get('v2-font-text').textContent=s.captionSize||56;
   get('v2-hint').textContent='클립 길이 '+duration(s).toFixed(1)+'초 · '+(s.repeats||1)+'회 · 전체 '+clock(total());
  }
  const shape=project.ratio||'9:16',preview=document.querySelector('.phone-preview');
  preview.style.aspectRatio=shape==='16:9'?'16 / 9':shape==='1:1'?'1 / 1':'9 / 16';
  preview.style.width=shape==='16:9'?'min(100%,480px)':shape==='1:1'?'min(100%,320px)':'';
  const cards=[...get('timeline').children];cards.forEach((b,i)=>{
   const c=project.scenes[i];b.draggable=true;
   b.title=(i+1)+'번 클립 / '+duration(c).toFixed(1)+'초 / 드래그로 순서 이동';
   b.addEventListener('click',()=>{playhead=sceneStart(i);updatePlayheadLabel();});
   b.style.flexBasis=clamp(Math.round(duration(c)*13),95,260)+'px';
   b.ondragstart=()=>{dragSource=i};
   b.ondragover=e=>e.preventDefault();
   b.ondrop=e=>{e.preventDefault();if(dragSource===i||dragSource<0)return;
    applyChange(()=>{const c=project.scenes.splice(dragSource,1)[0];project.scenes.splice(i,0,c);selected=i;playhead=sceneStart(i);});dragSource=-1;};
  });
  // Existing AI scene/caption/music strips remain, but show meaningful durations.
  get('narration-track').textContent=project.scenes.map(c=>c.narration?'🎙 '+duration(c).toFixed(1)+'s':'— '+duration(c).toFixed(1)+'s').join(' | ');
 }
 // Preserve existing event handlers for AI, uploads and manual subtitles.
 const originalRender=render;
 render=function(){if(project)ensureV2();originalRender();update()};
 const originalSetDirty=setDirty;
 setDirty=function(){originalSetDirty();const el=get('v2-editor');if(el)el.dataset.dirty='true'};
 const originalSave=save;
 save=async function(){if(project)ensureV2();return originalSave()};
 // Keep upload and AI draft flows unmodified; render() upgrades their resulting clips in memory.
 // Sync legacy duration input with source bounds for video editing.
 get('scene-duration').addEventListener('change',()=>{
  const s=selectedScene();if(!s||s.sourceType!=='video')return;
  s.sourceOut=s.sourceIn+clamp(safeNum(s.duration,4),.2,1800)*(s.speed||1);
  setDirty();render();
 });
 makeUI();
})();