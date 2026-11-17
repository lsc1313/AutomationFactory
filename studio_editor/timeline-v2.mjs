/** Studio Editor v1.0: non-destructive photo/video timeline. */
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,stat,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

export const id=()=>randomBytes(12).toString('hex');
const finite=(n,fallback)=>Number.isFinite(Number(n))?Number(n):fallback;
const limit=(n,a,b)=>Math.min(b,Math.max(a,n));
export const CANVASES={'9:16':{width:720,height:1280},'16:9':{width:1280,height:720},'1:1':{width:720,height:720}};
export const EFFECTS=['none','zoom-in','zoom-out','pan-left','pan-right'];
export const MODES=['original','narration','mix','mute'];
export function canvasFor(ratio){return CANVASES[ratio]||CANVASES['9:16'];}
export function clipMs(clip){
 const reps=limit(Math.floor(finite(clip.repeats,1)),1,40),speed=limit(finite(clip.speed,1),0.5,2);
 if(clip.sourceType==='image')return Math.round(limit(finite(clip.duration,4),0.2,1800)*1000)*reps;
 const start=limit(finite(clip.sourceIn,0),0,72000),end=Math.max(start+0.1,finite(clip.sourceOut,start+finite(clip.duration,4)));
 return Math.round((end-start)/speed*1000)*reps;
}
export function timelineDuration(project){return (project.scenes||[]).reduce((sum,c)=>sum+clipMs(c),0);}
export function sourceClip(raw,media){
 const f=media.find(x=>x.id===raw.mediaId);if(!f||!['image','video'].includes(f.group))throw Error('클립의 원본 사진/영상을 찾지 못했습니다.');
 const sourceType=f.group, speed=limit(finite(raw.speed,1),0.5,2);
 const durationSec=limit(finite(raw.duration,sourceType==='video'?Math.min(f.duration||10,15):4),0.2,1800);
 const sourceIn=sourceType==='video'?limit(finite(raw.sourceIn,0),0,72000):0;
 const sourceOut=sourceType==='video'?limit(finite(raw.sourceOut,Math.min(sourceIn+durationSec,f.duration||sourceIn+durationSec)),sourceIn+0.1,72000):0;
 if(sourceType==='video'&&f.duration&&sourceOut>f.duration+0.15)throw Error('영상 자르기 종료점이 원본 길이를 초과합니다.');
 const clip={
  id:/^[0-9a-f]{24}$/.test(raw.id||'')?raw.id:id(),mediaId:f.id,sourceType,sourceIn,sourceOut,
  duration:sourceType==='image'?durationSec:(sourceOut-sourceIn)/speed,
  repeats:limit(Math.floor(finite(raw.repeats,1)),1,40),speed,
  effect:EFFECTS.includes(raw.effect)?raw.effect:'none',
  volume:limit(finite(raw.volume,1),0,2),
  audioMode:MODES.includes(raw.audioMode)?raw.audioMode:(sourceType==='video'?'original':'narration'),
  caption:String(raw.caption||'').slice(0,1200),narration:String(raw.narration||'').slice(0,1600),
  captionStart:Math.max(0,finite(raw.captionStart,0)),captionEnd:Math.max(0,finite(raw.captionEnd,0)),
  captionStyle:['impact','minimal','boxed','clean'].includes(raw.captionStyle)?raw.captionStyle:'impact',
  captionPosition:['top','middle','bottom'].includes(raw.captionPosition)?raw.captionPosition:'bottom',
  captionSize:limit(finite(raw.captionSize,56),20,108),voiceMediaId:raw.voiceMediaId||null,
  fit:raw.fit==='fit'?'fit':'fill',transition:raw.transition==='fade'?'fade':'cut'
 };
 const seg=clipMs({...clip,repeats:1})/1000;
 clip.captionStart=limit(clip.captionStart,0,seg);
 clip.captionEnd=clip.captionEnd<=0?seg:limit(clip.captionEnd,clip.captionStart,seg);
 return clip;
}
export function normalizeTimeline(project,media){
 const ratio=CANVASES[project.ratio]?project.ratio:'9:16';
 const scenes=Array.isArray(project.scenes)?project.scenes:[];
 if(scenes.length>160)throw Error('타임라인 클립은 최대 160개입니다.');
 const normalized={...project,schemaVersion:2,ratio,scenes:scenes.map(c=>sourceClip(c,media))};
 const total=timelineDuration(normalized);
 normalized.audioClips=(Array.isArray(project.audioClips)?project.audioClips:[]).slice(0,100).map(a=>({
  id:/^[0-9a-f]{24}$/.test(a.id||'')?a.id:id(),
  mediaId:a.mediaId,startMs:limit(Math.round(finite(a.startMs,0)),0,total),
  durationMs:limit(Math.round(finite(a.durationMs,3000)),100,Math.max(100,total)),
  volume:limit(finite(a.volume,.3),0,2)
 })).filter(a=>media.some(f=>f.id===a.mediaId&&f.group==='music')&&a.startMs<total)
 .map(a=>({...a,durationMs:Math.min(a.durationMs,total-a.startMs)}));
 normalized.textClips=(Array.isArray(project.textClips)?project.textClips:[]).slice(0,500).map(t=>({
  id:/^[0-9a-f]{24}$/.test(t.id||'')?t.id:id(),text:String(t.text||'').slice(0,1200),
  startMs:limit(Math.round(finite(t.startMs,0)),0,total),endMs:limit(Math.round(finite(t.endMs,1000)),0,total),
  size:limit(Math.round(finite(t.size,50)),20,108),position:['top','middle','bottom'].includes(t.position)?t.position:'bottom'
 })).filter(t=>t.endMs>t.startMs);
 if(timelineDuration(normalized)>3600000)throw Error('최종 영상은 60분 이내로 편집하세요.');
 return normalized;
}
export function moveClip(clips,index,to){if(index<0||index>=clips.length||to<0||to>=clips.length)return clips.slice();const out=clips.slice();out.splice(to,0,out.splice(index,1)[0]);return out;}
export function duplicateClip(clips,index){if(!clips[index])return clips.slice();const out=clips.slice();out.splice(index+1,0,{...clips[index],id:id()});return out;}
export function splitClip(clips,index,atSeconds){
 const clip=clips[index];if(!clip)return clips.slice();const single=clipMs({...clip,repeats:1})/1000;
 if(clip.repeats!==1)throw Error('반복 클립은 반복을 1회로 변경한 뒤 분할하세요.');
 if(atSeconds<0.15||atSeconds>single-0.15)throw Error('분할 위치는 클립 양 끝에서 최소 0.15초 떨어져야 합니다.');
 let left,right;
 if(clip.sourceType==='video'){
  const cut=clip.sourceIn+atSeconds*clip.speed;
  left={...clip,sourceOut:cut,duration:atSeconds,captionEnd:Math.min(clip.captionEnd,atSeconds)};
  right={...clip,id:id(),sourceIn:cut,duration:single-atSeconds,captionStart:Math.max(0,clip.captionStart-atSeconds),captionEnd:Math.max(0,clip.captionEnd-atSeconds)};
 }else{
  left={...clip,duration:atSeconds,captionEnd:Math.min(clip.captionEnd,atSeconds)};
  right={...clip,id:id(),duration:single-atSeconds,captionStart:Math.max(0,clip.captionStart-atSeconds),captionEnd:Math.max(0,clip.captionEnd-atSeconds)};
 }
 const out=clips.slice();out.splice(index,1,left,right);return out;
}
export function splitAtPlayhead(clips,playheadMs){
 let cursor=0;for(let i=0;i<clips.length;i++){
  const d=clipMs(clips[i]);if(playheadMs>cursor&&playheadMs<cursor+d)return {scenes:splitClip(clips,i,(playheadMs-cursor)/1000),selected:i+1};
  cursor+=d;
 }throw Error('재생 위치가 분할 가능한 클립 내부에 있지 않습니다.');
}
export function locateClip(clips,ms){let cursor=0;for(let i=0;i<clips.length;i++){
 const length=clipMs(clips[i]);if(ms<cursor+length||i===clips.length-1)return {index:i,offsetMs:Math.max(0,ms-cursor),startMs:cursor,lengthMs:length};cursor+=length;
 }return {index:-1,offsetMs:0,startMs:0,lengthMs:0};}
export function renderPlan(project){
 const entries=[],canvas=canvasFor(project.ratio);let cursorMs=0;
 for(const c of project.scenes||[]){const singleMs=clipMs({...c,repeats:1});for(let n=0;n<limit(c.repeats||1,1,40);n++){
 entries.push({clip:{...c,repeats:1},timelineStartMs:cursorMs,durationMs:singleMs,index:entries.length});cursorMs+=singleMs;
 }}
 if(!entries.length)throw Error('편집할 클립이 없습니다.');if(cursorMs>3600000)throw Error('1시간을 초과하는 영상은 지원하지 않습니다.');
 return {entries,canvas,durationMs:cursorMs};
}
function assEscape(t){return String(t||'').replace(/\\/g,'').replace(/\{/g,'(').replace(/\}/g,')').replace(/\r?\n/g,'\\N');}
function assTime(s){let c=Math.round(s*100);return Math.floor(c/360000)+':'+String(Math.floor(c/6000)%60).padStart(2,'0')+':'+String(Math.floor(c/100)%60).padStart(2,'0')+'.'+String(c%100).padStart(2,'0');}
export function clipAss(c,duration,canvas,overlays=[]){
 const size=Math.round(c.captionSize||56),start=Math.min(duration,Math.max(0,c.captionStart||0)),end=Math.max(start,Math.min(duration,c.captionEnd||duration));
 const align=c.captionPosition==='top'?8:c.captionPosition==='middle'?5:2;
 const overlayEvents=overlays.filter(t=>t.text&&t.endMs>t.startMs).map(t=>{
  const align=t.position==='top'?8:t.position==='middle'?5:2;
  return `Dialogue: 1,${assTime(t.startMs/1000)},${assTime(t.endMs/1000)},Caption,,0,0,0,,{\\an${align}\\fs${t.size}}${assEscape(t.text)}\n`;
 }).join('');
 return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${canvas.width}\nPlayResY: ${canvas.height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Caption,Malgun Gothic,${size},&H00FFFFFF,&H000000FF,&H00000000,&HFF000000,-1,0,0,0,100,100,0,0,1,3,1,${align},45,45,110,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\nDialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${assEscape(c.caption)}\n${overlayEvents}`;
}
export function visualFilter(c,canvas,totalFrames){
 const w=canvas.width,h=canvas.height,elapsed=`min(1,on/${Math.max(1,Math.round(Math.max(2,totalFrames)/1.2)-1)})`;
 let zoom='1.02',x='iw/2-iw/zoom/2';
 if(c.effect==='zoom-in')zoom=`1.02+0.18*${elapsed}`;
 if(c.effect==='zoom-out')zoom=`1.20-0.18*${elapsed}`;
 if(c.effect==='pan-left'||c.effect==='pan-right'){
  zoom='1.18';x=c.effect==='pan-left'?`(iw-iw/zoom)*(1-${elapsed})`:`(iw-iw/zoom)*${elapsed}`;
 }
 const fit=c.fit==='fit'?`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`:`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
 return `[0:v]setpts=(PTS-STARTPTS)/${c.sourceType==='video'?limit(finite(c.speed,1),0.5,2):1},fps=24,${fit},setsar=1,zoompan=z='${zoom}':x='${x}':y='ih/2-ih/zoom/2':d=1:s=${w}x${h}:fps=24,format=yuv420p,ass=caption.ass${c.transition==='fade'?`,fade=t=in:st=0:d=0.2,fade=t=out:st=${Math.max(0,totalFrames/24-.2).toFixed(3)}:d=0.2`:''}[v]`;
}
export function run(exe,args,{cwd,timeout=300000}={}){
 return new Promise((resolve,reject)=>{const p=spawn(exe,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',done=false;
  const timer=setTimeout(()=>p.kill(),timeout);p.stderr.on('data',x=>output=(output+x.toString()).slice(-6000));p.stdout.on('data',x=>output=(output+x.toString()).slice(-6000));
  p.once('error',err=>{if(done)return;done=true;clearTimeout(timer);reject(Error(exe+': '+err.message))});
  p.once('close',code=>{if(done)return;done=true;clearTimeout(timer);code===0?resolve(output):reject(Error(exe+' 오류: '+output.slice(-1600)))})
 });
}
function atempo(speed){return `atempo=${limit(speed,0.5,2).toFixed(4)}`;}
export async function renderTimeline(project,media,{outputDir,mediaDir,onStep=()=>{},synthesizeVoice=null,executor=run}={}){
 const normalized=normalizeTimeline(project,media),{entries,canvas,durationMs}=renderPlan(normalized);
 const job=id(),folder=path.join(outputDir,'timeline-'+job);await mkdir(folder,{recursive:true});
 const byId=new Map(media.map(f=>[f.id,f]));const segments=[];
 for(let i=0;i<entries.length;i++){
  const clip=entries[i].clip,asset=byId.get(clip.mediaId),duration=entries[i].durationMs/1000;
  onStep(`클립 ${i+1}/${entries.length} 렌더링`);
  const source=path.join(mediaDir,asset.id+'.'+asset.ext),segment='part-'+String(i).padStart(4,'0')+'.mp4';
  const overlayStart=entries[i].timelineStartMs,overlayEnd=overlayStart+entries[i].durationMs;
  const overlays=(normalized.textClips||[]).filter(t=>t.startMs<overlayEnd&&t.endMs>overlayStart).map(t=>({...t,
   startMs:Math.max(0,t.startMs-overlayStart),endMs:Math.min(entries[i].durationMs,t.endMs-overlayStart)}));
  await writeFile(path.join(folder,'caption.ass'),clipAss(clip,duration,canvas,overlays));
  const args=['-hide_banner','-loglevel','error','-y'];
  if(clip.sourceType==='image')args.push('-loop','1','-framerate','24');else args.push('-ss',String(clip.sourceIn));
  args.push('-i',source);
  const needsVoice=(clip.audioMode==='narration'||clip.audioMode==='mix')&&project.voice!=='off';
  const haveSourceAudio=clip.sourceType==='video'&&asset.hasAudio===true&&['original','mix'].includes(clip.audioMode);
  let voicePath=null,voiceInput=-1;
  if(needsVoice&&clip.voiceMediaId&&byId.has(clip.voiceMediaId)){
   const track=byId.get(clip.voiceMediaId);voicePath=path.join(mediaDir,track.id+'.'+track.ext);
  }else if(needsVoice&&clip.narration?.trim()){
   if(!synthesizeVoice)throw Error('AI 음성 엔진이 설정되지 않았습니다.');
   voicePath=path.join(folder,'voice-'+i+'.mp3');await synthesizeVoice(project.voice||'ko-KR-SunHiNeural',clip.narration,voicePath,folder);
  }
  if(voicePath){voiceInput=1;args.push('-i',voicePath)}
  if(!haveSourceAudio&&voiceInput===-1)args.push('-f','lavfi','-i','anullsrc=r=44100:cl=stereo');
  const graph=[visualFilter(clip,canvas,Math.ceil(duration*24))];
  const sourceAudio=haveSourceAudio?`[0:a]atrim=duration=${(clip.sourceOut-clip.sourceIn).toFixed(3)},asetpts=PTS-STARTPTS,${atempo(clip.speed)},volume=${clip.volume}[orig]`:null;
  if(sourceAudio)graph.push(sourceAudio);
  const parts=[];if(sourceAudio)parts.push('[orig]');
  if(voiceInput>=0){graph.push(`[${voiceInput}:a]aresample=44100,apad,atrim=duration=${duration.toFixed(3)}[voice]`);parts.push('[voice]')}
  let audioMap;
  if(!parts.length)audioMap='1:a:0';
  else if(parts.length===1)audioMap=parts[0];
  else{graph.push(parts.join('')+'amix=inputs=2:duration=first:dropout_transition=0[a]');audioMap='[a]'}
  args.push('-filter_complex',graph.join(';'),'-map','[v]','-map',audioMap,'-t',String(duration),
   '-c:v','libx264','-preset','veryfast','-crf','25','-pix_fmt','yuv420p','-r','24',
   '-c:a','aac','-b:a','128k','-ar','44100','-ac','2','-movflags','+faststart',segment);
  await executor('ffmpeg',args,{cwd:folder,timeout:480000});segments.push(segment);
 }
 await writeFile(path.join(folder,'concat.txt'),segments.map(s=>`file '${s}'`).join('\n'));
 onStep('장면 병합');await executor('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i','concat.txt','-c','copy','joined.mp4'],{cwd:folder,timeout:240000});
 let finalFile='joined.mp4';
 const extraTracks=[];
 if(normalized.bgmId){
  const bg=byId.get(normalized.bgmId);
  if(!bg||bg.group!=='music')throw Error('선택한 배경음악을 찾을 수 없습니다.');
  extraTracks.push({mediaId:bg.id,startMs:0,durationMs,volume:limit(finite(normalized.bgmVolume,.16),0,1)});
 }
 for(const a of normalized.audioClips||[])extraTracks.push(a);
 if(extraTracks.length){
  onStep('음악·독립 오디오 트랙 믹싱');
  const args=['-hide_banner','-loglevel','error','-y','-i','joined.mp4'];
  const graph=[],parts=['[0:a]'];
  for(let i=0;i<extraTracks.length;i++){
   const a=extraTracks[i],f=byId.get(a.mediaId),inputIndex=i+1;
   args.push('-stream_loop','-1','-i',path.join(mediaDir,f.id+'.'+f.ext));
   const seconds=Math.min(a.durationMs,durationMs-a.startMs)/1000,delay=Math.round(a.startMs);
   graph.push(`[${inputIndex}:a]aresample=44100,atrim=duration=${seconds.toFixed(3)},asetpts=PTS-STARTPTS,volume=${a.volume},adelay=${delay}|${delay}[extra${i}]`);
   parts.push(`[extra${i}]`);
  }
  graph.push(parts.join('')+`amix=inputs=${parts.length}:duration=first:dropout_transition=0[a]`);
  args.push('-filter_complex',graph.join(';'),'-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','160k','-t',String(durationMs/1000),'-movflags','+faststart','final.mp4');
  await executor('ffmpeg',args,{cwd:folder,timeout:240000});finalFile='final.mp4';
 }

 const destination=path.join(outputDir,job+'.mp4');await copyFile(path.join(folder,finalFile),destination);
 const bytes=(await stat(destination)).size;if(bytes<10000)throw Error('MP4 파일이 비정상적으로 작습니다.');
 return {filename:job+'.mp4',duration:durationMs/1000,bytes};
}