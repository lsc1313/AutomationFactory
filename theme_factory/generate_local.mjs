import {createLocalCommandProvider} from "./local_provider.mjs";
import {produceTheme} from "./produce.mjs";
const [slug,concept,modelDir,outputDir="./theme-output"]=process.argv.slice(2);
if(!slug||!concept||!modelDir){
 console.error("Usage: node theme_factory/generate_local.mjs <slug> <concept> <local-model-dir> [output-dir]");
 process.exit(2);
}
process.env.THEME_MODEL_PATH=modelDir;
const provider=createLocalCommandProvider({
 command:process.env.THEME_PYTHON||"python",
 args:["theme_factory/adapters/diffusers_local.py"],
 timeoutMs:600000
});
try{
 const result=await produceTheme({slug,concept,wallpapers:1,icons:0},provider,outputDir);
 console.log(JSON.stringify(result,null,2));
}catch(err){console.error(err.message);process.exitCode=1}
