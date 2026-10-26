import {buildPackage} from "./zip.mjs";
const [input,output]=process.argv.slice(2);
if(!input||!output){console.error("Usage: node theme_factory/pack.mjs <product-dir> <output.zip>");process.exit(2)}
try{console.log(JSON.stringify(await buildPackage(input,output)))}catch(e){console.error(e.message);process.exitCode=1}
