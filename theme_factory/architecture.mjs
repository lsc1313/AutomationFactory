import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
const slug=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const id=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const hex=/^#[0-9a-fA-F]{6}$/;
export function validateArchitecture(input){
 if(!input||typeof input!=="object"||Array.isArray(input))throw Error("architecture must be an object");
 if(input.schemaVersion!==1)throw Error("unsupported architecture schemaVersion; expected 1");
 const name=String(input.name||"").trim(),themeSlug=String(input.slug||"");
 if(!name||name.length>120||!slug.test(themeSlug))throw Error("invalid name or slug");
 const concept=String(input.concept||"").trim(),style=String(input.style||"").trim();
 if(!concept||concept.length>500||!style||style.length>500)throw Error("concept and style required");
 const palette=input.palette;
 if(!Array.isArray(palette)||palette.length<2||palette.length>8||palette.some(p=>!hex.test(p)))throw Error("palette must contain 2-8 hex colors");
 const a=input.assets;
 if(!Array.isArray(a)||!a.length||a.length>60)throw Error("assets must contain 1-60 entries");
 const ids=new Set(),files=new Set();
 const assets=a.map((raw,index)=>{
  if(!raw||typeof raw!=="object")throw Error("invalid asset at "+index);
  const {id:assetId,type,width,height}=raw;
  if(typeof assetId!=="string"||!id.test(assetId)||ids.has(assetId))throw Error("invalid or duplicate asset id: "+assetId);
  if(!["wallpaper","lockscreen","icon","banner","preview","other"].includes(type))throw Error("unsupported asset type: "+type);
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<128||height<128||width>6000||height>8000)throw Error("invalid dimensions for "+assetId);
  const detail=String(raw.prompt||"").trim();
  if(!detail||detail.length>1500)throw Error("asset prompt required: "+assetId);
  const file="assets/"+assetId+".png";
  if(files.has(file))throw Error("duplicate asset file");
  if(raw.negativePrompt!=null&&String(raw.negativePrompt).length>500)throw Error("negativePrompt too long");
  ids.add(assetId);files.add(file);
  return {id:assetId,type,width,height,file,prompt:detail,negativePrompt:String(raw.negativePrompt||"").trim()};
 });
 if(!assets.some(x=>x.type==="wallpaper"))throw Error("at least one wallpaper required");
 const quality=input.quality||{};
 if(quality.minUniqueAssets!=null&&(!Number.isInteger(quality.minUniqueAssets)||quality.minUniqueAssets<1||quality.minUniqueAssets>assets.length))throw Error("invalid minUniqueAssets");
 const license=String(input.license||"personal-use").trim();
 if(license.length>120)throw Error("license too long");
 return {schemaVersion:1,slug:themeSlug,name,concept,style,palette:palette.map(x=>x.toLowerCase()),assets,quality:{minUniqueAssets:quality.minUniqueAssets||assets.length},license,metadata:{...((input.metadata&&typeof input.metadata==="object"&&!Array.isArray(input.metadata))?input.metadata:{})}};
}
export async function readArchitecture(path){return validateArchitecture(JSON.parse(await readFile(resolve(path),"utf8")))}
export function architecturePlan(arch){
 const p=validateArchitecture(arch);
 const tasks=p.assets.map(a=>({
  ...a,
  prompt:"Create one high-quality original mobile theme asset. Theme: "+p.name+". Concept: "+p.concept+". Visual art direction: "+p.style+". Palette: "+p.palette.join(", ")+". Asset type: "+a.type+". Unique asset identity: "+a.id+". Specific composition and subject: "+a.prompt+". Consistent motif, coherent palette, clear focal hierarchy. No lettering, no watermarks, no trademarks. "+(a.negativePrompt?"Avoid: "+a.negativePrompt+".":""),
 }));
 return {...p,tasks};
}
