import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import {resolve,join} from "node:path";
import {createProceduralProvider,createGeminiImageProvider} from "./image_providers.mjs";
import {createCloudflareImageProvider} from "./cloudflare_provider.mjs";
import {produceTheme} from "./produce.mjs";
const root=resolve(process.env.THEME_AGENT_DIR||"theme_factory/agent-data");
const state=join(root,"state.json");
const mode=process.env.THEME_IMAGE_PROVIDER||"procedural";
const max=Math.max(1,Math.min(5,Number(process.env.THEME_RENDER_LIMIT||1)||1));
function classify(e){const s=String(e?.message||e);return /429|quota|rate.limit|resource.exhausted/i.test(s)?"quota":/401|403|invalid.api.key|permission.denied/i.test(s)?"auth":/fetch failed|timeout|503|502|500|ECONNRESET/i.test(s)?"temporary":"invalid"}
function provider(concept){
 if(mode==="procedural")return createProceduralProvider({concept});
 if(mode==="gemini"){
  if(process.env.THEME_ALLOW_METERED!=="1")throw Error("Metered image API requires THEME_ALLOW_METERED=1");
  return createGeminiImageProvider({apiKey:process.env.GEMINI_API_KEY,model:process.env.THEME_IMAGE_MODEL||"gemini-2.5-flash-image"});
 }
 if(mode==="cloudflare"){
  if(process.env.THEME_ALLOW_METERED!=="1")throw Error("Cloudflare API requires THEME_ALLOW_METERED=1");
  return createCloudflareImageProvider({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,apiToken:process.env.CLOUDFLARE_AI_TOKEN});
 }
 throw Error("unknown provider: "+mode);
}
async function persist(s){await mkdir(root,{recursive:true});const tmp=state+".tmp";await writeFile(tmp,JSON.stringify(s,null,2)+"\n");await rename(tmp,state)}
try{
 const s=JSON.parse(await readFile(state,"utf8"));let count=0;
 for(const j of s.jobs.filter(x=>x.status==="draft_ready"||(x.status==="render_deferred"&&Date.parse(x.nextRunAt)<=Date.now())).slice(0,max)){
  j.status="rendering";j.updatedAt=new Date().toISOString();await persist(s);
  try{
   const p=provider(j.concept);
   // Artwork generation may return native sizes unlike target; normalization is mandatory.
   const output=await produceTheme({slug:j.slug,concept:j.concept,style:j.style,wallpapers:j.wallpapers,icons:j.icons,title:j.concept,description:"Coordinated mobile art theme: "+j.concept},p,join(root,"products"),{normalize:true});
   j.status="ready_for_review";j.product={archive:output.archive,assets:output.assets,provider:mode};j.error=null;
  }catch(e){
   const type=classify(e);j.renderAttempts=(j.renderAttempts||0)+1;j.error=String(e.message||e).slice(0,500);j.errorKind=type;
   j.status=type==="quota"||type==="temporary"?"render_deferred":"render_blocked";
   j.nextRunAt=j.status==="render_deferred"?new Date(Date.now()+Math.min(86400000,900000*2**Math.min(j.renderAttempts,7))).toISOString():null;
  }
  j.updatedAt=new Date().toISOString();await persist(s);count++;
 }
 console.log(JSON.stringify({processed:count,provider:mode,counts:s.jobs.reduce((a,j)=>(a[j.status]=(a[j.status]||0)+1,a),{})}));
}catch(e){console.error(e.stack||e);process.exitCode=1}
