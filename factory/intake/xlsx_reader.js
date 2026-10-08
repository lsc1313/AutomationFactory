import { unzipEntries } from "./zip_reader.js";
function decode(v){return new TextDecoder("utf-8",{fatal:false}).decode(v)}
function unescapeXml(s=""){return s.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&")}
function colIndex(ref="A1"){let n=0;for(const ch of ref.match(/[A-Z]+/i)?.[0]||"A")n=n*26+(ch.toUpperCase().charCodeAt(0)-64);return n-1}
function sharedStrings(xml=""){return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>unescapeXml([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join("")))}
function parseSheet(xml,shared){
  const rows=[];
  for(const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
    const arr=[];
    for(const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){
      const attrs=cm[1],body=cm[2],ref=(attrs.match(/\br="([^"]+)"/)||[])[1]||"A1",type=(attrs.match(/\bt="([^"]+)"/)||[])[1]||"";
      const vm=(body.match(/<v>([\s\S]*?)<\/v>/)||[])[1];
      const inline=(body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)||[])[1];
      let value=inline!==undefined?unescapeXml(inline):(vm??"");
      if(type==="s") value=shared[Number(value)]??value;
      else if(type==="b") value=value==="1";
      else if(type!=="str"&&type!=="inlineStr"&&value!==""&&!Number.isNaN(Number(value))) value=Number(value);
      arr[colIndex(ref)]=value;
    }
    rows.push(arr);
  }
  return rows;
}
export async function parseXlsx(input){
  const entries=await unzipEntries(input);
  const byName=new Map(entries.map(e=>[e.name,e]));
  const shared=byName.has("xl/sharedStrings.xml")?sharedStrings(decode(byName.get("xl/sharedStrings.xml").data)):[];
  const sheets=entries.filter(e=>/^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  const parsed=sheets.map((e,index)=>{
    const matrix=parseSheet(decode(e.data),shared);
    const headers=(matrix[0]||[]).map(v=>String(v??"").trim());
    const rows=matrix.slice(1).map(values=>{const row={};headers.forEach((h,i)=>{if(h)row[h]=values[i]??""});return row});
    return {sheet_index:index+1,path:e.name,headers,rows,row_count:rows.length};
  });
  return {sheets:parsed,issues:parsed.length?[]:["XLSX_NO_SHEETS"]};
}
