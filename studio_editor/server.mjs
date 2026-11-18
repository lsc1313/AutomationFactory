/** ShortsAI Studio Editor — standalone local-first browser video editor.
 * No external dependencies; FFmpeg renders exports on the owner's computer.
 */
import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, readdir, copyFile, stat, rename, open, rm } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, openSync, closeSync } from 'node:fs';
import {generateAiDraft,findExistingGeminiKey} from './ai-draft.mjs';
import {normalizeTimeline,renderTimeline,clipMs,timelineDuration,CANVASES} from './timeline-v2.mjs';
import {transcribeLocal} from './stt-server.mjs';
import {validateBlogPost,blogPostForList} from './blog-engine.mjs';
import {validateWritingSample,buildPersonalWritingPrompt} from './blog-writing-style.mjs';
import {preferredModels,parseModelJson} from './ai-draft.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const STATE=path.resolve(process.env.STUDIO_DATA_DIR||path.join(ROOT,'private'));
const PORT=Number(process.env.STUDIO_PORT||8050);
const HOST=process.env.STUDIO_PUBLIC_HOST?.toLowerCase()||'';
const TRUST=process.env.STUDIO_TRUST_PROXY==='1';
const GUEST=process.env.STUDIO_GUEST_MODE==='1';
const GUEST_HASH=String(process.env.STUDIO_GUEST_TOKEN_HASH||'');
const GUEST_EXPIRES=Number(process.env.STUDIO_GUEST_EXPIRES_AT||0);
const GUEST_STOP_FILE=process.env.STUDIO_GUEST_STOP_FILE||'';
const GUEST_LIMITS={drafts:3,previews:8,exports:5,uploads:15,bytes:160_000_000,transcriptions:2};
const guestUsage={drafts:0,previews:0,exports:0,uploads:0,bytes:0,transcriptions:0};
let guestLaunchAt=0;
function guestQuota(key,amount=1){
 if(!GUEST)return;
 if(guestUsage[key]+amount>GUEST_LIMITS[key])throw makeError(429,'지인 체험의 '+({drafts:'AI 초안',previews:'음성 미리듣기',exports:'MP4 제작',uploads:'업로드 개수',bytes:'총 업로드 용량',transcriptions:'자동 자막 인식'}[key]||'')+' 제한에 도달했습니다.');
 guestUsage[key]+=amount;
}
function guestActive(){
 return GUEST&&/^[0-9a-f]{64}$/.test(GUEST_HASH)&&GUEST_EXPIRES>Date.now()&&(!GUEST_STOP_FILE||!existsSync(GUEST_STOP_FILE));
}
const APP_HEADER={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"};
const hex=()=>randomBytes(12).toString('hex');
export const DEFAULT_VOICE='ko-KR-SunHiNeural';
// Only expose voices observed as usable through our Edge TTS route. Official Azure
// voice listings do not guarantee the anonymous edge-tts endpoint can synthesize them.
export const VOICES=Object.freeze(['off','ko-KR-SunHiNeural','ko-KR-InJoonNeural','ko-KR-HyunsuNeural']);
export const UNVERIFIED_VOICES=Object.freeze(['ko-KR-JiMinNeural','ko-KR-SeoHyeonNeural','ko-KR-YuJinNeural']);
export function availableVoice(voice){return VOICES.includes(voice)?voice:DEFAULT_VOICE;}
export function audioPlan(project){return {voice:availableVoice(project.voice),bgmId:project.bgmId||null,bgmVolume:Number(project.bgmVolume??0.16)};}
const validId=id=>/^[0-9a-f]{24}$/.test(String(id||''));
const json=(res,status,obj,headers={})=>{res.writeHead(status,{...APP_HEADER,'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(obj));};
const makeError=(status,message)=>Object.assign(new Error(message),{status});
const addrLocal=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const isLocalHost=h=>['127.0.0.1','localhost','[::1]'].includes(h.toLowerCase());
const cfgPath=path.join(STATE,'auth.json');
const accountsPath=path.join(STATE,'accounts.json');
const requestScope=new AsyncLocalStorage();
const currentUser=()=>requestScope.getStore()?.userId||'owner';
// Legacy projects stay in private/. Every newly registered account receives a
// separate directory; no paths are selected from user-provided values.
const userRoot=()=>currentUser()==='owner'?STATE:path.join(STATE,'users',currentUser());
const projectFile=()=>path.join(userRoot(),'projects.json');
const mediaListFile=()=>path.join(userRoot(),'media.json');
const blogFile=()=>path.join(userRoot(),'blog-posts.json');
const writingSamplesFile=()=>path.join(userRoot(),'writing-samples.json');
const userMediaDir=()=>path.join(userRoot(),'media');
const userOutputDir=()=>path.join(userRoot(),'exports');
const userKeyFile=()=>path.join(userRoot(),'ai-config.json');
const ownedJob=job=>job.ownerId&&job.ownerId!==currentUser()?{status:'idle',step:null,error:null}:job;

async function streamUpload(req,maxBytes=1_073_741_824){
 const dir=path.join(userRoot(),'incoming');await mkdir(dir,{recursive:true});
 const temp=path.join(dir,hex()+'.upload'),fd=await open(temp,'wx');let total=0,head=Buffer.alloc(0);
 try{
  for await(const chunk of req){
   total+=chunk.length;
   if(total>maxBytes)throw makeError(413,'파일이 1GB를 초과했습니다. 더 작은 파일로 나누어 올려주세요.');
   if(head.length<16)head=Buffer.concat([head,chunk.subarray(0,16-head.length)]);
   await fd.write(chunk);
  }
  await fd.close();return {temp,total,head};
 }catch(e){await fd.close().catch(()=>{});await rm(temp,{force:true}).catch(()=>{});throw e;}
}
async function enrichMedia(media){
 let changed=false;
 const updated=await Promise.all(media.map(async f=>{
  if(f.group!=='video'||(f.duration&&typeof f.hasAudio==='boolean'))return f;
  try{
   const info=await probe(path.join(userMediaDir(),f.id+'.'+f.ext));
   changed=true;return {...f,duration:Number(info.format?.duration)||null,hasAudio:info.streams?.some(s=>s.codec_type==='audio')||false};
  }catch{return f;}
 }));
 if(changed)await saveJson(mediaListFile(),updated);
 return updated;
}
const sessions=new Map();
const loginFailures=new Map();
let exportJob={status:'idle',error:null,filename:null,projectId:null,step:null};
let draftJob={status:'idle',error:null,step:null,projectId:null,draft:null};
let sttJob={status:'idle',error:null,step:null,projectId:null,clipId:null,segments:null};
const keyPath=userKeyFile;
async function aiKey(){
 const cfg=await loadJson(keyPath(),{});
 const guestConfig=GUEST&&process.env.STUDIO_GUEST_AI_CONFIG_PATH?
  await loadJson(process.env.STUDIO_GUEST_AI_CONFIG_PATH,{}):{};
 return cfg.geminiKey||guestConfig.geminiKey||await findExistingGeminiKey();
}
async function loadJson(filename,fallback){try{return JSON.parse(await readFile(filename,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function saveJson(filename,value){await mkdir(path.dirname(filename),{recursive:true});const tmp=filename+'.'+hex()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});await (await import('node:fs/promises')).rename(tmp,filename);}
async function body(req,max=1_000_000){let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw makeError(413,'요청 용량을 초과했습니다.');parts.push(chunk);}return Buffer.concat(parts);}
async function data(req,max){let obj;try{obj=JSON.parse((await body(req,max)).toString());}catch(e){if(e.status)throw e;throw makeError(400,'JSON 형식이 잘못되었습니다.');}return obj;}
function mime(ext){return({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.mp4':'video/mp4','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4'})[ext]||'application/octet-stream';}
function run(exe,args,{cwd,timeout=240000}={}){return new Promise((resolve,reject)=>{let log='';const p=spawn(exe,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let expired=false;const timer=setTimeout(()=>{expired=true;p.kill();},timeout);p.stdout.on('data',d=>{log=(log+d.toString()).slice(-3000)});p.stderr.on('data',d=>{log=(log+d.toString()).slice(-3000)});p.on('error',e=>{clearTimeout(timer);reject(new Error(exe+' 실행 실패: '+e.message));});p.on('close',c=>{clearTimeout(timer);if(expired)reject(new Error(exe+' 실행 시간 초과'));else if(c!==0)reject(new Error(exe+' 실패: '+log.slice(-600)));else resolve(log)});});}
export function windowsPythonPaths(localAppData=process.env.LOCALAPPDATA){
 const base=localAppData?path.join(localAppData,'Programs','Python'):null;
 return base?['Python314','Python313','Python312','Python311','Python310','Python39']
  .map(v=>path.join(base,v,'python.exe')):[];
}
function voiceFailureDetail(err){
 const detail=String(err?.message||err||'');
 const explicit=detail.match(/TTS_ERROR:[ ]*([^\r\n]+)/);
 if(explicit)return explicit[1].slice(0,380);
 const early=detail.split(/Exception ignored in:|ProactorBasePipeTransport[.]__del__/)[0];
 return (early.trim()||detail).slice(-380);
}
export async function synthesizeVoice(voice,text,out,cwd,runner=run,options={}){
 if(!VOICES.includes(voice)||voice==='off')throw new Error('음성 설정을 확인하세요.');
 const args=['--voice',voice,'--text',text,'--write-media',out];
 const platform=options.platform||process.platform;
 const bridge=path.join(ROOT,'tts_windows.py');
 const pythonChoices=platform==='win32'
  ? [...new Set([process.env.STUDIO_PYTHON,...windowsPythonPaths(options.localAppData),'python','py'].flat().filter(Boolean))]
  : ['python3','python'];
 const attempts=[];
 for(const exe of pythonChoices){
  try{
   await runner(exe,[...(exe==='py'?['-3']:[]),bridge,...args],{cwd,timeout:45000});
   const result=await stat(out).catch(()=>null);
   if(result&&result.size>=500)return;
   attempts.push(exe+': output missing');
  }catch(error){attempts.push(exe+': '+voiceFailureDetail(error));}
 }
 // Last resort: cli may use a different Python installation or a standalone binary.
 try{
  await runner('edge-tts',args,{cwd,timeout:45000});
  const result=await stat(out).catch(()=>null);
  if(result&&result.size>=500)return;
 }catch(error){attempts.push('edge-tts: '+voiceFailureDetail(error));}
 throw new Error('AI 음성 생성 실패. Python TTS 또는 서비스 연결을 확인하세요. '
  + attempts.filter(Boolean).slice(-3).join(' | '));
}
const voiceSamples=new Map();
let voicePreviewBusy=false;
const voiceSampleDir=()=>path.join(userRoot(),'voice-previews');
async function makeVoicePreview(voice,text){
 const normalized=safeText(text,160);
 if(!VOICES.includes(voice)||voice==='off')throw makeError(400,'미리듣기 음성을 선택하세요.');
 if(!normalized)throw makeError(400,'대사가 비어 있습니다.');
 const id=createHash('sha256').update(voice+'|'+normalized).digest('hex').slice(0,32);
 const filename=path.join(voiceSampleDir(),id+'.mp3');
 try{if((await stat(filename)).size>500)return id;}catch{}
 if(voicePreviewBusy)throw makeError(409,'다른 음성 미리듣기를 생성 중입니다.');
 voicePreviewBusy=true;
 try{
  await mkdir(voiceSampleDir(),{recursive:true});
  await synthesizeVoice(voice,normalized,filename,voiceSampleDir());
 }finally{voicePreviewBusy=false;}
 return id;
}
async function probe(filename){const result=await run('ffprobe',['-v','error','-show_entries','stream=codec_type,width,height:format=duration','-of','json',filename]);return JSON.parse(result);}
const mediaTypes={image:['jpg','jpeg','png','webp'],video:['mp4'],music:['mp3','wav','m4a']};
function detectMedia(name,buffer){const ext=path.extname(name).toLowerCase().slice(1);const group=Object.entries(mediaTypes).find(([_,xs])=>xs.includes(ext))?.[0];if(!group)throw makeError(400,'JPG/PNG/WEBP/MP4/MP3/WAV/M4A만 등록할 수 있습니다.');
const signature=ext==='jpg'||ext==='jpeg'?buffer[0]===255&&buffer[1]===216:ext==='png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='webp'?buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP':ext==='mp4'||ext==='m4a'?buffer.toString('ascii',4,8)==='ftyp':ext==='mp3'?buffer.toString('ascii',0,3)==='ID3'||buffer[0]===255:ext==='wav'?buffer.toString('ascii',0,4)==='RIFF':false;
if(!signature)throw makeError(400,'파일 확장자와 실제 형식이 다릅니다.');return {ext:ext==='jpeg'?'jpg':ext,group};}
function safeText(x,max=200){return String(x||'').slice(0,max).replace(/[\r\n]+/g,' ').trim();}
function validateProject(input,files){if(!input||typeof input!=='object'||!validId(input.id))throw makeError(400,'프로젝트 번호 오류');
if(input.schemaVersion===2){
 try{
  const normalized=normalizeTimeline(input,files);
  if(GUEST&&(normalized.scenes.length>20||timelineDuration(normalized)>90000))throw Error('지인 체험은 최대 20개 클립·90초 영상만 제작할 수 있습니다.');
  if(normalized.bgmId&&!files.some(f=>f.id===normalized.bgmId&&f.group==='music'))throw Error('배경음악을 찾을 수 없습니다.');
  for(const clip of normalized.scenes){
   if(clip.voiceMediaId&&!files.some(f=>f.id===clip.voiceMediaId&&f.group==='music'))clip.voiceMediaId=null;
  }
  return {...normalized,id:input.id,title:safeText(input.title,100)||'새 프로젝트',voice:availableVoice(input.voice),bgmVolume:Math.max(0,Math.min(1,Number(input.bgmVolume??0.16)||0)),updatedAt:new Date().toISOString()};
 }catch(err){throw makeError(400,err.message);}
}
const scenes=Array.isArray(input.scenes)?input.scenes:[];if(scenes.length>80)throw makeError(400,'장면은 최대 80개입니다.');let total=0;
const cleaned=scenes.map((s,i)=>{if(!files.some(f=>f.id===s.mediaId&&['image','video'].includes(f.group)))throw makeError(400,`장면 ${i+1}: 원본 이미지/동영상이 없습니다.`);const duration=Number(s.duration);if(!Number.isFinite(duration)||duration<1||duration>60)throw makeError(400,'장면 길이는 1~60초입니다.');total+=duration;return {id:validId(s.id)?s.id:hex(),mediaId:s.mediaId,voiceMediaId:s.voiceMediaId&&files.some(f=>f.id===s.voiceMediaId&&f.group==='music')?s.voiceMediaId:null,duration,caption:safeText(s.caption,130),narration:safeText(s.narration,350),effect:['zoom-in','zoom-out','pan-left','pan-right','none'].includes(s.effect)?s.effect:'zoom-in',captionPosition:['top','middle','bottom'].includes(s.captionPosition)?s.captionPosition:'bottom',captionStyle:['impact','minimal','boxed','clean'].includes(s.captionStyle)?s.captionStyle:'impact'};});
if(GUEST&&(scenes.length>20||total>90))throw makeError(400,'지인 체험은 최대 20개 클립·90초 영상만 제작할 수 있습니다.');if(total>600)throw makeError(400,'편집 영상은 최대 10분입니다.');if(input.bgmId&&!files.some(f=>f.id===input.bgmId&&f.group==='music'))throw makeError(400,'배경음악을 찾을 수 없습니다.');
return {id:input.id,title:safeText(input.title,100)||'새 프로젝트',scenes:cleaned,bgmId:input.bgmId||null,bgmVolume:Math.min(1,Math.max(0,Number(input.bgmVolume??0.16)||0)),voice:availableVoice(input.voice),updatedAt:new Date().toISOString()};}
const escapeAss=t=>String(t||'').replace(/\\/g,'').replace(/\{/g,'(').replace(/\}/g,')').replace(/\r?\n/g,'\\N');
function assTime(seconds){const cs=Math.round(seconds*100);return `${Math.floor(cs/360000)}:${String(Math.floor(cs/6000)%60).padStart(2,'0')}:${String(Math.floor(cs/100)%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;}
export function makeAss(scene,duration){const styles={impact:{size:56,color:'&H00FFFFFF',outline:4,bold:1},minimal:{size:43,color:'&H00FFFFFF',outline:2,bold:0},boxed:{size:50,color:'&H00FFFFFF',outline:3,bold:1},clean:{size:48,color:'&H0000E7FF',outline:3,bold:1}};const style=styles[scene.captionStyle]||styles.impact;const alignment=scene.captionPosition==='top'?8:scene.captionPosition==='middle'?5:2;return `[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 2\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Captions,Malgun Gothic,${style.size},${style.color},&H000000FF,&H00000000,&HFF000000,${style.bold?'-1':'0'},0,0,0,100,100,0,0,1,${style.outline},1,${alignment},58,58,145,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\nDialogue: 0,${assTime(0)},${assTime(duration)},Captions,,0,0,0,,${escapeAss(scene.caption)}\n`;}
/** Shared FFmpeg image motion. 1.2x perceptual speed with safe crop bounds.
 * Zoom and pan both transform the rendered photo composition (not a static foreground).
 */
export function imageFilter(effect,frames){
 const base='[0:v]split=2[bg0][fg0];[bg0]scale=760:1340:force_original_aspect_ratio=increase,crop=760:1340,boxblur=20:2,eq=brightness=-0.12[bg];[fg0]scale=690:1190:force_original_aspect_ratio=decrease,format=rgba[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,scale=720:1280,format=yuv420p,';
 const progress=`min(1,on/${Math.max(1,Math.round(frames/1.2)-1)})`;
 let zoom='1.04',x='iw/2-iw/zoom/2';
 if(effect==='zoom-in')zoom=`1.02+0.20*${progress}`;
 if(effect==='zoom-out')zoom=`1.22-0.20*${progress}`;
 if(effect==='pan-left'||effect==='pan-right'){
  zoom='1.20';
  x=effect==='pan-left'?`(iw-iw/zoom)*(1-${progress})`:`(iw-iw/zoom)*${progress}`;
 }
 return base+`zoompan=z='${zoom}':x='${x}':y='ih/2-ih/zoom/2':d=1:s=720x1280:fps=24,format=yuv420p,ass=caption.ass[v]`;
}
export function videoFilter(effect,frames){return imageFilter(effect,frames).replace('[0:v]split=2[bg0][fg0]','[0:v]fps=24,split=2[bg0][fg0]');}
async function renderProject(project,files,onStep){const job=hex();const dir=path.join(userOutputDir(),job);await mkdir(dir,{recursive:true});const mediaById=new Map(files.map(f=>[f.id,f]));const segments=[],info=[];
for(let i=0;i<project.scenes.length;i++){const scene=project.scenes[i],source=mediaById.get(scene.mediaId);onStep(`장면 ${i+1}/${project.scenes.length} 제작`);let voiceFile=null,voiceDur=0;const recorded=scene.voiceMediaId&&mediaById.get(scene.voiceMediaId);if(recorded){voiceFile='recorded.'+recorded.ext;await copyFile(path.join(userMediaDir(),recorded.id+'.'+recorded.ext),path.join(dir,voiceFile));voiceDur=Number((await probe(path.join(dir,voiceFile))).format.duration)||0;}else if(project.voice!=='off'&&scene.narration){voiceFile='narration.mp3';await synthesizeVoice(project.voice,scene.narration,path.join(dir,voiceFile),dir);voiceDur=Number((await probe(path.join(dir,voiceFile))).format.duration)||0;}
if(project.voice!=='off'&&scene.narration&&!voiceFile)throw new Error('대본 음성이 생성되지 않았습니다.');
const duration=Math.max(scene.duration,voiceDur+0.25);if(duration>65)throw Error('음성이 너무 깁니다. 장면을 분할하거나 대사를 줄여주세요.');const ass=makeAss(scene,duration);await writeFile(path.join(dir,'caption.ass'),ass);
const localExt=source.ext,srcName=`source.${localExt}`;await copyFile(path.join(userMediaDir(),source.id+'.'+localExt),path.join(dir,srcName));const isImg=source.group==='image';const frames=Math.ceil(duration*24);const filter=isImg?imageFilter(scene.effect,frames):videoFilter(scene.effect,frames);const segmentName=`clip-${i}.mp4`;
const args=['-hide_banner','-loglevel','error','-y',...(isImg?['-loop','1','-framerate','24']:['-stream_loop','-1']),'-i',srcName];const hasVoice=Boolean(voiceFile);args.push(...(hasVoice?['-i',voiceFile]:['-f','lavfi','-i','anullsrc=r=44100:cl=stereo']));args.push('-filter_complex',filter,'-map','[v]','-map','1:a:0','-t',String(duration),'-r','24','-c:v','libx264','-preset','veryfast','-crf','26','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-ar','44100','-ac','2','-af','apad','-movflags','+faststart',segmentName);
await run('ffmpeg',args,{cwd:dir,timeout:240000});segments.push(segmentName);info.push({index:i,duration});}
onStep('장면 병합');await writeFile(path.join(dir,'concat.txt'),segments.map(n=>`file '${n}'`).join('\n'));await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i','concat.txt','-c','copy','merged.mp4'],{cwd:dir,timeout:180000});let final='merged.mp4';if(project.bgmId){onStep('배경음악 믹싱');const music=mediaById.get(project.bgmId),name='music.'+music.ext;await copyFile(path.join(userMediaDir(),music.id+'.'+music.ext),path.join(dir,name));await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i','merged.mp4','-stream_loop','-1','-i',name,'-filter_complex',`[1:a]volume=${project.bgmVolume}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[a]`,'-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','160k','-movflags','+faststart','final.mp4'],{cwd:dir,timeout:180000});final='final.mp4';}
const rendered=path.join(dir,final);
const metadata=await probe(rendered);
if(!metadata.streams?.some(s=>s.codec_type==='video')||!metadata.streams?.some(s=>s.codec_type==='audio'))
 throw new Error('MP4 검증 실패: 영상 또는 음성 트랙이 없습니다.');
const bytes=(await stat(rendered)).size;
if(bytes<10000)throw new Error('MP4 검증 실패: 파일이 비정상적으로 작습니다.');
await copyFile(rendered,path.join(userOutputDir(),job+'.mp4'));
return {filename:job+'.mp4',duration:Number(metadata.format?.duration)||info.reduce((a,b)=>a+b.duration,0),bytes};}
function auth(req){const t=String(req.headers.cookie||'').match(/(?:^|;\s*)studio_session=([a-z0-9]+)/)?.[1];return t&&sessions.get(t)||null;}
export function createStudioServer({state=STATE}={}){const server=http.createServer(async(req,res)=>requestScope.run({userId:'owner'},async()=>{try{const url=new URL(req.url,'http://localhost');const hostRaw=String(req.headers.host||'');let host;try{host=new URL('http://'+hostRaw).hostname.toLowerCase()}catch{throw makeError(403,'호스트 오류')}const local=isLocalHost(host);
if(GUEST&&!guestActive())throw makeError(403,'체험 링크가 만료되었거나 중지되었습니다.');
if(!local){
 const trustedGuest=GUEST&&host.endsWith('.trycloudflare.com')&&host.length<120;
 if(!(trustedGuest||(HOST&&host===HOST))||!TRUST||req.headers['x-forwarded-proto']!=='https'||!addrLocal(req))throw makeError(403,'승인되지 않은 호스트입니다.');
}
if(!['GET','POST'].includes(req.method))throw makeError(405,'지원하지 않는 요청');if(req.method==='POST'){const origin=req.headers.origin;if(origin&&new URL(origin).host.toLowerCase()!==hostRaw.toLowerCase())throw makeError(403,'외부 출처 차단');}
if(req.method==='GET'&&['/','/app','/client.js','/styles.css','/timeline-ui.js','/timeline-ui.css','/mobile-ui.js','/mobile-ui.css','/blog.js','/blog.css'].includes(url.pathname)){const asset=['/client.js','/styles.css','/timeline-ui.js','/timeline-ui.css','/mobile-ui.js','/mobile-ui.css','/blog.js','/blog.css'].includes(url.pathname)?url.pathname.slice(1):'index.html';const p=path.join(ROOT,'public',asset);res.writeHead(200,{...APP_HEADER,'Content-Type':mime(path.extname(p))});res.end(await readFile(p));return;}
if(req.method==='GET'&&url.pathname==='/api/setup-state'){
 const legacy=await loadJson(cfgPath,null);
 const accounts=await loadJson(accountsPath,[]);
 return json(res,200,{setupNeeded:!legacy&&!accounts.length&&local&&addrLocal(req),registrationOpen:true,legacyAvailable:!!legacy});
}
if(req.method==='POST'&&url.pathname==='/api/setup'){
 if(!local||!addrLocal(req)||await loadJson(cfgPath,null)||(await loadJson(accountsPath,[])).length)throw makeError(403,'초기 설정은 비어 있는 PC에서만 허용됩니다.');
 const b=await data(req);if(typeof b.password!=='string'||b.password.length<12)throw makeError(400,'비밀번호는 12자 이상 필요합니다.');
 const salt=randomBytes(16).toString('hex');
 await saveJson(cfgPath,{salt,hash:scryptSync(b.password,Buffer.from(salt,'hex'),64).toString('hex')});
 return json(res,201,{ok:true});
}
if(req.method==='POST'&&url.pathname==='/api/register'){
 const ip=req.socket.remoteAddress||'unknown',now=Date.now();
 const attempts=(loginFailures.get('register:'+ip)||[]).filter(t=>now-t<900000);
 if(attempts.length>=10)throw makeError(429,'가입 시도가 많습니다. 잠시 후 다시 시도하세요.');
 attempts.push(now);loginFailures.set('register:'+ip,attempts);
 const b=await data(req),email=String(b.email||'').trim().toLowerCase();
 if(!/^[a-z0-9][a-z0-9._+-]{0,62}@[a-z0-9.-]{1,180}\.[a-z]{2,20}$/.test(email))throw makeError(400,'올바른 이메일 주소를 입력하세요.');
 if(typeof b.password!=='string'||b.password.length<12||b.password.length>256)throw makeError(400,'비밀번호는 12~256자여야 합니다.');
 const accounts=await loadJson(accountsPath,[]);
 if(accounts.some(a=>a.email===email))throw makeError(409,'이미 등록된 이메일입니다.');
 if(accounts.length>=25)throw makeError(429,'시험판 계정 한도에 도달했습니다.');
 const legacy=await loadJson(cfgPath,null);
 const id=!legacy&&accounts.length===0?'owner':randomBytes(16).toString('hex');
 const salt=randomBytes(16).toString('hex');
 const account={id,email,salt,hash:scryptSync(b.password,Buffer.from(salt,'hex'),64).toString('hex'),createdAt:new Date().toISOString()};
 accounts.push(account);await saveJson(accountsPath,accounts);
 const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
 sessions.set(token,{csrf,userId:id,email,expires:Date.now()+7*86400000});
 return json(res,201,{ok:true,csrf,email},{'Set-Cookie':`studio_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${!local?'; Secure':''}`});
}
if(req.method==='POST'&&url.pathname==='/api/login'){
 const ip=req.socket.remoteAddress||'unknown',now=Date.now();
 const attempts=(loginFailures.get(ip)||[]).filter(t=>now-t<900000);
 if(attempts.length>=12)throw makeError(429,'로그인 시도가 많습니다. 15분 뒤 다시 시도하세요.');
 const b=await data(req),email=String(b.email||'').trim().toLowerCase();
 const accounts=await loadJson(accountsPath,[]);
 let account=accounts.find(a=>a.email===email);
 if(!account&&(!email||email==='owner')){
  const legacy=await loadJson(cfgPath,null);
  if(legacy)account={id:'owner',email:'owner',salt:legacy.salt,hash:legacy.hash};
 }
 if(!account||typeof b.password!=='string'||b.password.length>256){
  attempts.push(now);loginFailures.set(ip,attempts);throw makeError(401,'계정 또는 비밀번호가 올바르지 않습니다.');
 }
 const supplied=scryptSync(b.password,Buffer.from(account.salt,'hex'),64),expected=Buffer.from(account.hash,'hex');
 if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){
  attempts.push(now);loginFailures.set(ip,attempts);throw makeError(401,'계정 또는 비밀번호가 올바르지 않습니다.');
 }
 loginFailures.delete(ip);
 const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
 sessions.set(token,{csrf,userId:account.id,email:account.email,expires:Date.now()+7*86400000});
 return json(res,200,{csrf,email:account.email},{'Set-Cookie':`studio_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${!local?'; Secure':''}`});
}
const session=auth(req);if(!session||session.expires<Date.now())throw makeError(401,'로그인하세요.');
 requestScope.enterWith({userId:session.userId||'owner'});if(req.method==='POST'&&req.headers['x-csrf-token']!==session.csrf)throw makeError(403,'보안 토큰 오류');
if(req.method==='GET'&&url.pathname==='/api/me')return json(res,200,{csrf:session.csrf,email:session.email||'owner',guest:false});

// Personal writing examples are kept per login, independently from published blog drafts.
if(req.method==='GET'&&url.pathname==='/api/blog/writing-samples'){
 const samples=await loadJson(writingSamplesFile(),[]);
 return json(res,200,{samples:samples.map(({id,name,content,createdAt,updatedAt})=>({id,name,content,createdAt,updatedAt}))});
}
if(req.method==='POST'&&url.pathname==='/api/blog/writing-samples'){
 const input=await data(req,18000);
 const samples=await loadJson(writingSamplesFile(),[]);
 const existing=input.id&&samples.find(x=>x.id===input.id);
 if(input.id&&!existing)throw makeError(404,'수정할 글쓰기 예시를 찾지 못했습니다.');
 if(!existing&&samples.length>=20)throw makeError(429,'글쓰기 예시는 계정당 20개까지 저장할 수 있습니다.');
 let sample;try{sample=validateWritingSample(input,existing)}catch(e){throw makeError(400,e.message);}
 if(existing)samples[samples.findIndex(x=>x.id===existing.id)]=sample;
 else samples.push(sample);
 await saveJson(writingSamplesFile(),samples);
 return json(res,existing?200:201,{sample});
}
if(req.method==='POST'&&/^[/]api[/]blog[/]writing-samples[/][0-9a-f]{24}[/]delete$/.test(url.pathname)){
 const id=url.pathname.split('/').at(-2),samples=await loadJson(writingSamplesFile(),[]);
 if(!samples.some(x=>x.id===id))throw makeError(404,'삭제할 글쓰기 예시가 없습니다.');
 await saveJson(writingSamplesFile(),samples.filter(x=>x.id!==id));
 return json(res,200,{deleted:true});
}
if(req.method==='GET'&&url.pathname==='/api/blog/posts'){
 const posts=await loadJson(blogFile(),[]);
 return json(res,200,{posts:posts.map(blogPostForList).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))});
}
if(req.method==='GET'&&/^[/]api[/]blog[/]posts[/][0-9a-f]{24}$/.test(url.pathname)){
 const id=url.pathname.split('/').at(-1),posts=await loadJson(blogFile(),[]);
 const post=posts.find(x=>x.id===id);
 if(!post)throw makeError(404,'블로그 글을 찾을 수 없습니다.');
 return json(res,200,{post});
}
if(req.method==='POST'&&url.pathname==='/api/blog/posts'){
 const input=await data(req,1_200_000);
 const posts=await loadJson(blogFile(),[]);
 const current=input.id&&posts.find(x=>x.id===input.id);
 if(input.id&&!current)throw makeError(404,'수정할 글이 없습니다.');
 if(!current&&posts.length>=150)throw makeError(429,'블로그 글은 계정당 150개까지 저장할 수 있습니다.');
 const media=await loadJson(mediaListFile(),[]);
 let post;
 try{post=validateBlogPost(input,media,current)}catch(e){throw makeError(400,e.message)}
 if(current)posts[posts.findIndex(x=>x.id===current.id)]=post;else posts.push(post);
 await saveJson(blogFile(),posts);
 return json(res,current?200:201,{post});
}
if(req.method==='POST'&&/^[/]api[/]blog[/]posts[/][0-9a-f]{24}[/]delete$/.test(url.pathname)){
 const id=url.pathname.split('/').at(-2),posts=await loadJson(blogFile(),[]);
 if(!posts.some(x=>x.id===id))throw makeError(404,'삭제할 글이 없습니다.');
 await saveJson(blogFile(),posts.filter(x=>x.id!==id));
 return json(res,200,{deleted:true});
}
if(req.method==='POST'&&url.pathname==='/api/blog/ai-draft'){
 const b=await data(req,6000);
 const topic=String(b.topic||'').trim().slice(0,400);
 const facts=String(b.facts||'').trim().slice(0,1800);
 const tone=String(b.tone||'정보형').slice(0,40);
 const sampleId=String(b.styleSampleId||'');
 const savedSamples=sampleId?await loadJson(writingSamplesFile(),[]):[];
 const sample=sampleId?savedSamples.find(x=>x.id===sampleId):null;
 if(sampleId&&!sample)throw makeError(404,'선택한 글쓰기 스타일을 찾을 수 없습니다.');
 if(topic.length<5)throw makeError(400,'블로그 글 주제를 5자 이상 입력하세요.');
 const key=await aiKey();
 if(!key)throw makeError(400,'먼저 영상 편집기의 AI 키 설정에서 Gemini 키를 등록하세요.');
 let offered=[];
 try{
  const modelsResponse=await fetch('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(12000)});
  if(modelsResponse.ok){const models=await modelsResponse.json();offered=models.models||[];}
 }catch{}
 const models=preferredModels(offered).slice(0,3);
 if(!models.length)throw makeError(503,'사용 가능한 Gemini 텍스트 모델이 없습니다.');
 const prompt=buildPersonalWritingPrompt({topic,facts,tone,samples:sample?[sample]:[]});
 let reason='AI 요청에 실패했습니다.';
 for(const model of models){
  try{
   const result=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',temperature:0.55,maxOutputTokens:3500}}),
    signal:AbortSignal.timeout(35000)
   });
   if(!result.ok){reason='Gemini '+result.status+' 오류';if(result.status===429)throw makeError(429,'Gemini 무료 사용량 또는 요청 제한에 도달했습니다.');continue;}
   const output=await result.json(),raw=output.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
   const parsed=parseModelJson(raw);
   const normalized=validateBlogPost({title:parsed.title||topic,summary:parsed.summary||'',blocks:parsed.blocks||[],tags:parsed.tags||[],status:'draft'},[],null);
   return json(res,200,{draft:normalized,model});
  }catch(e){if(e.status===429)throw e;reason=e.name==='TimeoutError'?'AI 응답 시간 초과':String(e.message||reason).slice(0,140);}
 }
 throw makeError(502,'AI 블로그 초안을 만들지 못했습니다: '+reason);
}

if(req.method==='POST'&&url.pathname==='/api/logout'){const token=String(req.headers.cookie||'').match(/studio_session=([a-z0-9]+)/)?.[1];sessions.delete(token);return json(res,200,{ok:true},{'Set-Cookie':'studio_session=; Path=/; Max-Age=0'});}
if(req.method==='POST'&&url.pathname==='/api/voice/preview'){
 guestQuota('previews');
 const b=await data(req,4000);
 if(typeof b.text!=='string'||b.text.length>160)throw makeError(400,'미리듣기 대사는 160자 이내입니다.');
 const id=await makeVoicePreview(b.voice,b.text);
 return json(res,200,{url:'/api/voice/sample/'+id+'.mp3'});
}
const sampleUrl=url.pathname.match(/^[/]api[/]voice[/]sample[/]([0-9a-f]{32})[.]mp3$/);
if(req.method==='GET'&&sampleUrl){
 const filepath=path.join(voiceSampleDir(),sampleUrl[1]+'.mp3');
 let bytes;try{bytes=await readFile(filepath)}catch{throw makeError(404,'음성 미리듣기가 아직 준비되지 않았습니다.')}
 res.writeHead(200,{...APP_HEADER,'Content-Type':'audio/mpeg'});res.end(bytes);return;
}
if(req.method==='GET'&&url.pathname==='/api/stt/status')return json(res,200,ownedJob(sttJob));
if(req.method==='POST'&&url.pathname==='/api/stt'){
 guestQuota('transcriptions');
 if(sttJob.status==='running')throw makeError(409,'다른 음성 인식 작업이 진행 중입니다.');
 const b=await data(req),projects=await loadJson(projectFile(),[]),files=await enrichMedia(await loadJson(mediaListFile(),[]));
 const project=projects.find(p=>p.id===b.projectId);
 const clip=project?.scenes?.find(c=>c.id===b.clipId);
 if(!project||!clip)throw makeError(404,'클립을 찾을 수 없습니다.');
 const media=files.find(f=>f.id===clip.mediaId&&f.group==='video');
 if(!media)throw makeError(400,'동영상 클립에서만 음성을 인식할 수 있습니다.');
 if(media.hasAudio===false)throw makeError(400,'선택한 영상에 원본 음성 트랙이 없습니다.');
 const begin=Math.max(0,Number(clip.sourceIn||0)),end=Math.min(media.duration||1200,Number(clip.sourceOut||clip.duration||60));
 const duration=Math.max(0,end-begin);
 if(GUEST&&duration>90)throw makeError(400,'체험 음성 인식은 최대 90초입니다.');if(duration<.2||duration>1200)throw makeError(400,'한 번에 0.2초~20분 구간의 음성을 인식할 수 있습니다.');
 sttJob={ownerId:currentUser(),status:'running',error:null,step:'CPU 음성 인식 준비',projectId:project.id,clipId:clip.id,segments:null};
 void transcribeLocal({file:path.join(userMediaDir(),media.id+'.'+media.ext),start:begin,duration,workDir:path.join(userRoot(),'stt'),
  onStep:step=>{sttJob.step=step}
 }).then(result=>{
  sttJob={ownerId:currentUser(),status:'done',error:null,step:'음성 인식 완료',projectId:project.id,clipId:clip.id,segments:result.segments,language:result.language};
 }).catch(e=>{sttJob={ownerId:currentUser(),status:'failed',error:e.message.slice(0,650),step:'실패',projectId:project.id,clipId:clip.id,segments:null}});
 return json(res,202,{status:'running'});
}
if(req.method==='GET'&&url.pathname==='/api/ai/status')return json(res,200,{configured:!!(await aiKey()),model:'auto',provider:'Gemini Vision',job:ownedJob({status:draftJob.status,step:draftJob.step,error:draftJob.error,ownerId:draftJob.ownerId})});
if(req.method==='POST'&&url.pathname==='/api/ai/config'){if(GUEST)throw makeError(403,'체험 사용자는 AI 키를 변경할 수 없습니다.');const b=await data(req);if(typeof b.key!=='string'||b.key.length<15||b.key.length>300||!/^[-_A-Za-z0-9]+$/.test(b.key))throw makeError(400,'올바른 Gemini API 키를 입력하세요.');await saveJson(keyPath(),{geminiKey:b.key});return json(res,200,{configured:true});}
if(req.method==='GET'&&url.pathname==='/api/ai/draft/status'){if(draftJob.status==='done')return json(res,200,ownedJob(draftJob));return json(res,200,ownedJob({status:draftJob.status,step:draftJob.step,error:draftJob.error,projectId:draftJob.projectId,ownerId:draftJob.ownerId}));}
if(req.method==='POST'&&url.pathname==='/api/ai/draft'){
 guestQuota('drafts');
 if(draftJob.status==='running')throw makeError(409,'AI가 다른 영상 초안을 작성하고 있습니다.');
 const b=await data(req),projects=await loadJson(projectFile(),[]),files=await loadJson(mediaListFile(),[]);
 const project=projects.find(p=>p.id===b.projectId);if(!project)throw makeError(404,'프로젝트를 찾을 수 없습니다.');
 const mediaIds=Array.isArray(b.mediaIds)?[...new Set(b.mediaIds)]:[];
 if(mediaIds.length<1||mediaIds.length>10)throw makeError(400,'사진 또는 영상 1~10개를 선택하세요.');
 const media=mediaIds.map(id=>files.find(f=>f.id===id&&['image','video'].includes(f.group)));
 if(media.some(x=>!x))throw makeError(400,'업로드한 사진/영상에서만 선택하세요.');
 const key=await aiKey();if(!key)throw makeError(400,'Gemini API 키를 먼저 등록하세요. 무료 사용량이 있다면 해당 범위에서 이용할 수 있습니다.');
 const voice=availableVoice(b.voice);
 const bgmId=b.bgmId||null;
 if(bgmId&&!files.some(f=>f.id===bgmId&&f.group==='music'))throw makeError(400,'등록된 배경음악만 선택할 수 있습니다.');
 const bgmVolume=Math.max(0,Math.min(1,Number(b.bgmVolume??0.16)||0));
 draftJob={ownerId:currentUser(),status:'running',step:'사진 확인 준비',error:null,projectId:project.id,draft:null};
 void generateAiDraft({key,media,requirements:b.requirements,productFacts:b.productFacts,style:[b.style,'선택 음성 '+voice,'선택 음악 '+(files.find(f=>f.id===bgmId)?.name||'없음')].join(' / '),
  mediaPath:f=>path.join(userMediaDir(),f.id+'.'+f.ext),onStep:step=>{draftJob.step=step}}).then(draft=>{
  draftJob={ownerId:currentUser(),status:'done',step:'수정 가능한 영상 초안 생성 완료',error:null,projectId:project.id,draft:{...draft,voice,bgmId,bgmVolume}};
 }).catch(e=>{draftJob={ownerId:currentUser(),status:'failed',step:'실패',error:String(e.message).slice(0,360),projectId:project.id,draft:null}});
 return json(res,202,{status:'running'});
}
if(req.method==='GET'&&url.pathname==='/api/library'){const projects=await loadJson(projectFile(),[]),media=await enrichMedia(await loadJson(mediaListFile(),[]));return json(res,200,{projects,media,export:ownedJob(exportJob)});}
if(req.method==='POST'&&url.pathname==='/api/projects'){const b=await data(req),projects=await loadJson(projectFile(),[]),media=await loadJson(mediaListFile(),[]);const value=validateProject(b,media);const idx=projects.findIndex(p=>p.id===value.id);if(idx===-1){if(projects.length>=100)throw makeError(400,'프로젝트 최대 100개');projects.push(value)}
else{
 if(projects[idx].schemaVersion!==2&&value.schemaVersion===2){
  const backups=path.join(userRoot(),'backups');await mkdir(backups,{recursive:true});
  const backup=path.join(backups,'projects-before-v2-migration.json');
  try{await stat(backup)}catch{await saveJson(backup,projects);}
 }
 projects[idx]=value;
}
await saveJson(projectFile(),projects);return json(res,200,{project:value});}
if(req.method==='POST'&&url.pathname==='/api/new'){const projects=await loadJson(projectFile(),[]);const item={id:hex(),title:'새 프로젝트',schemaVersion:2,ratio:'9:16',scenes:[],textClips:[],bgmId:null,bgmVolume:0.16,voice:DEFAULT_VOICE,updatedAt:new Date().toISOString()};projects.push(item);await saveJson(projectFile(),projects);return json(res,201,{project:item});}
if(req.method==='POST'&&url.pathname==='/api/upload'){
 const name=url.searchParams.get('name')||'file';
 if(GUEST)guestQuota('uploads');
 const upload=await streamUpload(req,GUEST?30_000_000:1_073_741_824);
 if(GUEST){
  try{guestQuota('bytes',upload.total)}catch(err){await rm(upload.temp,{force:true}).catch(()=>{});throw err;}
 }
 let item;
 try{
  if(upload.total<1500)throw makeError(400,'파일 크기가 너무 작습니다.');
  const {ext,group}=detectMedia(name,upload.head);
  const id=hex();await mkdir(userMediaDir(),{recursive:true});
  const filepath=path.join(userMediaDir(),id+'.'+ext);
  const technical=await probe(upload.temp).catch(e=>{throw makeError(400,'미디어 파일을 읽을 수 없습니다. '+e.message)});
  if(group==='image'&&!technical.streams?.some(s=>s.codec_type==='video'))throw makeError(400,'이미지 파일이 아닙니다.');
  if(group==='video'&&!technical.streams?.some(s=>s.codec_type==='video'))throw makeError(400,'영상 파일이 아닙니다.');
  if(group==='music'&&!technical.streams?.some(s=>s.codec_type==='audio'))throw makeError(400,'음악 파일이 아닙니다.');
  await rename(upload.temp,filepath);
  item={id,name:safeText(name,120),group,ext,bytes:upload.total,duration:Number(technical.format?.duration)||null,hasAudio:technical.streams?.some(s=>s.codec_type==='audio')||false};
  const files=await loadJson(mediaListFile(),[]);files.push(item);
  try{await saveJson(mediaListFile(),files)}catch(error){await rm(filepath,{force:true});throw error;}
 }finally{await rm(upload.temp,{force:true}).catch(()=>{});}
 return json(res,201,{media:item});
}
// Remove only a media asset owned by this editor. Keep a private trash copy and
// explicitly remove references from the current project; never silently alter others.
if(req.method==='POST'&&url.pathname==='/api/media/remove'){
 if(exportJob.status==='running'||draftJob.status==='running')throw makeError(409,'영상 또는 AI 작업이 끝난 뒤 사진을 삭제하세요.');
 const b=await data(req);
 if(!validId(b.mediaId)||!validId(b.projectId)||b.confirm!==true)throw makeError(400,'삭제 확인이 필요합니다.');
 const projects=await loadJson(projectFile(),[]),files=await loadJson(mediaListFile(),[]);
 const current=projects.find(p=>p.id===b.projectId),item=files.find(f=>f.id===b.mediaId);
 if((await loadJson(blogFile(),[])).some(post=>post.blocks?.some(block=>block.type==='image'&&block.mediaId===b.mediaId)))throw makeError(409,'블로그 글에서 사용 중인 사진입니다. 글에서 이미지를 먼저 제거하세요.');
 if(!current||!item)throw makeError(404,'프로젝트 또는 사진을 찾을 수 없습니다.');
 const usedBy=p=>(p.scenes||[]).some(scene=>scene.mediaId===item.id||scene.voiceMediaId===item.id)||p.bgmId===item.id;
 const foreign=projects.filter(p=>p.id!==current.id&&usedBy(p));
 if(foreign.length)throw makeError(409,'다른 프로젝트에서 사용 중입니다: '+foreign.slice(0,3).map(p=>p.title).join(', ')+'. 해당 프로젝트의 장면에서 먼저 제거하세요.');
 const removedScenes=(current.scenes||[]).filter(scene=>scene.mediaId===item.id).length;
 const wasAudio=Boolean(current.bgmId===item.id||(current.scenes||[]).some(scene=>scene.voiceMediaId===item.id));
 const updated=projects.map(p=>p.id===current.id?{
  ...p,scenes:(p.scenes||[]).filter(scene=>scene.mediaId!==item.id).map(scene=>({...scene,voiceMediaId:scene.voiceMediaId===item.id?null:scene.voiceMediaId})),
  bgmId:p.bgmId===item.id?null:p.bgmId,updatedAt:new Date().toISOString()
 }:p);
 const trash=path.join(userRoot(),'trash');await mkdir(trash,{recursive:true});
 const original=path.join(userMediaDir(),item.id+'.'+item.ext),archived=path.join(trash,item.id+'.'+item.ext);
 // Rename before updating metadata to avoid losing the only source copy.
 await rename(original,archived);
 try{
  await saveJson(projectFile(),updated);
  await saveJson(mediaListFile(),files.filter(f=>f.id!==item.id));
 }catch(error){
  await rename(archived,original).catch(()=>{});
  throw error;
 }
 return json(res,200,{removed:true,removedScenes,removedAudioReferences:wasAudio,project:updated.find(p=>p.id===current.id)});
}
const mediaMatch=url.pathname.match(/^[/]api[/]media[/]([0-9a-f]{24})$/);
if(req.method==='GET'&&mediaMatch){
 const files=await loadJson(mediaListFile(),[]),item=files.find(f=>f.id===mediaMatch[1]);
 if(!item)throw makeError(404,'파일 없음');
 const filepath=path.join(userMediaDir(),item.id+'.'+item.ext),size=(await stat(filepath)).size;
 const headers={...APP_HEADER,'Content-Type':mime('.'+item.ext),'Accept-Ranges':'bytes','Content-Disposition':'inline'};
 const range=String(req.headers.range||''),match=range.match(/^bytes=(\d*)-(\d*)$/);
 let start=0,end=size-1;
 if(range){
  if(!match)throw makeError(416,'지원하지 않는 범위입니다.');
  start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]||0));
  end=match[1]&&match[2]?Number(match[2]):end;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||start>=size||end<start){
   res.writeHead(416,{...headers,'Content-Range':`bytes */${size}`});res.end();return;
  }
  end=Math.min(end,size-1);headers['Content-Range']=`bytes ${start}-${end}/${size}`;
 }
 headers['Content-Length']=end-start+1;res.writeHead(range?206:200,headers);
 createReadStream(filepath,{start,end}).on('error',()=>res.destroy()).pipe(res);return;
}
if(req.method==='GET'&&url.pathname==='/api/export/status')return json(res,200,ownedJob(exportJob));
if(req.method==='POST'&&url.pathname==='/api/export'){guestQuota('exports');if(exportJob.status==='running')throw makeError(409,'다른 영상이 제작 중입니다.');const b=await data(req),projects=await loadJson(projectFile(),[]),media=await loadJson(mediaListFile(),[]);const project=projects.find(p=>p.id===b.projectId);if(!project)throw makeError(404,'프로젝트 없음');const p=validateProject(project,media);if(!p.scenes.length)throw makeError(400,'영상 장면이 없습니다.');exportJob={ownerId:currentUser(),status:'running',error:null,filename:null,projectId:p.id,step:'준비'};void (p.schemaVersion===2?renderTimeline(p,media,{outputDir:userOutputDir(),mediaDir:userMediaDir(),onStep:step=>{exportJob.step=step},synthesizeVoice}):renderProject(p,media,step=>{exportJob.step=step})).then(result=>{exportJob={ownerId:currentUser(),status:'done',error:null,projectId:p.id,step:'완료',...result}}).catch(e=>{exportJob={ownerId:currentUser(),status:'failed',error:e.message,projectId:p.id,step:'실패'}});return json(res,202,ownedJob(exportJob));}
const download=url.pathname.match(/^[/]api[/]export[/]([0-9a-f]{24}[.]mp4)$/);
if(req.method==='GET'&&download){
 if(exportJob.status!=='done'||exportJob.ownerId!==currentUser()||download[1]!==exportJob.filename)throw makeError(404,'출력 파일 없음');
 const filepath=path.join(userOutputDir(),download[1]),file=await stat(filepath);
 const range=String(req.headers.range||''),match=range.match(/^bytes=(\d*)-(\d*)$/);
 const headers={...APP_HEADER,'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Disposition':url.searchParams.has('download')?`attachment; filename="studio-${download[1]}"`:'inline'};
 let start=0,end=file.size-1;
 if(range){
  if(!match)throw makeError(416,'지원하지 않는 영상 범위 요청입니다.');
  start=match[1]?Number(match[1]):Math.max(0,file.size-Number(match[2]||0));
  end=match[1]?(match[2]?Number(match[2]):end):end;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||start>=file.size||end<start){
   res.writeHead(416,{...headers,'Content-Range':`bytes */${file.size}`});res.end();return;
  }
  end=Math.min(end,file.size-1);
  headers['Content-Range']=`bytes ${start}-${end}/${file.size}`;
 }
 headers['Content-Length']=end-start+1;
 res.writeHead(range?206:200,headers);
 createReadStream(filepath,{start,end}).on('error',()=>res.destroy()).pipe(res);
 return;
}
throw makeError(404,'주소 없음');
}catch(e){json(res,e.status||500,{error:e.message});}}));return server;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
await mkdir(STATE,{recursive:true});const server=createStudioServer();server.listen(PORT,'127.0.0.1',()=>console.log(`Studio Editor: http://127.0.0.1:${PORT}/app`));}
