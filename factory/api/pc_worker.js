import {finalizeExtraction} from "../extraction/extraction_bridge.js";
import {readSource,deleteSource} from "../storage/object_storage.js";
import {claimExtraction,completeExtraction} from "../extraction/queue.js";
function out(x,s=200){return new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}})}
function auth(request,env){const expected=String(env.PC_WORKER_TOKEN||"");const got=String(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");return expected&&got===expected}
export async function handlePcWorkerApi(request,path,env){
 if(!auth(request,env))return out({ok:false,error:"unauthorized"},401);
 if(path==="/api/factory/pc-worker/claim"&&request.method==="POST"){const job=await claimExtraction(env.DB,{provider:"pc_ocr"});return out({ok:true,job})}
 if(path==="/api/factory/pc-worker/source"&&request.method==="GET"){const key=new URL(request.url).searchParams.get("key")||"";if(!key.startsWith("intake/"))return out({ok:false,error:"invalid_source_key"},400);const obj=await readSource(env,key);if(!obj)return out({ok:false,error:"source_not_found"},404);return new Response(await obj.arrayBuffer(),{headers:{"content-type":obj.httpMetadata?.contentType||"application/octet-stream","cache-control":"no-store"}})}
 if(path==="/api/factory/pc-worker/result"&&request.method==="POST"){const b=await request.json().catch(()=>null);if(!b?.id)return out({ok:false,error:"id_required"},400);let finalized=null;if(!b.error&&b.result){finalized=finalizeExtraction({file:{name:b.file_name||b.source_key||"file",mime:b.mime_type||""},result:b.result});}
 const storedResult=finalized?{raw:b.result,intake:finalized}:b.result;const done=await completeExtraction(env.DB,{id:b.id,result:storedResult,error:b.error});if(b.source_key&&b.delete_source!==false)await deleteSource(env,b.source_key);return out({ok:true,...done,intake:finalized,source_deleted:Boolean(b.source_key&&b.delete_source!==false)})}
 return null;
}
