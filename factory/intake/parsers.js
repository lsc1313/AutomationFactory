import { buildIntakePlan, mapHeaders, normalizeRows } from "./intake.js";

function decode(bytes){
  if(typeof bytes==="string") return bytes;
  if(bytes instanceof Uint8Array) return new TextDecoder("utf-8",{fatal:false}).decode(bytes);
  if(bytes instanceof ArrayBuffer) return new TextDecoder("utf-8",{fatal:false}).decode(new Uint8Array(bytes));
  return String(bytes??"");
}
function delimiterOf(text,name=""){
  if(String(name).toLowerCase().endsWith(".tsv")) return "\t";
  const line=String(text).split(/\r?\n/).find(x=>x.trim())||"";
  const candidates=[",","\t",";","|"].map(d=>({d,n:line.split(d).length-1}));
  candidates.sort((a,b)=>b.n-a.n);
  return candidates[0].n>0?candidates[0].d:",";
}
function splitDelimitedLine(line,delimiter){
  const out=[]; let cur=""; let quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(quoted&&line[i+1]==='"'){cur+='"';i++;} else quoted=!quoted;
    } else if(ch===delimiter&&!quoted){out.push(cur.trim());cur="";}
    else cur+=ch;
  }
  out.push(cur.trim()); return out;
}
export function parseDelimited(input,{name=""}={}){
  const text=decode(input).replace(/^\uFEFF/,"");
  const delimiter=delimiterOf(text,name);
  const lines=text.split(/\r?\n/).filter(x=>x.trim());
  if(!lines.length) return {headers:[],rows:[],delimiter,issues:["EMPTY_FILE"]};
  const headers=splitDelimitedLine(lines[0],delimiter);
  const rows=lines.slice(1).map(line=>{
    const values=splitDelimitedLine(line,delimiter); const row={};
    headers.forEach((h,i)=>row[h]=values[i]??""); return row;
  });
  return {headers,rows,delimiter,issues:[]};
}
export function parseJson(input){
  const value=JSON.parse(decode(input));
  const rows=Array.isArray(value)?value:Array.isArray(value?.rows)?value.rows:[value];
  const objects=rows.filter(x=>x&&typeof x==="object"&&!Array.isArray(x));
  const headers=[...new Set(objects.flatMap(x=>Object.keys(x)))];
  return {headers,rows:objects,issues:objects.length?[]:["NO_OBJECT_ROWS"]};
}
export function parseXmlFlat(input){
  const text=decode(input);
  const records=[...text.matchAll(/<(row|item|record|order|invoice)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  const rows=records.map(match=>{
    const row={};
    for(const f of match[2].matchAll(/<([A-Za-z0-9_:-]+)\b[^>]*>([^<]*)<\/\1>/g)) row[f[1]]=f[2].trim();
    return row;
  }).filter(x=>Object.keys(x).length);
  const headers=[...new Set(rows.flatMap(x=>Object.keys(x)))];
  return {headers,rows,issues:rows.length?[]:["XML_STRUCTURE_REVIEW"]};
}
export function parsePlainText(input){
  const text=decode(input);
  const pairs={};
  for(const line of text.split(/\r?\n/)){
    const m=line.match(/^\s*([^:=]{2,80})\s*[:=]\s*(.+?)\s*$/);
    if(m) pairs[m[1].trim()]=m[2].trim();
  }
  const rows=Object.keys(pairs).length?[pairs]:[];
  return {text,headers:Object.keys(pairs),rows,issues:rows.length?[]:["TEXT_STRUCTURE_REVIEW"]};
}
export function parseExtractedTable({headers=[],rows=[]}={}){
  return {headers:[...headers],rows:[...rows],issues:headers.length?[]:["TABLE_HEADERS_MISSING"]};
}
export function ingestParsedFile(file,input,{extractedText="",extractedTable=null}={}){
  const ext=String(file?.name||"").toLowerCase().split(".").pop();
  let parsed;
  if(ext==="csv"||ext==="tsv") parsed=parseDelimited(input,{name:file.name});
  else if(ext==="json") parsed=parseJson(input);
  else if(ext==="xml") parsed=parseXmlFlat(input);
  else if(ext==="txt") parsed=parsePlainText(input);
  else if(extractedTable) parsed=parseExtractedTable(extractedTable);
  else return {plan:buildIntakePlan(file,{text:extractedText}),parsed:null,normalized_rows:[],adapter_required:true};
  const text=extractedText||parsed.text||"";
  const plan=buildIntakePlan(file,{text,headers:parsed.headers});
  const mapping=mapHeaders(parsed.headers);
  return {plan,parsed,normalized_rows:normalizeRows(parsed.rows,mapping),adapter_required:false};
}
