/** Customer-owned media -> ShortsAI Shopping Director -> isolated narrated ad.
 * NEVER imports createShort(): that function can upload to the user's channels.
 * Default behavior is fail closed if director or narration dependencies are absent.
 */
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateProduct } from './core.mjs';
import { locateFont } from './render.mjs';

const PHOTO_EXT = {png:'png',jpeg:'jpg',webp:'webp'};
const VIDEO_NAME = 'advertisement.mp4';
const MAX_DURATION = 60;
const MIN_DURATION = 15;
const NO_GO = /최저가|무조건|완치|100\s*%|효과\s*보장|판매\s*1위|확정\s*수익/;

export function validateDirectorMedia(raw) {
  const product = validateProduct(raw);
  const photos = Array.isArray(raw.imageDataUrls) ? raw.imageDataUrls : [];
  if (photos.length < 2 || photos.length > 6) throw new Error('판매용 영상은 서로 다른 실제 상품 사진 2~6장이 필요합니다.');
  const seen = new Set();
  const items = photos.map((s,i)=>{
    if(typeof s!=='string' || s.length > 7_000_000)throw new Error(`상품 사진 ${i+1}이 너무 큽니다.`);
    const m=s.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if(!m)throw new Error('사진은 PNG, JPEG, WEBP만 지원합니다.');
    const data=Buffer.from(m[2],'base64');
    if(data.length < 1500 || data.length > 5_000_000)throw new Error('사진은 각각 1.5KB~5MB 사이여야 합니다.');
    const ok=m[1]==='jpeg'?(data[0]===255&&data[1]===216):m[1]==='png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
    if(!ok)throw new Error(`상품 사진 ${i+1}의 실제 파일 형식이 잘못됐습니다.`);
    const digest=createHash('sha256').update(data).digest('hex');
    if(seen.has(digest))throw new Error('중복된 사진이 있습니다. 서로 다른 상품 사진을 등록하세요.');
    seen.add(digest);
    return {data,extension:PHOTO_EXT[m[1]]};
  });
  return {product,images:items};
}

function run(exe,args,{cwd,timeoutMs=120000}={}) {
  return new Promise((resolve,reject)=>{
    let stderr='';
    const child=spawn(exe,args,{cwd,windowsHide:true,stdio:['ignore','ignore','pipe']});
    let expired=false;
    const timer=setTimeout(()=>{expired=true;child.kill();},timeoutMs);
    child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-2000);});
    child.on('error',e=>{clearTimeout(timer);reject(new Error(`${exe} 실행 실패: ${e.message}`));});
    child.on('close',code=>{clearTimeout(timer);if(expired)reject(new Error(`${exe} 실행 시간 초과`));else if(code!==0)reject(new Error(`${exe} 종료 코드 ${code}: ${stderr.slice(-500)}`));else resolve();});
  });
}

export function validateDirectorPlan(plan,product) {
  const scenes=plan?.scenes;
  if(!Array.isArray(scenes)||scenes.length<4||scenes.length>7)throw new Error('디렉터 결과에는 4~7개의 장면이 필요합니다.');
  const allowed=[product.name,product.brand,...product.features].join(' ');
  const valid=scenes.map((s,i)=>{
    const voice=String(s.tts||s.voice||s.script||'').trim();
    const subtitle=String(s.subtitle||voice).trim();
    if(voice.length<8||voice.length>180||subtitle.length>100)throw new Error(`디렉터 ${i+1}번 장면의 대본이 너무 짧거나 깁니다.`);
    if(NO_GO.test(voice) && !NO_GO.test(allowed))throw new Error('디렉터가 검증되지 않은 광고 주장을 만들었습니다.');
    const nums=(voice.match(/\d[\d.,]*/g)||[]).filter(Boolean);
    const provided=new Set((allowed+' '+(product.priceKrw??'')).match(/\d[\d.,]*/g)||[]);
    if(nums.some(n=>!provided.has(n)))throw new Error('디렉터가 입력되지 않은 숫자를 추가했습니다.');
    return {voice,subtitle,shot:String(s.shot||'medium').slice(0,40),move:String(s.cameraMove||'slow_zoom').slice(0,40)};
  });
  if(!valid.some(s=>s.voice.includes(product.name)))throw new Error('대본에 실제 상품명이 포함되지 않았습니다.');
  return valid;
}

export async function runShortsDirector({shortsHome,product,images,jobDir,timeoutMs=90000}){
  const home=path.resolve(shortsHome||'');
  if(!shortsHome)throw new Error('REVENUE_SHORTSAI_HOME이 설정되지 않았습니다. 쇼츠 제작 폴더를 지정하세요.');
  const director=path.join(home,'modules','shopping','director.js');
  await access(director);
  const script=path.join(jobDir,'director-bridge.mjs');
  // The director imports its OWN dependencies inside the ShortsAI installation.
  // This subprocess only plans scenes; no createShort/upload/cleanup is called.
  const spec={name:product.name,description:[product.brand,product.audience,...product.features].join('. '),price:product.priceKrw,images,provider:'revenue-factory'};
  const output=path.join(jobDir,'director-plan.json');
  const bridge=`import {writeFile} from 'node:fs/promises';\nimport {createShoppingDirector} from ${JSON.stringify(pathToFileURL(director).href)};\nconst product=${JSON.stringify(spec)};\nconst result=await createShoppingDirector(product);\nawait writeFile(${JSON.stringify(output)},JSON.stringify({scenes:result.scenes}));\n`;
  await writeFile(script,bridge,{mode:0o600});
  await run(process.execPath,[script],{cwd:home,timeoutMs});
  return validateDirectorPlan(JSON.parse(await readFile(output,'utf8')),product);
}

const caption=v=>String(v).replace(/[\r\n\t]+/g,' ').trim().slice(0,85);
async function audioDuration(filename){
  return await new Promise((resolve,reject)=>{
    let stdout='',stderr='';const p=spawn('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',filename],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);
    p.on('error',reject);p.on('close',code=>{const n=Number(stdout.trim());code===0&&Number.isFinite(n)&&n>0?resolve(n):reject(new Error('TTS 음성 길이를 확인할 수 없습니다: '+stderr.slice(-100)));});
  });
}

export async function renderNarratedScenes({jobDir,scenes,images,ttsCommand='edge-tts',fontPath,voice='ko-KR-SunHiNeural'}){
  if(images.length<2)throw new Error('상품 사진 부족');
  const font=fontPath||await locateFont();
  const durations=[],segments=[];
  for(let i=0;i<scenes.length;i++){
    const n=i+1,mp3=path.join(jobDir,`voice-${n}.mp3`),segment=path.join(jobDir,`segment-${n}.mp4`);
    await run(ttsCommand,['--voice',voice,'--text',scenes[i].voice,'--write-media',mp3],{cwd:jobDir,timeoutMs:60000});
    const duration=Math.max(2,Math.ceil((await audioDuration(mp3)+0.25)*10)/10);
    durations.push(duration);
    const textFile=path.join(jobDir,`caption-${n}.txt`);
    await writeFile(textFile,caption(scenes[i].subtitle),'utf8');
    const image=images[i%images.length];
    // True visual motion (zoom in/out) from the customer's actual product photos.
    const zoom=i%2===0?"min(zoom+0.0008,1.14)":"if(lte(on,1),1.14,max(zoom-0.0008,1.0))";
    const escaped=font.replaceAll('\\','/').replaceAll(':','\\:').replaceAll("'","\\'");
    const filter=`scale=820:1480:force_original_aspect_ratio=increase,crop=820:1480,zoompan=z='${zoom}':d=1:s=720x1280:fps=24,drawbox=x=24:y=945:w=672:h=238:color=black@0.70:t=fill,drawtext=fontfile='${escaped}':textfile='${textFile.replaceAll('\\','/').replaceAll(':','\\:')}':fontcolor=white:fontsize=43:x=(w-text_w)/2:y=1000:line_spacing=12`;
    await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-loop','1','-framerate','24','-i',image,'-i',mp3,'-filter_complex',`[0:v]${filter}[v]`,'-map','[v]','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','25','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-t',String(duration),'-shortest',segment],{cwd:jobDir,timeoutMs:120000});
    const s=await stat(segment);if(s.size<5000)throw new Error(`장면 ${n} 영상 렌더링 실패`);
    segments.push(segment);
  }
  const seconds=durations.reduce((a,b)=>a+b,0);
  if(seconds<MIN_DURATION||seconds>MAX_DURATION)throw new Error(`음성 길이 ${seconds.toFixed(1)}초가 허용 범위(15~60초)를 벗어났습니다. 장면을 조정하세요.`);
  const concat=path.join(jobDir,'concat.txt');
  await writeFile(concat,segments.map(s=>`file '${path.basename(s)}'`).join('\n'));
  await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',concat,'-c','copy','-movflags','+faststart',VIDEO_NAME],{cwd:jobDir,timeoutMs:120000});
  const file=path.join(jobDir,VIDEO_NAME),size=(await stat(file)).size;
  if(size<50000)throw new Error('완성된 MP4 용량이 비정상적입니다.');
  const probeAudio=await new Promise((resolve,reject)=>{let output='';const p=spawn('ffprobe',['-v','error','-select_streams','a','-show_entries','stream=codec_name','-of','csv=p=0',file],{windowsHide:true});p.stdout.on('data',b=>output+=b);p.on('error',reject);p.on('close',code=>code===0?resolve(output.trim()):reject(new Error('오디오 검사 실패')));});
  if(!probeAudio.includes('aac'))throw new Error('음성이 없는 영상은 납품할 수 없습니다.');
  return {filename:VIDEO_NAME,bytes:size,durationSeconds:seconds,hasAudio:true,scenes:scenes.length,qualityGate:'passed'};
}

export async function produceDirectorCreative(raw,outputRoot,{director=runShortsDirector,renderer=renderNarratedScenes}={}){
  const {product,images:media}=validateDirectorMedia(raw);
  const job=`creative-${randomBytes(6).toString('hex')}`;
  const dir=path.resolve(outputRoot,job);
  await mkdir(dir,{recursive:true,mode:0o700});
  const staged=[];
  for(let i=0;i<media.length;i++){
    const filename=`photo-${i+1}.${media[i].extension}`;
    await writeFile(path.join(dir,filename),media[i].data,{mode:0o600});
    staged.push(path.join(dir,filename));
  }
  const scenes=await director({shortsHome:process.env.REVENUE_SHORTSAI_HOME,product,images:staged,jobDir:dir});
  const video=await renderer({jobDir:dir,scenes,images:staged});
  const brief={product:{name:product.name,brand:product.brand,audience:product.audience,features:product.features,priceKrw:product.priceKrw},scenes,video,engine:'ShortsAI Shopping Director + isolated TTS/FFmpeg renderer'};
  await writeFile(path.join(dir,'brief.json'),JSON.stringify(brief,null,2));
  await writeFile(path.join(dir,'captions.txt'),scenes.map((s,i)=>`${i+1}. ${s.subtitle}`).join('\n'));
  return {job,files:[...staged.map(x=>path.basename(x)),VIDEO_NAME,'brief.json','captions.txt'],preview:null,status:'DRAFT_REVIEW_REQUIRED',video};
}