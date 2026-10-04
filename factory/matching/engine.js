function norm(v){return String(v??"").trim().toLowerCase().replace(/[\s_\-./]+/g,"")}
function tokens(v){return new Set(String(v??"").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))}
function similarity(a,b){
 const A=norm(a),B=norm(b);if(!A||!B)return 0;if(A===B)return 1;
 const ta=tokens(a),tb=tokens(b);if(!ta.size||!tb.size)return 0;
 let hit=0;for(const x of ta)if(tb.has(x))hit++;
 return hit/Math.max(ta.size,tb.size);
}
function exactKey(r){return [norm(r.order_id),norm(r.sku)].join("::")}
function ocrKey(v){return norm(v).replace(/[o0]/g,"0").replace(/[il1]/g,"1")}
function ocrConfusableSku(a,b){const A=norm(a),B=norm(b);return !!A&&!!B&&A!==B&&ocrKey(A)===ocrKey(B)}
export function matchRecord(source,targets,{confirmedMappings={},candidateThreshold=.55}={}){
 const key=exactKey(source);
 if(norm(source.order_id)&&norm(source.sku)){
  const exact=targets.filter(t=>exactKey(t)===key);
  if(exact.length===1)return {status:"confirmed",method:"exact_order_sku",confidence:1,target:exact[0],candidates:[]};
  const oid=norm(source.order_id),ocr=targets.filter(t=>norm(t.order_id)===oid&&ocrConfusableSku(source.sku,t.sku));if(ocr.length===1)return {status:"confirmed",method:"exact_order_id_ocr_confusable_sku",confidence:.99,target:ocr[0],candidates:[]};
 }
 const sourceSku=norm(source.sku);
 if(sourceSku&&confirmedMappings[sourceSku]){
  const mapped=norm(confirmedMappings[sourceSku]);
  const hit=targets.filter(t=>norm(t.sku)===mapped);
  if(hit.length===1)return {status:"confirmed",method:"confirmed_mapping",confidence:1,target:hit[0],candidates:[]};
 }
 if(norm(source.order_id)){
  const orderHits=targets.filter(t=>norm(t.order_id)===norm(source.order_id));
  if(orderHits.length===1&&(!source.sku||!orderHits[0].sku))return {status:"confirmed",method:"exact_order_id",confidence:1,target:orderHits[0],candidates:[]};
 }
 const scored=targets.map(t=>{
  const skuScore=similarity(source.sku,t.sku);
  const descScore=similarity(source.description,t.description);
  const orderScore=source.order_id&&t.order_id&&norm(source.order_id)===norm(t.order_id)?1:0;
  const score=Math.max(skuScore*.75+descScore*.25,orderScore*.6+skuScore*.4,descScore*.7);
  return {target:t,confidence:Number(score.toFixed(4)),reasons:{sku:skuScore,description:descScore,order:orderScore}};
 }).filter(x=>x.confidence>=candidateThreshold).sort((a,b)=>b.confidence-a.confidence).slice(0,5);
 return {status:scored.length?"needs_review":"unmatched",method:scored.length?"fuzzy_candidate":"none",confidence:scored[0]?.confidence||0,target:null,candidates:scored,auto_confirm_allowed:false};
}
export function matchDataset(sources,targets,options={}){
 const results=sources.map((source,index)=>({source_index:index,source,...matchRecord(source,targets,options)}));
 return {results,summary:{total:results.length,confirmed:results.filter(x=>x.status==="confirmed").length,needs_review:results.filter(x=>x.status==="needs_review").length,unmatched:results.filter(x=>x.status==="unmatched").length}};
}
