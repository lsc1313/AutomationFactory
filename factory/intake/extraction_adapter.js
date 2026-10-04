// Binary extraction adapter contract.
// Workers should keep heavy OCR/PDF/image extraction outside the canonical mapper.
// An adapter returns extracted text and/or tables; the deterministic intake core handles classification/mapping/QC.
export function extractionRequest(file){
  const name=String(file?.name||"");
  const ext=name.toLowerCase().split(".").pop();
  if(["xlsx","xls"].includes(ext)) return {adapter:"spreadsheet_binary",needs_binary:true};
  if(ext==="pdf") return {adapter:"pdf_text_or_ocr",needs_binary:true};
  if(["png","jpg","jpeg","webp"].includes(ext)) return {adapter:"image_ocr",needs_binary:true};
  if(["doc","docx"].includes(ext)) return {adapter:"document_binary",needs_binary:true};
  if(ext==="zip") return {adapter:"archive_unpack",needs_binary:true};
  return {adapter:"native_text",needs_binary:false};
}
export function validateExtraction(result={}){
  const text=String(result.text||"").trim();
  const tables=Array.isArray(result.tables)?result.tables:[];
  const confidence=Number(result.confidence??0);
  const usable=Boolean(text||tables.length);
  return {usable,confidence:Number.isFinite(confidence)?confidence:0,needs_review:!usable||confidence<0.7};
}
