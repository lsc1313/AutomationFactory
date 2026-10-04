import {claimExtraction,completeExtraction} from "../extraction/queue.js";
function out(x,s=200){return new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}})}
function auth(request,env){const expected=String(env.PC_WORKER_TOKEN||"");const got=String(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");return expected&&got===expected}
export async function handlePcWorkerApi(request,path,env){
 if(!auth(request,env))return out({ok:false,error:"unauthorized"},401);
 if(path==="/api/factory/pc-worker/claim"&&request.method==="POST"){const job=await claimExtraction(env.DB,{provider:"pc_ocr"});return out({ok:true,job})}
 if(path==="/api/factory/pc-worker/result"&&request.method==="POST"){const b=await request.json().catch(()=>null);if(!b?.id)return out({ok:false,error:"id_required"},400);return out({ok:true,...await completeExtraction(env.DB,{id:b.id,result:b.result,error:b.error})})}
 return null;
}
