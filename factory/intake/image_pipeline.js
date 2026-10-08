import { buildIntakePlan, mapHeaders, normalizeRows } from "./intake.js";
import { validateExtraction } from "./extraction_adapter.js";

export function inspectImage(input,{name="",mime=""}={}){
  const v=input instanceof Uint8Array?input:new Uint8Array(input||0);
  const png=v.length>=8&&v[0]===0x89&&v[1]===0x50&&v[2]===0x4e&&v[3]===0x47;
  const jpg=v.length>=3&&v[0]===0xff&&v[1]===0xd8&&v[2]===0xff;
  const webp=v.length>=12&&String.fromCharCode(...v.slice(0,4))==="RIFF"&&String.fromCharCode(...v.slice(8,12))==="WEBP";
  const format=png?"png":jpg?"jpg":webp?"webp":"unknown";
  return {valid:format!=="unknown",format,name:String(name),mime:String(mime),adapter:format==="unknown"?"review":"image_ocr"};
}
export function ingestImageExtraction(file,extraction={}){
  const checked=validateExtraction(extraction);
  const tables=Array.isArray(extraction.tables)?extraction.tables:[];
  const first=tables.find(t=>Array.isArray(t?.headers)&&Array.isArray(t?.rows));
  const headers=first?.headers||[];
  const text=String(extraction.text||"");
  const mapping=mapHeaders(headers);
  const plan=buildIntakePlan(file,{text,headers});
  const normalized_rows=first?normalizeRows(first.rows,mapping):[];
  const issues=[...plan.issues];
  if(checked.needs_review) issues.push({code:"IMAGE_OCR_LOW_CONFIDENCE",severity:"review"});
  if(!text&&!headers.length) issues.push({code:"IMAGE_OCR_EMPTY",severity:"review"});
  return {extraction:checked,mapping,normalized_rows,plan:{...plan,status:issues.length?"needs_review":"ready",issues}};
}
