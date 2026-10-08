import { buildIntakePlan } from "./intake.js";
import { capabilityFor } from "./capabilities.js";

export function planBatch(files=[]){
  const planned=files.map((file,index)=>{
    const capability=capabilityFor(file?.name);
    const plan=buildIntakePlan(file);
    return {index,file_name:String(file?.name||""),capability,plan};
  });
  const counts=planned.reduce((a,x)=>{
    a.total++;
    a[x.capability.mode]=(a[x.capability.mode]||0)+1;
    return a;
  },{total:0,native:0,adapter:0,review:0});
  return {files:planned,counts,status:counts.review?"needs_review":"planned"};
}
export function flattenArchiveManifest(entries=[],parentName="bundle.zip"){
  return entries.filter(x=>x&&!x.directory).map((x,index)=>({
    archive:parentName,
    archive_index:index,
    name:String(x.name||""),
    size:Number(x.size||0),
    capability:capabilityFor(x.name)
  }));
}
export function relateDocuments(items=[]){
  const byKey=new Map();
  for(const item of items){
    const values=item?.normalized_rows||[];
    for(const row of values){
      for(const [kind,value] of [["order_id",row.order_id],["sku",row.sku],["invoice_id",row.invoice_id]]){
        const v=String(value??"").trim();
        if(!v) continue;
        const key=kind+":"+v;
        if(!byKey.has(key)) byKey.set(key,[]);
        byKey.get(key).push({file_name:item.file_name||"",row:row._row||null,document_type:item.document_type||"unknown"});
      }
    }
  }
  return [...byKey.entries()].filter(([,refs])=>refs.length>1).map(([key,refs])=>({key,refs}));
}
