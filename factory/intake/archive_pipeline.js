import { unzipEntries } from "./zip_reader.js";
import { capabilityFor } from "./capabilities.js";
import { ingestParsedFile } from "./parsers.js";
import { ingestXlsx } from "./xlsx_pipeline.js";
import { routePdf } from "./pdf_pipeline.js";
import { inspectImage } from "./image_pipeline.js";

export async function ingestArchive(input,{name="bundle.zip",maxDepth=2,depth=0}={}){
  if(depth>maxDepth) return {name,status:"needs_review",issues:["ARCHIVE_DEPTH_LIMIT"],files:[]};
  const entries=await unzipEntries(input);
  const files=[];
  for(const e of entries){
    if(e.directory) continue;
    const cap=capabilityFor(e.name);
    let result={status:"queued",capability:cap};
    const ext=String(e.name).toLowerCase().split(".").pop();
    try{
      if(["csv","tsv","json","xml","txt"].includes(ext)){
        const parsed=ingestParsedFile({name:e.name,mime:""},e.data);
        result={status:parsed.plan.status,capability:cap,result:parsed};
      }else if(ext==="xlsx"){
        const parsed=await ingestXlsx({name:e.name,mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},e.data);
        result={status:parsed.status,capability:cap,result:parsed};
      }else if(ext==="pdf"){
        result={status:"awaiting_extraction",capability:cap,route:routePdf(e.data)};
      }else if(["png","jpg","jpeg","webp"].includes(ext)){
        result={status:"awaiting_extraction",capability:cap,route:inspectImage(e.data,{name:e.name})};
      }else if(ext==="zip"){
        const nested=await ingestArchive(e.data,{name:e.name,maxDepth,depth:depth+1});
        result={status:nested.status,capability:cap,result:nested};
      }else result={status:"needs_review",capability:cap,issues:["ARCHIVE_ENTRY_UNSUPPORTED"]};
    }catch(error){
      result={status:"needs_review",capability:cap,issues:["ARCHIVE_ENTRY_ERROR"],error:String(error?.message||error)};
    }
    files.push({name:e.name,size:e.data.length,...result});
  }
  const review=files.filter(x=>x.status==="needs_review").length;
  const awaiting=files.filter(x=>x.status==="awaiting_extraction").length;
  return {name,status:review?"needs_review":awaiting?"awaiting_extraction":"ready",counts:{total:files.length,review,awaiting},files};
}
