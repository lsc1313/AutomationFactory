const SIZES={wallpaper:{width:1440,height:3200},lockscreen:{width:1440,height:3200},icon:{width:1024,height:1024}};
export function makeGenerationPlan({slug,concept,style="premium dark fantasy",wallpapers=3,icons=0}){
 if(typeof slug!=="string"||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug))throw Error("invalid slug");
 if(typeof concept!=="string"||!concept.trim()||concept.length>300)throw Error("invalid concept");
 if(!Number.isInteger(wallpapers)||wallpapers<1||wallpapers>12||!Number.isInteger(icons)||icons<0||icons>40)throw Error("invalid asset counts");
 const base="Cohesive premium mobile theme, "+concept.trim()+", "+style+". Consistent color palette, high detail, no words, no logos, no watermark.";
 const tasks=[];
 for(let i=0;i<wallpapers;i++)tasks.push({id:"wallpaper-"+String(i+1).padStart(2,"0"),type:"wallpaper",file:"assets/wallpaper-"+String(i+1).padStart(2,"0")+".png",...SIZES.wallpaper,prompt:base+" Vertical phone wallpaper composition, variation "+(i+1)+", clear focal point."});
 tasks.push({id:"lockscreen",type:"lockscreen",file:"assets/lockscreen.png",...SIZES.lockscreen,prompt:base+" Vertical lock screen composition, leave top clock area visually uncluttered."});
 for(let i=0;i<icons;i++)tasks.push({id:"icon-"+String(i+1).padStart(2,"0"),type:"icon",file:"assets/icon-"+String(i+1).padStart(2,"0")+".png",...SIZES.icon,prompt:base+" Single centered mobile app icon, strong silhouette, variation "+(i+1)+"."});
 return {slug,concept:concept.trim(),style,tasks,estimatedApiCostCents:null,requiresApprovalForPaidProvider:true};
}
export function validateProviderConfig(config){
 if(!config||typeof config!=="object")throw Error("provider config required");
 if(config.costCents!==0)throw Error("zero-cost mode rejects paid providers");
 if(typeof config.generate!=="function")throw Error("provider must implement generate");
 return config;
}
export async function runGeneration(plan,provider,{maxAttempts=3}={}){
 validateProviderConfig(provider);
 if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw Error("invalid retry limit");
 const results=[];
 for(const task of plan.tasks){
  let output=null,lastError;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
   try{output=await provider.generate(task);if(!output||!Buffer.isBuffer(output.bytes)||!output.bytes.length)throw Error("empty image");break}
   catch(error){lastError=error}
  }
  if(!output)throw Error("generation failed for "+task.id+": "+lastError?.message);
  results.push({task,bytes:output.bytes});
 }
 return results;
}
