import {ingestUploadedFiles} from "./upload.js";
import {runBatchSupplierScan} from "../scan/scan_pipeline.js";

function roleType(role){return role==="orders"?"order":role==="invoices"?"invoice":role==="priceList"?"price_list":""}
function pushUploadFile(out,f,overrides={},prefix=""){
 const name=prefix?prefix+"#"+f.name:f.name,forced=roleType(overrides[f.name]||overrides[name]);
 if(f.kind==="xlsx"){
  for(const s of f.sheets||[])out.push({file_name:name+"#"+s.name,document_type:forced||s.plan?.document?.document_type||"unknown",status:forced&&s.normalized_rows?.length?"ready":(s.plan?.status||f.status),normalized_rows:s.normalized_rows||[]});
  return;
 }
 if(f.kind==="text"){
  out.push({file_name:name,document_type:forced||f.result?.plan?.document?.document_type||"unknown",status:forced&&f.result?.normalized_rows?.length?"ready":(f.result?.plan?.status||f.status),normalized_rows:f.result?.normalized_rows||[]});
  return;
 }
 if(f.kind==="archive"||f.result?.files){
  const children=f.files||f.result?.files||[];
  for(const child of children){
   const wrapped=child.result?.result?{...child.result.result,name:child.name}:{...child,name:child.name};
   pushUploadFile(out,wrapped,overrides,name);
  }
  return;
 }
 out.push({file_name:name,document_type:forced||f.document_type||"unknown",status:f.status,normalized_rows:f.normalized_rows||[]});
}
export function flattenUploadForScan(upload,overrides={}){
 const out=[];for(const f of upload.files||[])pushUploadFile(out,f,overrides);return out;
}
export async function scanUploadedFiles(request,env=null){
 const form=await request.formData(),rolesRaw=String(form.get("roles")||"{}");let roles={};try{roles=JSON.parse(rolesRaw)}catch{return {ok:false,status:400,error:"invalid_roles"}}
 const clone=new FormData();for(const f of form.getAll("files"))clone.append("files",f);const upload=await ingestUploadedFiles(new Request("https://local/upload",{method:"POST",body:clone}),env);if(!upload.ok)return upload;
 const files=flattenUploadForScan(upload,roles),scan=runBatchSupplierScan(files,{scanMode:"free",currency:String(form.get("currency")||"UNSPECIFIED")});return {ok:true,status:200,upload_summary:upload.summary,scan};
}
