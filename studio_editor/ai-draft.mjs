/** AI-first storyboard from the user's own uploaded assets. No generative video.
 * Vision API gets low-resolution thumbnails/keyframes only if the user explicitly starts AI drafting.
 */
import path from 'node:path';
import os from 'node:os';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const MODEL=process.env.STUDIO_GEMINI_MODEL||'gemini-2.5-flash-lite';
const API='https://generativelanguage.googleapis.com/v1beta/models/';
const safe=t=>String(t??'').replace(/[\r\n\0]+/g,' ').trim();
export function parseKeyFile(text){return String(text).split(/\r?\n/).map(x=>x.match(/^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*["']?([^\s"'#]+)["']?/)?.[1]||'') .find(Boolean)||null;}
export async function findExistingGeminiKey(){
 if(process.env.STUDIO_GEMINI_API_KEY)return process.env.STUDIO_GEMINI_API_KEY;
 if(process.env.GEMINI_API_KEY)return process.env.GEMINI_API_KEY;
 const profile=process.env.USERPROFILE||os.homedir(), home=process.env.REVENUE_SHORTSAI_HOME||process.env.STUDIO_SHORTSAI_HOME;
 const candidates=[home&&path.join(home,'.env'),path.join(profile,'ShortsAI_CLEAN','.env'),path.join(profile,'Desktop','ShortsAI_CLEAN','.env'),path.join(profile,'Documents','ShortsAI_CLEAN','.env'),
  'D:/ShortsAI_CLEAN/.env','D:/ShortsAI/.env','D:/AutomationFactory/ShortsAI_CLEAN/.env'];
 for(const filename of candidates.filter(Boolean))try{const key=parseKeyFile(await readFile(filename,'utf8'));if(key)return key;}catch{}
 return null;
}
async function sampleImage(filename,isVideo){
 const args=['-hide_banner','-loglevel','error',...(isVideo?['-ss','0.5']:[]),'-i',filename,'-vf','scale=640:640:force_original_aspect_ratio=decrease','-frames:v','1','-f','image2','-vcodec','mjpeg','-q:v','6','pipe:1'];
 return new Promise((resolve,reject)=>{
  const p=spawn('ffmpeg',args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let chunks=[],bytes=0,stderr='';
  const timer=setTimeout(()=>p.kill(),30000);p.stdout.on('data',b=>{bytes+=b.length;if(bytes>1_000_000){p.kill();return;}chunks.push(b)});
  p.stderr.on('data',b=>stderr=(stderr+b).slice(-250));p.on('error',e=>{clearTimeout(timer);reject(e)});
  p.on('close',code=>{clearTimeout(timer);if(code!==0||!bytes||bytes>1_000_000)return reject(new Error('미디어 미리보기 추출 실패: '+stderr));resolve(Buffer.concat(chunks).toString('base64'))});
 });
}
export function normalizeDraft(raw,media){
 const obj=raw?.storyboard||raw;
 if(!obj||!Array.isArray(obj.scenes)||obj.scenes.length<2||obj.scenes.length>12)throw new Error('AI가 올바른 장면 초안을 반환하지 않았습니다.');
 const scenes=obj.scenes.map((scene,i)=>{
  const ix=Number(scene.mediaIndex),duration=Number(scene.duration);
  if(!Number.isInteger(ix)||ix<0||ix>=media.length)throw new Error(`AI 장면 ${i+1}의 사진/영상 연결이 잘못됐습니다.`);
  const narration=safe(scene.narration||scene.voice).slice(0,350),caption=safe(scene.caption||scene.subtitle).slice(0,130);
  if(!narration||!caption)throw new Error(`AI 장면 ${i+1}에 대사 또는 자막이 없습니다.`);
  return {mediaId:media[ix].id,duration:Math.min(12,Math.max(2,Number.isFinite(duration)?duration:4)),narration,caption,
   captionStyle:['impact','minimal','boxed','clean'].includes(scene.captionStyle)?scene.captionStyle:(i===0?'impact':'clean'),
   captionPosition:['top','middle','bottom'].includes(scene.captionPosition)?scene.captionPosition:(i%3===0?'top':'bottom'),
   effect:['zoom-in','zoom-out','pan-left','pan-right','none'].includes(scene.effect)?scene.effect:['zoom-in','pan-right','zoom-out','pan-left'][i%4]};
 });
 return {title:safe(obj.title||'AI 영상 초안').slice(0,100),scenes,notes:safe(obj.notes||'').slice(0,600)};
}
export function parseModelJson(text){const input=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');let parsed;try{parsed=JSON.parse(input);}catch{const begin=input.indexOf('{'),end=input.lastIndexOf('}');if(begin<0||end<=begin)throw new Error('AI 답변을 JSON 형식으로 읽을 수 없습니다.');parsed=JSON.parse(input.slice(begin,end+1));}return parsed;}
export async function generateAiDraft({key,media,requirements,productFacts='',style='dynamic',onStep=()=>{},fetchFn=fetch,sampler=sampleImage,mediaPath}){
 if(!key)throw new Error('무료 한도 사용 가능한 Gemini API 키가 필요합니다. AI 설정에 키를 등록하세요.');
 if(!Array.isArray(media)||media.length<1||media.length>10)throw new Error('사진 또는 영상 1~10개를 선택하세요.');
 const instruction=safe(requirements).slice(0,1800),facts=safe(productFacts).slice(0,2400);
 if(instruction.length<5)throw new Error('만들고 싶은 영상의 요구사항을 5자 이상 입력하세요.');
 const vision=[];
 for(let i=0;i<media.length;i++){
  const file=media[i];onStep(`사진·영상 ${i+1}/${media.length} 확인`);
  const b64=await sampler(mediaPath(file),file.group==='video');
  vision.push({text:`자료 ${i}: 파일명 ${safe(file.name).slice(0,90)}, 형식 ${file.group}. 이 실제 자료의 내용만 근거로 사용하세요.`});
  vision.push({inline_data:{mime_type:'image/jpeg',data:b64}});
 }
 onStep('AI 대본과 자막 기획');
 const prompt=[
 '당신은 제공받은 영상/사진을 편집해 숏폼 초안을 설계하는 전문 편집 감독입니다. 새로운 AI 영상이나 가상 이미지를 만들지 않습니다.',
 '현재 첨부된 이미지 및 영상 첫 프레임을 실제로 보세요. 영상 전체의 행동·음성은 제공되지 않았으므로 첫 프레임에서 보이지 않는 내용은 단정하지 마세요.',
 '사용자 요구사항과 확인된 화면을 연결하고 자연스러운 한국어 대사를 작성하세요. 제품 광고라면 입증되지 않은 효능, 가격, 할인, 후기, 재료, 수상, 배송 조건을 창작하지 마세요.',
 '사용자가 작성한 정보는 주장으로 간주하지 말고 주어진 사실로서만 활용하되 사진과 충돌하면 notes에서 검토 필요를 알리세요.',
 '전달력이 있는 3~8개 장면, 한 장면당 대사 1~2문장, 2~8초. 후킹, 본문, 마무리의 흐름을 구성하고 이미지와 대사를 일치시키세요.',
 '한 장면에 사진 또는 영상 하나를 선택합니다. 파일당 여러 장면 사용 가능. 장면별 사진이 명확히 맞아야 하며 필요 없는 사진은 사용하지 않아도 됩니다.',
 '영상의 분위기에 맞춰 자막 위치·스타일·카메라 움직임을 다양하게 선택하세요. 자막은 대사 핵심을 35자 이내로 줄이세요.',
 '모호한 물체나 텍스트는 추측하지 마세요. 출력은 JSON 객체만 반환합니다.',
 '출력 형식 {"title":"영상 제목","notes":"사용자 검토가 필요한 사실이나 이미지 내용이 있으면 작성","scenes":[{"mediaIndex":0,"duration":4,"narration":"대사","caption":"자막","captionStyle":"impact|minimal|boxed|clean","captionPosition":"top|middle|bottom","effect":"zoom-in|zoom-out|pan-left|pan-right|none"}]}',
 '스타일: '+style,'사용자의 영상 제작 요구사항: '+instruction,'사용자가 제공한 설명·특징: '+facts
 ].join('\n');
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),110000);
 let response;
 try{response=await fetchFn(`${API}${encodeURIComponent(MODEL)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:prompt},...vision]}],generationConfig:{responseMimeType:'application/json',temperature:0.5}}),signal:controller.signal});}
 catch(e){throw new Error(e.name==='AbortError'?'AI 응답 시간 초과입니다. 나중에 다시 시도하세요.':'AI 연결 실패: '+e.message)}finally{clearTimeout(timeout)}
 const data=await response.json().catch(()=>({}));
 if(!response.ok){const message=safe(data.error?.message||response.statusText).slice(0,220);throw new Error(`Gemini API 요청 실패 (${response.status}): ${message}`)}
 const text=data.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||'';
 if(!text)throw new Error('AI가 장면 초안을 반환하지 않았습니다. 모델 무료 사용량이나 콘텐츠 제한을 확인하세요.');
 return normalizeDraft(parseModelJson(text),media);
}