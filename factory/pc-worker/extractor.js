import {spawn} from "node:child_process";import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";import {tmpdir} from "node:os";import {join} from "node:path";
const ext=n=>String(n||"").toLowerCase().split(".").pop();
function run(cmd,args){return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{windowsHide:true});let err="";p.stderr.on("data",d=>err+=d);p.on("error",reject);p.on("close",code=>code===0?resolve():reject(new Error(err||cmd+" exit "+code)))})}
export async function tesseractAvailable(){try{await run(process.env.TESSERACT_CMD||"tesseract",["--version"]);return true}catch{return false}}
async function ocrImage(bytes,e){const dir=await mkdtemp(join(tmpdir(),"factory-ocr-")),input=join(dir,"input."+e),out=join(dir,"out");try{await writeFile(input,bytes);await run(process.env.TESSERACT_CMD||"tesseract",[input,out,"-l",process.env.TESSERACT_LANG||"eng+kor","--psm",process.env.TESSERACT_PSM||"6","tsv"]);const tsv=await readFile(out+".tsv","utf8");const lines=tsv.trim().split(/\r?\n/),h=lines.shift()?.split("\t")||[];const rows=lines.map(l=>Object.fromEntries(h.map((k,i)=>[k,l.split("\t")[i]||""])));const words=rows.filter(r=>r.text&&Number(r.conf)>=0),text=words.map(r=>r.text).join(" "),confidence=words.length?words.reduce((a,r)=>a+Number(r.conf),0)/words.length/100:0;return {text,confidence,headers:[],rows:[],engine:"tesseract",language:process.env.TESSERACT_LANG||"eng+kor"}}finally{await rm(dir,{recursive:true,force:true})}}
export async function extractDocument({name,bytes,mode}){
 const e=ext(name);if(mode==="text"&&e==="txt")return {text:new TextDecoder().decode(bytes),confidence:1,headers:[],rows:[],engine:"native"};
 if(["png","jpg","jpeg","webp"].includes(e)){if(!await tesseractAvailable())return {error:"TESSERACT_NOT_INSTALLED",needs_setup:true};return await ocrImage(bytes,e)}
 if(e==="pdf")return {error:mode==="text"?"PDF_TEXT_EXTRACTOR_NOT_CONFIGURED":"PDF_RASTERIZER_NOT_CONFIGURED",needs_setup:true,recommended:"PDF pages must be extracted/rasterized before OCR."};
 return {error:"LOCAL_EXTRACTOR_UNSUPPORTED",needs_setup:true};
}
