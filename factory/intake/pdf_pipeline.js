import { buildIntakePlan, mapHeaders, normalizeRows } from "./intake.js";
import { validateExtraction } from "./extraction_adapter.js";

function ascii(bytes){
  const v=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  return new TextDecoder("latin1").decode(v);
}
export function inspectPdf(input){
  const raw=ascii(input);
  if(!raw.startsWith("%PDF-")) return {valid:false,mode:"invalid",reason:"PDF_SIGNATURE_MISSING"};
  const hasImages=/\/Subtype\s*\/Image\b/.test(raw);
  const hasTextOps=/\bBT\b[\s\S]{0,12000}\bET\b/.test(raw);
  const pageCount=Math.max(1,(raw.match(/\/Type\s*\/Page\b/g)||[]).length);
  return {valid:true,page_count:pageCount,has_images:hasImages,has_text_operators:hasTextOps,mode:hasTextOps?"text_extract":"ocr_required"};
}
export function routePdf(input){
  const inspection=inspectPdf(input);
  if(!inspection.valid) return {...inspection,adapter:"review"};
  return {...inspection,adapter:inspection.mode==="text_extract"?"pdf_text":"pdf_ocr"};
}
export function ingestPdfExtraction(file,extraction={}){
  const checked=validateExtraction(extraction);
  const tables=Array.isArray(extraction.tables)?extraction.tables:[];
  const first=tables.find(t=>Array.isArray(t?.headers)&&Array.isArray(t?.rows));
  const headers=first?.headers||[];
  const text=String(extraction.text||"");
  const plan=buildIntakePlan(file,{text,headers});
  const mapping=mapHeaders(headers);
  const normalized_rows=first?normalizeRows(first.rows,mapping):[];
  const issues=[...plan.issues];
  if(checked.needs_review) issues.push({code:"PDF_EXTRACTION_LOW_CONFIDENCE",severity:"review"});
  if(!text&&!headers.length) issues.push({code:"PDF_EXTRACTION_EMPTY",severity:"review"});
  return {extraction:checked,plan:{...plan,status:issues.length?"needs_review":"ready",issues},normalized_rows};
}
