export function numericValue(v,{accountingNegative=true}={}){
 if(typeof v==="number")return Number.isFinite(v)?v:0;
 let s=String(v??"").trim();if(!s)return 0;
 const parenthesized=/^\(.*\)$/.test(s);if(parenthesized)s=s.slice(1,-1);const negative=accountingNegative&&parenthesized;
 s=s.replace(/[₩$€£¥]/g,"").replace(/\s+/g,"").replace(/,/g,"").replace(/[^0-9.+-]/g,"");
 const x=Number(s);return Number.isFinite(x)?(negative?-Math.abs(x):x):0;
}
function n(v){return numericValue(v)}
function q(v){return numericValue(v,{accountingNegative:false})}
function key(r){return [r.order_id||"",r.sku||""].join("::")}
export function nonBillableStatus(v){
 const s=String(v??"").trim().toLowerCase().replace(/[ _-]+/g," ");
 if(!s)return false;
 if(/partial|partially|부분|일부/.test(s))return false;
 return /cancelled|canceled|cancel|voided|void|refunded|refund complete|fully refunded|returned|return complete|취소|환불완료|전액환불|반품완료/.test(s);
}
function ex(type,row,{expected=null,actual=null,difference=null,reason="",evidence=[],confidence=1}={}){
 return {type,order_id:row.order_id||"",sku:row.sku||"",expected,actual,difference,reason,evidence,confidence,severity:Math.abs(n(difference))>0?"money":"review"};
}
export function detectExceptions({orders=[],invoices=[],priceList=[]}={},opts={}){
 const tolerance=n(opts.tolerance??0.01),out=[];
 const ordersByKey=new Map(orders.map(r=>[key(r),r]));
 const priceBySku=new Map(priceList.filter(r=>r.sku).map(r=>[String(r.sku),r]));
 const seen=new Map();
 for(const inv of invoices){
  const k=key(inv),ord=ordersByKey.get(k),price=priceBySku.get(String(inv.sku||""));
  const fingerprint=[inv.invoice_id||"",inv.order_id||"",inv.sku||"",inv.quantity??"",inv.unit_cost??inv.unit_price??"",inv.total??""].join("|");
  const economicFingerprint=[inv.order_id||"",inv.sku||"",q(inv.quantity),n(inv.unit_cost??inv.unit_price),n(inv.total)||q(inv.quantity)*n(inv.unit_cost??inv.unit_price)].join("|");
  if(seen.has(fingerprint)){
   out.push(ex("DUPLICATE_BILLING",inv,{expected:"single charge",actual:"duplicate charge",difference:n(inv.total)||n(inv.quantity)*n(inv.unit_cost||inv.unit_price),reason:"same invoice/order/SKU/amount fingerprint repeated",evidence:[seen.get(fingerprint),fingerprint],confidence:1}));
  }else seen.set(fingerprint,fingerprint);
  const economicKey="economic:"+economicFingerprint;
  if(!seen.has(fingerprint)&&seen.has(economicKey)){
   out.push(ex("POSSIBLE_DUPLICATE_BILLING",inv,{expected:"single charge",actual:"same order/SKU/qty/amount on another invoice",difference:0,reason:"same economic charge repeated with a different invoice identity",evidence:[seen.get(economicKey),economicFingerprint],confidence:.85}));
  }
  if(!seen.has(economicKey))seen.set(economicKey,inv.invoice_id||economicFingerprint);
  if(ord){
   if(nonBillableStatus(ord.status)){
    out.push(ex("CANCELLED_ORDER_BILLED",inv,{expected:0,actual:n(inv.total)||n(inv.quantity)*n(inv.unit_cost||inv.unit_price),difference:n(inv.total)||n(inv.quantity)*n(inv.unit_cost||inv.unit_price),reason:"supplier billed an order marked cancelled/void/refunded/returned",evidence:[k],confidence:1}));
   }
   if(inv.quantity!=null&&ord.quantity!=null&&Math.abs(q(inv.quantity)-q(ord.quantity))>tolerance){
    out.push(ex("QUANTITY_MISMATCH",inv,{expected:q(ord.quantity),actual:q(inv.quantity),difference:q(inv.quantity)-q(ord.quantity),reason:"invoice quantity differs from order quantity",evidence:[k],confidence:1}));
   }
  }
  const expectedCost=price?.unit_cost??ord?.unit_cost;
  const actualCost=inv.unit_cost??inv.unit_price;
  if(expectedCost!=null&&actualCost!=null&&n(actualCost)-n(expectedCost)>tolerance){
   const qty=Math.max(1,q(inv.quantity)||1),delta=(n(actualCost)-n(expectedCost))*qty;
   out.push(ex("OVERCHARGE",inv,{expected:n(expectedCost),actual:n(actualCost),difference:delta,reason:"invoiced unit cost exceeds expected unit cost",evidence:[String(inv.sku||"")],confidence:1}));
  }
  if(price?.unit_cost!=null&&ord?.unit_cost!=null&&Math.abs(n(price.unit_cost)-n(ord.unit_cost))>tolerance){
   out.push(ex("SUPPLIER_COST_CHANGED",inv,{expected:n(ord.unit_cost),actual:n(price.unit_cost),difference:n(price.unit_cost)-n(ord.unit_cost),reason:"current supplier price differs from order baseline",evidence:[String(inv.sku||"")],confidence:1}));
  }
 }
 return out;
}
export function summarizeExceptions(exceptions=[]){
 const by_type={};let money_exposure=0;
 for(const e of exceptions){by_type[e.type]=(by_type[e.type]||0)+1;if(["OVERCHARGE","DUPLICATE_BILLING","CANCELLED_ORDER_BILLED"].includes(e.type))money_exposure+=Math.max(0,n(e.difference))}
 return {exception_count:exceptions.length,money_exposure:Number(money_exposure.toFixed(2)),by_type};
}
