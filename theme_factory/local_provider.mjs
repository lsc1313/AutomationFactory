import {spawn} from "node:child_process";
const MAX_BYTES=40*1024*1024;
export function createLocalCommandProvider({command,args=[],timeoutMs=120000}={}){
 if(typeof command!=="string"||!command.trim()||!Array.isArray(args)||args.some(a=>typeof a!=="string"))throw Error("invalid local command");
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>600000)throw Error("invalid timeout");
 return {costCents:0,async generate(task){
  const env={...process.env,THEME_PROMPT:task.prompt,THEME_WIDTH:String(task.width),THEME_HEIGHT:String(task.height),THEME_TASK_ID:task.id};
  return await new Promise((resolve,reject)=>{
   const child=spawn(command,args,{shell:false,env,stdio:["ignore","pipe","pipe"]});
   const chunks=[];let bytes=0,stderr="",settled=false;
   const timer=setTimeout(()=>child.kill("SIGKILL"),timeoutMs);
   const finish=(err,data)=>{if(settled)return;settled=true;clearTimeout(timer);if(err)reject(err);else resolve({bytes:data})};
   child.on("error",e=>finish(e));
   child.stdout.on("data",chunk=>{bytes+=chunk.length;if(bytes>MAX_BYTES){child.kill("SIGKILL");finish(Error("image exceeds 40 MB"));return}chunks.push(chunk)});
   child.stderr.on("data",chunk=>{stderr=(stderr+chunk.toString()).slice(-2000)});
   child.on("close",(code,signal)=>{if(settled)return;if(signal==="SIGKILL")return finish(Error("local generator timed out or was killed"));if(code!==0)return finish(Error("local generator exited "+code+": "+stderr));finish(null,Buffer.concat(chunks))});
  });
 }};
}
