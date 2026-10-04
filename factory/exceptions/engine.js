function n(v){const x=Number(v);return Number.isFinite(x)?x:0}
function key(r){return [r.order_id||"",r.sku||""].join("::")}
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
  if(seen.has(fingerprint)){
   out.push(ex("DUPLICATE_BILLING",inv,{expected:"single charge",actual:"duplicate charge",difference:n(inv.total)||n(inv.quantity)*n(inv.unit_cost||inv.unit_price),reason:"same invoice/order/SKU/amount fingerprint repeated",evidence:[seen.get(fingerprint),fingerprint],confidence:1}));
  }else seen.set(fingerprint,fingerprint);
  if(ord){
   if(String(ord.status||"").toLowerCase().match(/cancel|취소/)){
    out.push(ex("CANCELLED_ORDER_BILLED",inv,{expected:0,actual:n(inv.total)||n(inv.quantity)*n(inv.unit_cost||inv.unit_price),difference:n(inv.total)||n(inv.quantity)*n(inv.unit_cost||inv.unit_price),reason:"supplier billed a cancelled order",evidence:[k],confidence:1}));
   }
   if(inv.quantity!=null&&ord.quantity!=null&&Math.abs(n(inv.quantity)-n(ord.quantity))>tolerance){
    out.push(ex("QUANTITY_MISMATCH",inv,{expected:n(ord.quantity),actual:n(inv.quantity),difference:n(inv.quantity)-n(ord.quantity),reason:"invoice quantity differs from order quantity",evidence:[k],confidence:1}));
   }
  }
  const expectedCost=price?.unit_cost??ord?.unit_cost;
  const actualCost=inv.unit_cost??inv.unit_price;
  if(expectedCost!=null&&actualCost!=null&&n(actualCost)-n(expectedCost)>tolerance){
   const qty=Math.max(1,n(inv.quantity)||1),delta=(n(actualCost)-n(expectedCost))*qty;
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
