import { parseXlsx } from "./xlsx_reader.js";
import { buildIntakePlan, mapHeaders, normalizeRows } from "./intake.js";

export async function ingestXlsx(file,input){
  const workbook=await parseXlsx(input);
  const sheets=workbook.sheets.map(sheet=>{
    const mapping=mapHeaders(sheet.headers);
    const evidenceText=[sheet.headers.join(" "),...sheet.rows.slice(0,3).map(row=>Object.values(row).join(" "))].join(" ");
    const plan=buildIntakePlan({...file,name:`${file?.name||"workbook.xlsx"}#${sheet.name||"sheet"}`},{text:`${sheet.name||""} ${evidenceText}`,headers:sheet.headers});
    const normalized_rows=normalizeRows(sheet.rows,mapping);
    const issues=[...plan.issues];
    if(!sheet.headers.length) issues.push({code:"XLSX_HEADERS_MISSING",severity:"review"});
    if(!normalized_rows.length) issues.push({code:"XLSX_NO_DATA_ROWS",severity:"review"});
    return {...sheet,mapping,plan:{...plan,status:issues.length?"needs_review":"ready",issues},normalized_rows};
  });
  const review_count=sheets.filter(x=>x.plan.status==="needs_review").length;
  return {workbook:{sheet_count:sheets.length,issues:workbook.issues},sheets,status:review_count?"needs_review":"ready",review_count};
}
