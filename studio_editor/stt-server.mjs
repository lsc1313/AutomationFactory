/** Opt-in speech-to-text helper. Does not touch the source media. */
import {randomBytes} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {run} from './timeline-v2.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
export async function transcribeLocal({file,start=0,duration=60,workDir,language='auto',onStep=()=>{}}){
 if(!file||!workDir)throw Error('인식할 영상이 없습니다.');
 if(!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<.1||duration>1200)throw Error('음성 인식 구간은 0.1~1200초 사이여야 합니다.');
 await mkdir(workDir,{recursive:true});const output=path.join(workDir,randomBytes(12).toString('hex')+'.json');
 const script=path.join(ROOT,'stt-local.py');
 const env=process.env;
 const versions=['Python314','Python313','Python312','Python311','Python310','Python39'];
 const pythonDir=env.LOCALAPPDATA?path.join(env.LOCALAPPDATA,'Programs','Python'):null;
 const choices=[env.STUDIO_PYTHON,...(pythonDir?versions.map(v=>path.join(pythonDir,v,'python.exe')):[]),'python','python3','py'].filter(Boolean);
 let last='';
 for(const exe of [...new Set(choices)]){
  try{
   onStep('CPU 음성 인식: '+path.basename(exe));
   await run(exe,[...(exe==='py'?['-3']:[]),script,'--input',file,'--output',output,'--start',String(start),'--duration',String(duration),'--language',language],{cwd:workDir,timeout:1200000});
   const parsed=JSON.parse(await readFile(output,'utf8'));
   if(!Array.isArray(parsed.segments))throw Error('STT 결과 형식이 잘못되었습니다.');
   return {language:parsed.language,segments:parsed.segments.filter(x=>Number.isFinite(Number(x.start))&&Number.isFinite(Number(x.end))&&typeof x.text==='string').slice(0,500)};
  }catch(e){last=e.message;}
 }
 throw Error('로컬 음성 인식 실패: '+last.slice(-600));
}