import {readFile,writeFile,mkdir,rename,stat} from "node:fs/promises";
import {resolve,join,dirname} from "node:path";
import {createHash} from "node:crypto";
import {readArchitecture,architecturePlan} from "./architecture.mjs";
import {createProceduralProvider,createGeminiImageProvider} from "./image_providers.mjs";
import {createCloudflareImageProvider} from "./cloudflare_provider.mjs";
import {normalizeImage} from "./normalize.mjs";
import {inspectImage} from "./image_qc.mjs";
import {zipEntries} from "./zip.mjs";

const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
function getProvider(plan,mode){
 if(mode==="procedural")return createProceduralProvider({concept:plan.concept,palette:plan.palette});
 if(process.env.THEME_ALLOW_METERED!=="1")throw Error("External image APIs require explicit THEME_ALLOW_METERED=1 and valid keys");
 if(mode==="gemini")return createGeminiImageProvider({apiKey:process.env.GEMINI_API_KEY,model:process.env.THEME_IMAGE_MODEL||"gemini-2.5-flash-image"});
 if(mode==="cloudflare")return createCloudflareImageProvider({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,apiToken:process.env.CLOUDFLARE_AI_TOKEN});
 throw Error("unsupported provider: "+mode);
}
function retryType(e){
 const s=String(e?.message||e);
 if(/429|quota|rate.limit|resource.exhausted/i.test(s))return "quota";
 if(/401|403|invalid.api.key|permission.denied/i.test(s))return "credentials";
 if(/fetch failed|timeout|503|502|500|ECONNRESET/i.test(s))return "transient";
 return "failed";
}
async function writeJson(path,obj){await mkdir(dirname(path),{recursive:true});const tmp=path+".tmp";await writeFile(tmp,JSON.stringify(obj,null,2)+"\n");await rename(tmp,path);}
async function exists(path){try{return (await stat(path)).isFile()}catch(e){if(e.code==="ENOENT")return false;throw e}}
function noTraversal(a){if(!/^assets\/[a-z0-9_-]+\.png$/.test(a.file))throw Error("invalid path "+a.file)}
export async function buildFromArchitecture({architecturePath,outputRoot="./theme-output",mode="procedural",provider=null,sharpLoader=()=>import("sharp"),onProgress=()=>{}}){
 const arch=await readArchitecture(architecturePath),plan=architecturePlan(arch),root=resolve(outputRoot),target=join(root,plan.slug),assetDir=join(target,"assets"),statePath=join(target,"progress.json");
 await mkdir(assetDir,{recursive:true});
 const sourceHash=hash(await readFile(resolve(architecturePath)));
 let progress={architectureSha256:sourceHash,provider:mode,assets:{},status:"working",version:1};
 if(await exists(statePath)){try{const prior=JSON.parse(await readFile(statePath,"utf8"));if(prior.architectureSha256===sourceHash&&prior.provider===mode)progress=prior}catch{}}
 progress.status="working";await writeJson(statePath,progress);
 const generator=provider||getProvider(plan,mode);
 const entries=[],unique=new Set();
 for(const task of plan.tasks){
  noTraversal(task);
  const output=join(target,task.file);
  let bytes;
  if(progress.assets[task.id]?.status==="done"&&await exists(output)){
   const cached=await readFile(output);
   if(hash(cached)===progress.assets[task.id].sha256){
    const info=inspectImage(cached,"png");
    if(info.width===task.width&&info.height===task.height)bytes=cached;
   }
  }
  if(!bytes){
   let raw;
   try{raw=await generator.generate(task);if(!Buffer.isBuffer(raw?.bytes)||!raw.bytes.length)throw Error("empty image");
      bytes=await normalizeImage(raw.bytes,task,{sharpLoader});
      const info=inspectImage(bytes,"png");
      if(info.width!==task.width||info.height!==task.height||bytes.length>40*1024*1024)throw Error("image QC failed: "+task.id);
      await writeFile(output,bytes);
   }catch(e){
      progress.status="interrupted";progress.lastError={asset:task.id,type:retryType(e),message:String(e.message||e).slice(0,600)};
      await writeJson(statePath,progress);throw Error("Asset "+task.id+" interrupted ("+progress.lastError.type+"): "+progress.lastError.message);
   }
   progress.assets[task.id]={status:"done",sha256:hash(bytes),size:bytes.length,width:task.width,height:task.height};
   await writeJson(statePath,progress);onProgress(task.id);
  }
  unique.add(hash(bytes));
  entries.push([task.file,bytes]);
 }
 if(unique.size<plan.quality.minUniqueAssets)throw Error("failed uniqueness QC: "+unique.size+" unique / "+plan.quality.minUniqueAssets+" required");
 const manifest={schemaVersion:1,title:plan.name,slug:plan.slug,concept:plan.concept,style:plan.style,palette:plan.palette,license:plan.license,sourceArchitectureSha256:sourceHash,engine:mode,quality:{checkedDimensions:true,checkedFormats:true,uniqueAssets:unique.size,requiredUniqueAssets:plan.quality.minUniqueAssets,visualReviewRequired:mode!=="procedural"},assets:plan.tasks.map(t=>({id:t.id,type:t.type,file:t.file,width:t.width,height:t.height,sha256:progress.assets[t.id].sha256}))};
 entries.push(["manifest.json",Buffer.from(JSON.stringify(manifest,null,2)+"\n")]);
 entries.push(["architecture.json",await readFile(resolve(architecturePath))]);
 entries.push(["README.txt",Buffer.from("Theme Factory product ZIP\nAll images are PNG. Check aesthetics, artwork rights, and each distribution platform's rules before selling.\nThis ZIP is a wallpaper/icon pack, not a directly installable OS theme.\n")]);
 const archive=join(root,plan.slug+".zip");await writeFile(archive,zipEntries(entries));
 progress.status="complete";progress.zipFile=archive;progress.lastError=null;await writeJson(statePath,progress);
 return {archive,manifest,images:plan.tasks.length,resumedAssets:plan.tasks.length-Object.keys(progress.assets).length};
}
const invoked=process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname;
if(invoked){
 const file=process.argv[2],output=process.argv[3]||"./theme-output";
 if(!file){console.error("Usage: node theme_factory/build_architecture.mjs <architecture.json> [outputDir]");process.exitCode=2}
 else buildFromArchitecture({architecturePath:file,outputRoot:output,mode:process.env.THEME_IMAGE_PROVIDER||"procedural"}).then(r=>console.log(JSON.stringify({zip:r.archive,images:r.images,quality:r.manifest.quality},null,2))).catch(e=>{console.error(e.message);process.exitCode=1});
}
