import {reservePreviewQuota} from "./preview_quota.mjs";
const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const MODEL="@cf/bytedance/stable-diffusion-xl-lightning";
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(request.method==="GET"&&(url.pathname==="/"||url.pathname==="/health"))
   return json({app:"Theme Factory",version:"0.2.1",status:"preview",productionReady:false,aiConfigured:Boolean(env?.CLOUDFLARE_AI_TOKEN),previewReady:Boolean(env?.CLOUDFLARE_AI_TOKEN&&env?.CLOUDFLARE_ACCOUNT_ID&&env?.ADMIN_TOKEN&&env?.THEME_QUOTA_DB&&Number(env?.THEME_AI_PREVIEW_ENABLED||0)===1),previewEnabled:Number(env?.THEME_AI_PREVIEW_ENABLED||0)===1,quotaConfigured:Boolean(env?.THEME_QUOTA_DB)});
  if(request.method==="GET"&&url.pathname==="/preview")return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Theme Factory 첫 이미지 테스트</title><style>body{font:16px system-ui;background:#12151d;color:#fff;max-width:540px;margin:30px auto;padding:16px}input,textarea,button{box-sizing:border-box;width:100%;margin:9px 0;padding:13px;border-radius:8px;border:1px solid #626776;font:inherit}button{background:#7867e8;color:white;border:0}img{width:100%;margin-top:16px}small{color:#bbb}</style><h2>Theme Factory · 첫 이미지 테스트</h2><p>관리자 토큰은 이 화면에서만 입력하고 저장하지 않습니다. 이미지 생성은 하루 1회로 제한됩니다.</p><label>관리자 토큰<input id="token" type="password" autocomplete="off" placeholder="Cloudflare ADMIN_TOKEN"></label><label>이미지 설명<textarea id="prompt" rows="4" maxlength="500">Premium smartphone wallpaper, mystical moonlight over violet galaxy mountains, elegant luminous mist, intricate atmospheric detail, no text, no logos</textarea></label><button id="go">이미지 1장 생성</button><p id="status" role="status"></p><img id="result" alt="생성된 배경화면" hidden><small>이 요청은 실제 AI 추론을 실행하며 무료 사용을 보장하지 않습니다. 실패해도 오늘의 1회 제한이 소모될 수 있습니다.</small><script>const go=document.getElementById('go'),status=document.getElementById('status'),img=document.getElementById('result');go.onclick=async()=>{const token=document.getElementById('token').value,prompt=document.getElementById('prompt').value.trim();if(!token||!prompt){status.textContent='토큰과 설명을 입력하세요';return}go.disabled=true;status.textContent='이미지 생성 요청 중…';img.hidden=true;try{const r=await fetch('/api/preview-image',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({prompt})});if(!r.ok){const e=await r.json();status.textContent='실패: '+(e.error||r.status)+' ('+r.status+')'+(Number.isInteger(e.status)?' / Cloudflare HTTP '+e.status:'')+(typeof e.upstreamCode==='number'?' / 코드 '+e.upstreamCode:'');return}const blob=await r.blob();if(!blob.type.startsWith('image/'))throw Error('이미지 형식이 아닙니다');img.src=URL.createObjectURL(blob);img.hidden=false;status.textContent='생성 성공! 이미지를 길게 눌러 저장하세요.'}catch(e){status.textContent='요청 오류: '+e.message}finally{document.getElementById('token').value='';go.disabled=false}};</script></html>`,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'","referrer-policy":"no-referrer","x-content-type-options":"nosniff"}});
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
   let response;
   try{response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)+"/ai/run/"+MODEL,{
    method:"POST",headers:{"Authorization":"Bearer "+env.CLOUDFLARE_AI_TOKEN,"Content-Type":"application/json"},
    body:JSON.stringify({prompt,width:1024,height:1024,num_steps:4})
   });}catch{return json({error:"ai_network_failed"},502)}
   if(!response.ok){
    let upstreamCode;
    try{const data=await response.json();const code=data?.errors?.[0]?.code;if(Number.isInteger(code))upstreamCode=code}catch{}
    return json({error:"ai_request_failed",status:response.status,...(upstreamCode===undefined?{}:{upstreamCode})},502);
   }
   const contentType=response.headers.get("content-type")||"";
   if(contentType.startsWith("image/"))return new Response(response.body,{headers:{"content-type":contentType,"cache-control":"no-store"}});
   return json({error:"unexpected_ai_response"},502);
  }
  return json({error:"not_found"},404);
 }
};
