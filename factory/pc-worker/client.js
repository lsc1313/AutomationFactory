export function config(env=process.env){return {base:String(env.FACTORY_BASE_URL||"").replace(/\/$/,""),token:String(env.PC_WORKER_TOKEN||""),interval:Number(env.PC_WORKER_INTERVAL_MS||15000)}}
async function call(c,path,opt={}){const r=await fetch(c.base+path,{...opt,headers:{authorization:"Bearer "+c.token,...(opt.headers||{})}});if(!r.ok)throw new Error(path+" HTTP "+r.status+" "+(await r.text()).slice(0,200));return r}
export async function claim(c){return (await (await call(c,"/api/factory/pc-worker/claim",{method:"POST"})).json()).job||null}
export async function source(c,key){return new Uint8Array(await (await call(c,"/api/factory/pc-worker/source?key="+encodeURIComponent(key))).arrayBuffer())}
export async function submit(c,{id,result,error="",source_key=""}){return await (await call(c,"/api/factory/pc-worker/result",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,result,error,source_key})})).json()}

export async function sendHeartbeat(c,{worker_id="home-pc",capabilities={}}={}){return await (await call(c,"/api/factory/pc-worker/heartbeat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({worker_id,capabilities})})).json()}
