import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import {resolve,dirname,join} from "node:path";
import {makeGenerationPlan} from "./generation.mjs";
import {storefrontListing} from "./product.mjs";

const root=resolve(process.env.THEME_AGENT_DIR||"theme_factory/agent-data");
const stateFile=join(root,"state.json");
const iso=()=>new Date().toISOString();
const slugify=s=>String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,50)||"theme";
async function load(){try{const x=JSON.parse(await readFile(stateFile,"utf8"));if(!Array.isArray(x.jobs))throw Error("invalid agent state");return x}catch(e){if(e.code==="ENOENT")return {version:1,jobs:[]};throw e}}
async function save(s){await mkdir(root,{recursive:true});const p=stateFile+".tmp";await writeFile(p,JSON.stringify(s,null,2)+"\n");await rename(p,stateFile)}
const waitMs=attempt=>Math.min(24*3600_000,15*60_000*2**Math.min(attempt,7));
const canRun=j=>j.status==="queued"||(j.status==="deferred"&&Date.parse(j.nextRunAt)<=Date.now());
function failKind(e){const m=String(e?.message||e);if(/429|quota|resource.exhausted|rate.limit/i.test(m))return "quota";if(/401|403|invalid.api.key|permission.denied/i.test(m))return "auth";if(/fetch failed|timeout|503|502|500/i.test(m))return "temporary";return "invalid"}
async function aiDescription(concept){
 const key=process.env.GEMINI_API_KEY;
 if(!key)return {description:"Premium mobile wallpaper collection featuring "+concept+". Includes coordinated lock screen and curated theme assets.",source:"template"};
 const model=process.env.THEME_TEXT_MODEL||"gemini-2.5-flash";
 const ctl=new AbortController();const timeout=setTimeout(()=>ctl.abort(),30000);
 try{
 const url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent";
 const response=await fetch(url,{method:"POST",signal:ctl.signal,headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{parts:[{text:"Write a concise original English storefront description (40-75 words) for a mobile wallpaper theme called: "+concept+". Avoid guarantees, trademarks, copyrighted characters and unverified claims. Return only description text."}]}],generationConfig:{temperature:0.7,maxOutputTokens:200}})});
 const data=await response.json();if(!response.ok)throw Error("Gemini HTTP "+response.status+": "+JSON.stringify(data.error||{}).slice(0,300));
 const description=data.candidates?.[0]?.content?.parts?.map(x=>x.text||"").join("").trim();
 if(!description)throw Error("empty model response");return {description:description.slice(0,3000),source:"gemini"};
 }finally{clearTimeout(timeout)}
}
async function runOne(j){
 const result=await aiDescription(j.concept);
 const plan=makeGenerationPlan({slug:j.slug,concept:j.concept,style:j.style,wallpapers:j.wallpapers,icons:j.icons});
 const product={slug:j.slug,title:j.concept,description:result.description,wallpapers:plan.tasks.filter(t=>t.type!=="icon").map(t=>({file:t.file,width:t.width,height:t.height})),icons:plan.tasks.filter(t=>t.type==="icon").map(t=>({file:t.file,width:t.width,height:t.height}))};
 const dir=join(root,"drafts",j.slug);await mkdir(dir,{recursive:true});
 await writeFile(join(dir,"generation-plan.json"),JSON.stringify(plan,null,2)+"\n");
 await writeFile(join(dir,"product-draft.json"),JSON.stringify({...product,assetStatus:"not-generated",descriptionSource:result.source},null,2)+"\n");
 await writeFile(join(dir,"listing-draft.json"),JSON.stringify({...storefrontListing(product),assetStatus:"not-generated"},null,2)+"\n");
 return {path:dir,descriptionSource:result.source};
}
function enqueue(s,concept,options={}){
 if(typeof concept!=="string"||!concept.trim()||concept.length>160)throw Error("concept must be 1-160 characters");
 const title=concept.trim();const slug=slugify(title);if(s.jobs.some(x=>x.slug===slug))return false;
 const wallpapers=Number(options.wallpapers??3),icons=Number(options.icons??10);
 if(!Number.isInteger(wallpapers)||wallpapers<1||wallpapers>12||!Number.isInteger(icons)||icons<0||icons>40)throw Error("invalid counts");
 s.jobs.push({slug,concept:title,style:options.style||"premium cohesive illustration",wallpapers,icons,status:"queued",attempts:0,createdAt:iso(),updatedAt:iso(),nextRunAt:null,error:null});return true;
}
const cmd=process.argv[2]||"run";
try{
 const s=await load();
 if(cmd==="enqueue"){const concept=process.argv.slice(3).join(" ");const created=enqueue(s,concept);await save(s);console.log(JSON.stringify({created,concept}));}
 else if(cmd==="seed"){for(const c of ["Moonlit botanical garden","Obsidian dragon sanctuary","Celestial ocean","Autumn watercolor village"])enqueue(s,c);await save(s);console.log("Seeded "+s.jobs.length+" jobs");}
 else if(cmd==="status"){console.log(JSON.stringify(s,null,2));}
 else if(cmd==="run"){
  const limit=Math.min(20,Math.max(1,Number(process.env.THEME_MAX_JOBS||3)||3));
  let count=0;
  for(const j of s.jobs.filter(canRun).slice(0,limit)){
   j.status="running";j.updatedAt=iso();await save(s);
   try{const out=await runOne(j);j.status="draft_ready";j.output=out;j.error=null;}
   catch(e){const kind=failKind(e);j.attempts++;j.error=String(e.message||e).slice(0,500);j.status=kind==="auth"||kind==="invalid"?"blocked":"deferred";j.nextRunAt=j.status==="deferred"?new Date(Date.now()+waitMs(j.attempts)).toISOString():null;j.errorKind=kind;}
   j.updatedAt=iso();await save(s);count++;
  }
  console.log(JSON.stringify({processed:count,counts:s.jobs.reduce((a,j)=>(a[j.status]=(a[j.status]||0)+1,a),{})}));
 }else throw Error("Usage: agent.mjs enqueue <concept> | seed | run | status");
}catch(e){console.error(e.stack||e);process.exitCode=1}
