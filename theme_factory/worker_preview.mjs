import {reservePreviewQuota} from "./preview_quota.mjs";
const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const MODEL="@cf/bytedance/stable-diffusion-xl-lightning";
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(request.method==="GET"&&(url.pathname==="/"||url.pathname==="/health"))
   return json({app:"Theme Factory",version:"0.2.0",status:"preview",productionReady:false,aiConfigured:Boolean(env?.CLOUDFLARE_AI_TOKEN)});
  if(url.pathname==="/api/preview-image"&&request.method==="POST"){
   // No public image generation: only a configured admin token can authorize inference.
   if(!env?.ADMIN_TOKEN||request.headers.get("authorization")!=="Bearer "+env.ADMIN_TOKEN)return json({error:"unauthorized"},401);
   if(!env?.CLOUDFLARE_AI_TOKEN||!env?.CLOUDFLARE_ACCOUNT_ID)return json({error:"ai_not_configured"},503);
   if(Number(env.THEME_AI_PREVIEW_ENABLED||0)!==1)return json({error:"preview_disabled"},403);
   let input;
   try{input=await request.json()}catch{return json({error:"invalid_json"},400)}
   const prompt=typeof input?.prompt==="string"?input.prompt.trim():"";
   if(!prompt||prompt.length>500)return json({error:"invalid_prompt"},400);
   if(!env?.THEME_QUOTA_DB)return json({error:"quota_not_configured"},503);
   let reserved;
   try{reserved=await reservePreviewQuota(env.THEME_QUOTA_DB,{limit:1})}
   catch{return json({error:"quota_unavailable"},503)}
   if(!reserved)return json({error:"daily_preview_limit_reached"},429);
   const response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)+"/ai/run/"+MODEL,{
    method:"POST",headers:{"Authorization":"Bearer "+env.CLOUDFLARE_AI_TOKEN,"Content-Type":"application/json"},
    body:JSON.stringify({prompt,width:1024,height:1024,num_steps:4})
   });
   if(!response.ok)return json({error:"ai_request_failed",status:response.status},502);
   const contentType=response.headers.get("content-type")||"";
   if(contentType.startsWith("image/"))return new Response(response.body,{headers:{"content-type":contentType,"cache-control":"no-store"}});
   return json({error:"unexpected_ai_response"},502);
  }
  return json({error:"not_found"},404);
 }
};
