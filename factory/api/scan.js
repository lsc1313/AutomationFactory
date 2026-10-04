import {ingestUploadedFiles} from "./upload.js";import {runBatchSupplierScan} from "../scan/scan_pipeline.js";
function roleType(role){return role==="orders"?"order":role==="invoices"?"invoice":role==="priceList"?"price_list":""}
function flatten(upload,overrides={}){
 const out=[];for(const f of upload.files||[]){const forced=roleType(overrides[f.name]);
  if(f.kind==="xlsx"){for(const s of f.sheets||[])out.push({file_name:f.name+"#"+s.name,document_type:forced||s.plan?.document?.document_type||"unknown",status:s.plan?.status||f.status,normalized_rows:s.normalized_rows||[]})}
  else if(f.kind==="text"){out.push({file_name:f.name,document_type:forced||f.result?.plan?.document?.document_type||"unknown",status:f.result?.plan?.status||f.status,normalized_rows:f.result?.normalized_rows||[]})}
  else out.push({file_name:f.name,document_type:forced||f.document_type||"unknown",status:f.status,normalized_rows:f.normalized_rows||[]});
 }return out;
}
export async function scanUploadedFiles(request){
 const form=await request.formData(),rolesRaw=String(form.get("roles")||"{}");let roles={};try{roles=JSON.parse(rolesRaw)}catch{return {ok:false,status:400,error:"invalid_roles"}}
 const clone=new FormData();for(const f of form.getAll("files"))clone.append("files",f);const upload=await ingestUploadedFiles(new Request("https://local/upload",{method:"POST",body:clone}));if(!upload.ok)return upload;
 const files=flatten(upload,roles),scan=runBatchSupplierScan(files,{scanMode:"free",currency:String(form.get("currency")||"UNSPECIFIED")});return {ok:true,status:200,upload_summary:upload.summary,scan};
}
