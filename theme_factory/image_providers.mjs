import {createHash} from "node:crypto";
import {inspectImage} from "./image_qc.mjs";
const palettes=[
 ["#080f27","#283b70","#bc7ce8","#f7c889"],
 ["#071c20","#0e5861","#57c4bb","#d4f3d4"],
 ["#251022","#673d66","#f5a58b","#ffe0b8"],
 ["#0d1527","#365277","#7ba9d6","#e8dfc1"]
];
const esc=s=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
function hash(s){return createHash("sha256").update(s).digest();}
function svgFor(task,concept){
 const w=task.width,h=task.height,seed=hash(concept+"|"+task.id),p=palettes[seed[0]%palettes.length],icon=task.type==="icon";
 const shapes=[];
 let x=seed.readUInt32LE(1);
 const random=()=>{x=(1664525*x+1013904223)>>>0;return x/4294967296};
 for(let i=0;i<(icon?14:100);i++){
  const cx=Math.round(random()*w),cy=Math.round(random()*h),r=Math.round((icon?8:4)+random()*(icon?w*.22:w*.035));
  shapes.push('<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+p[3]+'" opacity="'+(0.06+random()*.22).toFixed(3)+'"/>');
 }
 const motif=(/ocean|sea|water|바다/i.test(concept)?"wave":/garden|forest|botanical|꽃|숲/i.test(concept)?"leaf":/moon|celestial|star|우주|별|달/i.test(concept)?"moon":"crystal");
 const path=motif==="wave"?'<path d="M 0 0 Q 150 -130 300 0 T 600 0" fill="none" stroke="'+p[3]+'" stroke-width="20" stroke-linecap="round"/>':
 motif==="leaf"?'<path d="M0 180 C-240 0 -150 -240 0 -280 C210 -100 210 110 0 180 M0 180 L0 -210" fill="'+p[2]+'" stroke="'+p[3]+'" stroke-width="12" opacity=".87"/>':
 motif==="moon"?'<path d="M 100 -250 A 270 270 0 1 0 100 250 A 200 200 0 1 1 100 -250 Z" fill="'+p[3]+'" opacity=".91"/>':
 '<path d="M 0 -300 L 205 -95 L 160 200 L 0 310 L -160 200 L -205 -95 Z" fill="'+p[2]+'" stroke="'+p[3]+'" stroke-width="18"/>';
 const scale=icon?w/1050:w/1050,centerY=icon?h*.51:h*.58;
 return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="'+p[0]+'"/><stop offset=".55" stop-color="'+p[1]+'"/><stop offset="1" stop-color="'+p[2]+'"/></linearGradient><radialGradient id="halo"><stop stop-color="'+p[2]+'" stop-opacity=".65"/><stop offset="1" stop-color="'+p[2]+'" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/><ellipse cx="'+w/2+'" cy="'+centerY+'" rx="'+w*.8+'" ry="'+w*.8+'" fill="url(#halo)"/>'+shapes.join("")+'<g transform="translate('+w/2+' '+centerY+') scale('+scale+')">'+path+'</g><path d="M 0 '+h*.82+' Q '+w*.4+' '+h*.71+' '+w+' '+h*.85+' L '+w+' '+h+' L 0 '+h+' Z" fill="'+p[0]+'" opacity=".22"/></svg>');
}
export function createProceduralProvider({sharpLoader=()=>import("sharp"),concept}={}){
 if(!concept)throw Error("concept required");
 return {costCents:0,source:"procedural",async generate(task){
 const module=await sharpLoader(),sharp=module.default||module;
 const bytes=await sharp(svgFor(task,concept),{density:72}).png().toBuffer();
 inspectImage(bytes,"png");
 return {bytes};
 }};
}
export function createGeminiImageProvider({apiKey,model="gemini-2.5-flash-image",fetchImpl=fetch}={}){
 if(!apiKey)throw Error("GEMINI_API_KEY required");
 return {costCents:0,source:"gemini",async generate(task){
  const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),120000);
  try{
  const response=await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
   method:"POST",signal:ctl.signal,headers:{"Content-Type":"application/json","x-goog-api-key":apiKey},
   body:JSON.stringify({contents:[{parts:[{text:task.prompt}]}],generationConfig:{responseModalities:["IMAGE"]}})
  });
  const data=await response.json();
  if(!response.ok)throw Error("Gemini image HTTP "+response.status+" "+JSON.stringify(data.error||{}).slice(0,200));
  const image=data.candidates?.[0]?.content?.parts?.find(p=>p.inlineData?.data)?.inlineData;
  if(!image||!/^image\/(png|jpeg|webp)$/.test(image.mimeType))throw Error("Gemini image missing");
  const bytes=Buffer.from(image.data,"base64");if(!bytes.length||bytes.length>40*1024*1024)throw Error("Gemini image size invalid");
  return {bytes};
  }finally{clearTimeout(timeout)}
 }};
}
