function n(v){return String(v??"").trim()}function num(v){return Number(v)||0}
function groupLines(words){const m=new Map();for(const w of words){if(!n(w.text)||num(w.conf)<0)continue;const k=[w.page_num,w.block_num,w.par_num,w.line_num].join(":");if(!m.has(k))m.set(k,[]);m.get(k).push(w)}return [...m.values()].map(a=>a.sort((x,y)=>num(x.left)-num(y.left)))}
function headerScore(text){const s=n(text).toLowerCase();const terms=["sku","item","product","qty","quantity","price","cost","amount","total","상품","품목","수량","단가","금액","합계"];return terms.filter(t=>s.includes(t)).length}
export function tableFromTsvWords(words,{minHeaderTerms=2}={}){
 const lines=groupLines(words);if(lines.length<2)return null;let hi=-1,best=0;for(let i=0;i<Math.min(lines.length,20);i++){const score=headerScore(lines[i].map(x=>x.text).join(" "));if(score>best){best=score;hi=i}}if(best<minHeaderTerms||hi<0)return null;
 const header=lines[hi],centers=header.map(w=>({name:n(w.text),x:num(w.left)+num(w.width)/2})).filter(x=>x.name);if(centers.length<2)return null;
 const rows=[];let misses=0;for(const line of lines.slice(hi+1)){const cells=Array(centers.length).fill("");for(const w of line){const x=num(w.left)+num(w.width)/2;let j=0,d=Infinity;centers.forEach((c,i)=>{const z=Math.abs(c.x-x);if(z<d){d=z;j=i}});cells[j]+=(cells[j]?" ":"")+n(w.text)}const filled=cells.filter(Boolean).length,numeric=cells.filter(v=>/^[-+]?[$₩€£]?[\\d,.]+$/.test(n(v))).length;if(filled>=Math.min(3,centers.length)&&numeric>=1){rows.push(Object.fromEntries(centers.map((c,i)=>[c.name,cells[i]])));misses=0}else if(rows.length&&++misses>=1)break}
 return rows.length?{headers:centers.map(c=>c.name),rows,method:"tsv_geometry",confidence:Math.min(.95,.65+best*.05)}:null;
}
