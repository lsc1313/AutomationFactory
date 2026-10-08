import {tableFromTsvWords} from "./table_geometry.js";
import {unzipEntries} from "../intake/zip_reader.js";
import {spawn} from "node:child_process";import {mkdtemp,writeFile,readFile,rm,readdir} from "node:fs/promises";import {tmpdir} from "node:os";import {join} from "node:path";
const ext=n=>String(n||"").toLowerCase().split(".").pop();
function run(cmd,args){return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{windowsHide:true});let err="";p.stderr.on("data",d=>err+=d);p.on("error",reject);p.on("close",code=>code===0?resolve():reject(new Error(err||cmd+" exit "+code)))})}
async function commandAvailable(cmd){try{await run(cmd,["-v"]);return true}catch{try{await run(cmd,["--version"]);return true}catch{return false}}}
export async function popplerAvailable(){return (await commandAvailable(process.env.PDFTOTEXT_CMD||"pdftotext"))&&(await commandAvailable(process.env.PDFTOPPM_CMD||"pdftoppm"))}
export async function tesseractAvailable(){try{await run(process.env.TESSERACT_CMD||"tesseract",["--version"]);return true}catch{return false}}
async function ocrImage(bytes,e){const dir=await mkdtemp(join(tmpdir(),"factory-ocr-")),input=join(dir,"input."+e),out=join(dir,"out");try{await writeFile(input,bytes);await run(process.env.TESSERACT_CMD||"tesseract",[input,out,"-l",process.env.TESSERACT_LANG||"eng+kor","--psm",process.env.TESSERACT_PSM||"6","tsv"]);const tsv=await readFile(out+".tsv","utf8");const lines=tsv.trim().split(/\r?\n/),h=lines.shift()?.split("\t")||[];const rows=lines.map(l=>Object.fromEntries(h.map((k,i)=>[k,l.split("\t")[i]||""])));const words=rows.filter(r=>r.text&&Number(r.conf)>=0),text=words.map(r=>r.text).join(" "),confidence=words.length?words.reduce((a,r)=>a+Number(r.conf),0)/words.length/100:0;const table=tableFromTsvWords(words);return {text,confidence,headers:table?.headers||[],rows:table?.rows||[],tables:table?[table]:[],engine:"tesseract",language:process.env.TESSERACT_LANG||"eng+kor"}}finally{await rm(dir,{recursive:true,force:true})}}
export async function extractDocument({name,bytes,mode}){
 const e=ext(name);
 if(e==="zip"){
  let entries;try{entries=await unzipEntries(bytes,{maxEntries:100,maxUncompressedBytes:20*1024*1024})}catch(error){return {error:String(error?.message||error),needs_review:true}}
  const extracted=[];let skipped=0;
  for(const entry of entries){
   if(entry.directory)continue;
   const ee=ext(entry.name);
   if(["pdf","png","jpg","jpeg","webp"].includes(ee)){
    const result=await extractDocument({name:entry.name,bytes:entry.data,mode:ee==="pdf"?"pdf_text_or_ocr":"image_ocr"});
    extracted.push({name:entry.name,size:entry.data.length,result});
   }else skipped++;
  }
  return {engine:"zip+local-extractor",archive:true,files:extracted,counts:{entries:entries.filter(x=>!x.directory).length,extracted:extracted.length,skipped}};
 }if(mode==="text"&&e==="txt")return {text:new TextDecoder().decode(bytes),confidence:1,headers:[],rows:[],engine:"native"};
 if(["png","jpg","jpeg","webp"].includes(e)){if(!await tesseractAvailable())return {error:"TESSERACT_NOT_INSTALLED",needs_setup:true};return await ocrImage(bytes,e)}
 if(e==="pdf"){
  if(!await popplerAvailable())return {error:"POPPLER_NOT_INSTALLED",needs_setup:true};
  const dir=await mkdtemp(join(tmpdir(),"factory-pdf-")),input=join(dir,"input.pdf");
  try{await writeFile(input,bytes);const txt=join(dir,"text.txt");await run(process.env.PDFTOTEXT_CMD||"pdftotext",["-layout",input,txt]);const text=(await readFile(txt,"utf8").catch(()=>"")).trim();
   if(text.length>=Number(process.env.PDF_TEXT_MIN_CHARS||80))return {text,confidence:.98,headers:[],rows:[],engine:"pdftotext"};
   if(!await tesseractAvailable())return {error:"TESSERACT_NOT_INSTALLED",needs_setup:true,recommended:"Scanned PDF requires OCR."};
   const prefix=join(dir,"page");await run(process.env.PDFTOPPM_CMD||"pdftoppm",["-png","-r",process.env.PDF_DPI||"200",input,prefix]);
   const pages=(await readdir(dir)).filter(n=>/^page-.*\.png$/i.test(n)).sort();if(!pages.length)return {error:"PDF_RASTERIZE_EMPTY"};
   let texts=[],scores=[],tables=[];for(const p of pages.slice(0,Number(process.env.PDF_MAX_PAGES||30))){const b=new Uint8Array(await readFile(join(dir,p))),r=await ocrImage(b,"png");texts.push(r.text);scores.push(r.confidence);if(r.tables?.length)tables.push(...r.tables)}
   return {text:texts.join("\n\n"),confidence:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0,headers:tables[0]?.headers||[],rows:tables[0]?.rows||[],tables,engine:"pdftoppm+tesseract",pages:pages.length};
  }finally{await rm(dir,{recursive:true,force:true})}
 }
 return {error:"LOCAL_EXTRACTOR_UNSUPPORTED",needs_setup:true};
}
