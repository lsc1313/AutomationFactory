import {mkdir,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {makeGenerationPlan,runGeneration} from "./generation.mjs";
import {inspectImage} from "./image_qc.mjs";
import {buildPackage} from "./zip.mjs";
import {normalizeImage} from "./normalize.mjs";

export async function produceTheme({slug,concept,style,wallpapers=3,icons=0,title,description},provider,outputRoot,{normalize=false,sharpLoader}={}){
 const plan=makeGenerationPlan({slug,concept,style,wallpapers,icons});
 const generated=await runGeneration(plan,provider);
 const results=normalize?await Promise.all(generated.map(async ({task,bytes})=>({task,bytes:await normalizeImage(bytes,task,{sharpLoader})}))):generated;
 // Check every output before writing anything to disk.
 for(const {task,bytes} of results){
  if(bytes.length>40*1024*1024)throw Error("image exceeds 40 MB: "+task.id);
  const info=inspectImage(bytes,task.file.split(".").at(-1));
  if(info.width!==task.width||info.height!==task.height)throw Error("generated image dimensions mismatch: "+task.id);
 }
 const root=resolve(outputRoot),dir=join(root,plan.slug);
 await mkdir(join(dir,"assets"),{recursive:true});
 for(const {task,bytes} of results)await writeFile(join(dir,task.file),bytes,{flag:"w"});
 const product={
  slug:plan.slug,title:title||concept,description:description||("Mobile theme: "+concept),
  wallpapers:results.filter(x=>x.task.type!=="icon").map(x=>({file:x.task.file,width:x.task.width,height:x.task.height})),
  icons:results.filter(x=>x.task.type==="icon").map(x=>({file:x.task.file,width:x.task.width,height:x.task.height}))
 };
 await writeFile(join(dir,"product.json"),JSON.stringify(product,null,2)+"\n");
 const archive=join(root,plan.slug+".zip");
 const packed=await buildPackage(dir,archive);
 return {productDir:dir,archive,assets:packed.assets};
}
