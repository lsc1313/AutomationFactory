import {ingestXlsx} from "../intake/xlsx_pipeline.js";
import {ingestArchive} from "../intake/archive_pipeline.js";
import {routePdf} from "../intake/pdf_pipeline.js";
import {inspectImage} from "../intake/image_pipeline.js";
import {ingestParsedFile} from "../intake/parsers.js";
const MAX_FILE_BYTES=8*1024*1024,MAX_FILES=12;
function ext(n){return String(n||"").toLowerCase().split(".").pop()}
function compactXlsx(r){return {status:r.status,workbook:r.workbook,sheets:r.sheets.map(s=>({name:s.name,headers:s.headers,mapping:s.mapping,plan:s.plan,normalized_rows:s.normalized_rows.slice(0,2000),row_count:s.normalized_rows.length}))}}
export async function ingestUploadedFiles(request){
 const form=await request.formData();const files=form.getAll("files").filter(x=>x&&typeof x.arrayBuffer==="function");
 if(!files.length)return {ok:false,status:400,error:"files_required"};if(files.length>MAX_FILES)return {ok:false,status:413,error:"too_many_files",max_files:MAX_FILES};
 const results=[];
 for(const file of files){if(file.size>MAX_FILE_BYTES){results.push({name:file.name,size:file.size,status:"needs_review",issues:["FILE_TOO_LARGE"]});continue}
  const bytes=new Uint8Array(await file.arrayBuffer()),e=ext(file.name);
  try{
   if(e==="xlsx")results.push({name:file.name,size:file.size,kind:"xlsx",...(compactXlsx(await ingestXlsx({name:file.name,mime:file.type},bytes)))});
   else if(e==="zip"){const r=await ingestArchive(bytes,{name:file.name});results.push({name:file.name,size:file.size,kind:"archive",...r})}
   else if(e==="pdf"){const route=routePdf(bytes);results.push({name:file.name,size:file.size,kind:"pdf",status:route.valid?"awaiting_extraction":"needs_review",route})}
   else if(["png","jpg","jpeg","webp"].includes(e)){const route=inspectImage(bytes,{name:file.name});results.push({name:file.name,size:file.size,kind:"image",status:route.valid?"awaiting_extraction":"needs_review",route})}
   else if(["csv","tsv","json","xml","txt"].includes(e)){const r=ingestParsedFile({name:file.name,mime:file.type},bytes);results.push({name:file.name,size:file.size,kind:"text",status:r.plan.status,result:r})}
   else results.push({name:file.name,size:file.size,status:"needs_review",issues:["UNSUPPORTED_UPLOAD_TYPE"]});
  }catch(error){results.push({name:file.name,size:file.size,status:"needs_review",issues:["UPLOAD_INGEST_ERROR"],error:String(error?.message||error)})}
 }
 const review=results.filter(x=>x.status==="needs_review").length,awaiting=results.filter(x=>x.status==="awaiting_extraction").length,ready=results.filter(x=>x.status==="ready").length;
 return {ok:true,status:200,summary:{total:results.length,ready,awaiting_extraction:awaiting,needs_review:review},files:results};
}
