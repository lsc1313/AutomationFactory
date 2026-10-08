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
  order_id:["order id","order no","order number","order #","ord no","ord #","주문번호","주문 번호","주문id","주문 no","오더번호","오더 no"],
  invoice_id:["invoice id","invoice no","invoice number","invoice #","inv no","inv #","bill no","송장번호","청구서번호","인보이스번호","전표번호"],
  sku:["sku","item no","item number","item code","product code","product sku","vendor sku","supplier sku","part no","model no","상품코드","품목코드","제품코드","상품번호","품번","모델번호","공급사코드","supplier ref"],
  description:["description","item description","product","product name","상품명","품목명","제품명"],
  quantity:["qty","quantity","order qty","ordered quantity","ordered qty","units","pcs","수량","주문수량","주문 수량","발주수량","청구수량","개수","수량 ea"],
  unit_price:["unit price","price","sales price","sale price","selling price","판매가","판매단가","판매 단가","단가"],
  unit_cost:["unit cost","cost","purchase price","purchase unit price","supplier cost","supplier unit cost","vendor cost","buy price","공급가","공급단가","공급 단가","매입가","매입단가","원가","원가단가"],
  total:["total","amount","line total","total amount","extended amount","net amount","합계","금액","총액","청구금액","공급금액","결제금액"],
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
  const fileName=clean(name);
  const strongNameRules=[
    ["invoice",["supplier invoice","invoice","청구서","송장"]],
    ["price_list",["supplier price list","price list","pricing","가격표","단가표"]],
    ["purchase_order",["purchase order","발주서"]],
    ["credit_note",["credit note","credit memo","대변전표"]],
    ["refund",["refund","환불"]]
  ];
  for(const [type,terms] of strongNameRules){
    const evidence=terms.filter(t=>fileName.includes(clean(t)));
    if(evidence.length) return {document_type:type,confidence:.99,evidence:evidence.map(x=>"filename:"+x)};
  }
  const hs=headers.map(clean),has=(...terms)=>terms.some(t=>hs.some(h=>h===clean(t)));
  if(has("invoice id","invoice no","invoice number","invoice #","송장번호","청구서번호")&&has("total","amount","line total","total amount","합계","금액","총액")) return {document_type:"invoice",confidence:.96,evidence:["header:invoice_id","header:total"]};
  if(has("sku","item code","product code","상품코드","품목코드")&&has("supplier cost","supplier unit cost","unit cost","purchase price","공급가","매입가","원가")&&!has("order id","order no","order number","주문번호")) return {document_type:"price_list",confidence:.94,evidence:["header:sku","header:unit_cost","header:no_order_id"]};
  if(has("order id","order no","order number","주문번호")&&(has("status","order status","상태","주문상태")||has("unit price","sales price","판매가"))) return {document_type:"order",confidence:.94,evidence:["header:order_id","header:order_fields"]};
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
