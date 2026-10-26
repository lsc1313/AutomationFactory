// Cloudflare Workers AI REST adapter. Requires account ID and scoped API token.
// API billing/quotas are controlled by Cloudflare, not by this client.
export function createCloudflareImageProvider({accountId,apiToken,model="@cf/bytedance/stable-diffusion-xl-lightning",fetchImpl=fetch,allowBillable=false}={}){
 if(!accountId||!apiToken)throw Error("Cloudflare account ID and API token required");
 if(allowBillable)throw Error("billable mode not supported");
 const url="https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(accountId)+"/ai/run/"+model;
 return {costCents:0,async generate(task){
  if(!task||typeof task.prompt!=="string")throw Error("invalid task");
  const response=await fetchImpl(url,{method:"POST",headers:{"Authorization":"Bearer "+apiToken,"Content-Type":"application/json"},body:JSON.stringify({prompt:task.prompt,width:Math.min(task.width,1024),height:Math.min(task.height,2048),num_steps:4})});
  if(!response.ok)throw Error("Cloudflare AI request failed: HTTP "+response.status);
  const type=response.headers.get("content-type")||"";
  let bytes;
  if(type.includes("application/json")){
   const data=await response.json();
   if(data.success===false)throw Error("Cloudflare AI rejected request");
   const base64=data.result?.image||data.result?.output?.image;
   if(typeof base64!=="string")throw Error("Cloudflare AI JSON response lacks image");
   bytes=Buffer.from(base64,"base64");
  }else bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length<24||bytes.length>40*1024*1024)throw Error("invalid Cloudflare image size");
  return {bytes};
 }};
}
