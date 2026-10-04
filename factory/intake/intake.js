// Universal Intake v1: deterministic intake metadata, document classification, header mapping and confidence gating.
const EXTENSIONS = {
  spreadsheet: new Set(["xlsx","xls","csv","tsv"]),
  pdf: new Set(["pdf"]),
  image: new Set(["png","jpg","jpeg","webp"]),
  document: new Set(["doc","docx","txt"]),
  structured: new Set(["json","xml"]),
  archive: new Set(["zip"])
};

const FIELD_ALIASES = {
  order_id:["order id","order no","order number","주문번호","주문 번호","주문id"],
  invoice_id:["invoice id","invoice no","invoice number","invoice #","송장번호","청구서번호"],
  sku:["sku","item no","item number","item code","product code","상품코드","품목코드","제품코드","supplier ref"],
  description:["description","item description","product","product name","상품명","품목명","제품명"],
  quantity:["qty","quantity","order qty","ordered quantity","수량","주문수량"],
  unit_price:["unit price","price","sales price","판매가","단가"],
  unit_cost:["unit cost","cost","purchase price","supplier cost","supplier unit cost","공급가","매입가","원가"],
  total:["total","amount","line total","total amount","합계","금액","총액"],
  currency:["currency","통화","화폐"],
  date:["date","order date","invoice date","transaction date","일자","날짜","주문일","송장일"],
  supplier:["supplier","vendor","supplier name","vendor name","공급업체","공급사","거래처"],
  status:["status","order status","상태","주문상태"]
};

function clean(value){
  return String(value ?? "").trim().toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");
}
function extOf(name){
  const n=String(name||"").trim().toLowerCase();
  const i=n.lastIndexOf(".");
  return i<0?"":n.slice(i+1);
}
export function detectFileKind(name,mime=""){
  const ext=extOf(name); const m=clean(mime);
  for(const [kind,set] of Object.entries(EXTENSIONS)) if(set.has(ext)) return {kind,ext,supported:true,confidence:1};
  if(m.includes("spreadsheet")||m.includes("excel")||m.includes("csv")) return {kind:"spreadsheet",ext,supported:true,confidence:.9};
  if(m.includes("pdf")) return {kind:"pdf",ext,supported:true,confidence:.9};
  if(m.startsWith("image")) return {kind:"image",ext,supported:true,confidence:.9};
  if(m.includes("json")||m.includes("xml")) return {kind:"structured",ext,supported:true,confidence:.9};
  return {kind:"unknown",ext,supported:false,confidence:0};
}
export function classifyDocument({name="",text="",headers=[]}={}){
  const hay=clean([name,text,...headers].join(" "));
  const rules=[
    ["credit_note",["credit note","credit memo","대변전표"]],
    ["refund",["refund","refunded","refund amount","환불"]],
    ["price_list",["price list","pricing","unit cost","supplier cost","가격표","단가표","공급가"]],
    ["purchase_order",["purchase order","po number","po #","발주서","발주번호"]],
    ["invoice",["invoice","invoice number","amount due","송장","청구서"]],
    ["order",["order id","order number","order date","orders","order","주문번호","주문일","주문"]],
    ["inventory",["inventory","stock on hand","warehouse","재고","재고수량"]]
  ];
  let best={document_type:"unknown",confidence:0,evidence:[]};
  for(const [type,terms] of rules){
    const evidence=terms.filter(t=>hay.includes(clean(t)));
    const score=Math.min(.99,evidence.length*.24+(clean(name).includes(type.replace("_"," "))?.2:0));
    if(score>best.confidence || (score===best.confidence && best.document_type==="unknown")) best={document_type:type,confidence:Number(score.toFixed(2)),evidence};
  }
  return best;
}
export function mapHeaders(headers=[]){
  const used=new Set();
  const fields={}; const unmapped=[];
  for(const raw of headers){
    const h=clean(raw); let best=null;
    for(const [field,aliases] of Object.entries(FIELD_ALIASES)){
      if(used.has(field)) continue;
      for(const alias of aliases){
        const a=clean(alias);
        let score=h===a?1:(h.includes(a)||a.includes(h))?.82:0;
        if(score && (!best||score>best.confidence)) best={field,source_header:String(raw),confidence:score};
      }
    }
    if(best){ fields[best.field]=best; used.add(best.field); } else unmapped.push(String(raw));
  }
  const values=Object.values(fields);
  const confidence=values.length?values.reduce((s,x)=>s+x.confidence,0)/values.length:0;
  return {fields,unmapped_headers:unmapped,confidence:Number(confidence.toFixed(3))};
}
export function buildIntakePlan(file,{text="",headers=[]}={}){
  const fileInfo=detectFileKind(file?.name,file?.mime);
  const document=classifyDocument({name:file?.name,text,headers});
  const mapping=mapHeaders(headers);
  const issues=[];
  if(!fileInfo.supported) issues.push({code:"UNSUPPORTED_FILE",severity:"review"});
  if(document.confidence<.5) issues.push({code:"DOCUMENT_TYPE_LOW_CONFIDENCE",severity:"review"});
  if(headers.length && mapping.confidence<.7) issues.push({code:"FIELD_MAPPING_LOW_CONFIDENCE",severity:"review"});
  const confidence=Number(((fileInfo.confidence*.35)+(document.confidence*.25)+(headers.length?mapping.confidence*.4:.2)).toFixed(3));
  return {
    intake_version:"1.0",
    file:{name:String(file?.name||""),mime:String(file?.mime||""),...fileInfo},
    document,
    mapping,
    confidence,
    status:issues.length?"needs_review":"ready",
    issues
  };
}
export function normalizeRows(rows=[],mappingResult){
  const fields=mappingResult?.fields||{};
  const sourceHeaders=Object.keys(fields).map(field=>fields[field].source_header);
  return rows.map((row,index)=>{
    const out={_row:index+1};
    for(const [field,m] of Object.entries(fields)){
      if(Array.isArray(row)){
        const column=sourceHeaders.indexOf(m.source_header);
        out[field]=column>=0?(row[column] ?? null):null;
      }else out[field]=row?.[m.source_header] ?? null;
    }
    return out;
  });
}
