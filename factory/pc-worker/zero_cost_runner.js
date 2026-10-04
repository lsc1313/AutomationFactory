import {spawn} from "node:child_process";
import readline from "node:readline";
function need(name){const v=String(process.env[name]||"");if(!v)throw new Error(name+"_REQUIRED");return v}
function child(cmd,args,env=process.env){return spawn(cmd,args,{env,stdio:["ignore","pipe","pipe"],windowsHide:true})}
export async function startZeroCost(){
 need("FACTORY_BASE_URL");need("PC_WORKER_TOKEN");const port=String(process.env.PC_LOCAL_PORT||"8788"),env={...process.env,PC_LOCAL_HOST:"127.0.0.1",PC_LOCAL_PORT:port};
 const local=child(process.execPath,["factory/pc-worker/local_server.js"],env);local.stdout.pipe(process.stdout);local.stderr.pipe(process.stderr);
 const tunnel=child(process.env.CLOUDFLARED_CMD||"cloudflared",["tunnel","--url","http://127.0.0.1:"+port],env);tunnel.stdout.pipe(process.stdout);
 let done=false;const stop=()=>{if(done)return;done=true;local.kill();tunnel.kill()};process.once("SIGINT",()=>{stop();process.exit(0)});process.once("SIGTERM",()=>{stop();process.exit(0)});
 try{const endpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("TUNNEL_URL_TIMEOUT")),30000),rl=readline.createInterface({input:tunnel.stderr});rl.on("line",line=>{process.stderr.write(line+"\n");const m=line.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);if(m){clearTimeout(timer);rl.close();resolve(m[0])}});tunnel.once("error",e=>{clearTimeout(timer);reject(e)});tunnel.once("exit",code=>{if(!done){clearTimeout(timer);reject(new Error("CLOUDFLARED_EXIT_"+code))}})});
  console.log("Exception Factory PC ONLINE:",endpoint);const worker=child(process.execPath,["factory/pc-worker/index.js"],{...env,PC_PUBLIC_ENDPOINT:endpoint});worker.stdout.pipe(process.stdout);worker.stderr.pipe(process.stderr);await new Promise((resolve,reject)=>{worker.once("exit",code=>code===0?resolve():reject(new Error("PC_WORKER_EXIT_"+code)));worker.once("error",reject)});
 }finally{stop()}
}
if(import.meta.url===`file://${process.argv[1]?.replaceAll("\\","/")}`)startZeroCost().catch(e=>{console.error("[PC ZERO COST]",e.message);process.exit(1)});
