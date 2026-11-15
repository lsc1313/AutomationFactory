import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const sample={brand:'테스트브랜드',name:'텀블러',audience:'출근하는 사람',features:['500mL 용량','이중벽 구조'],priceKrw:9900};
test('HTTP 전체 흐름: 상품 -> MP4 -> 검수 -> 납품 -> 보고서', async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rf-api-'));
 const original=process.env.REVENUE_OUT;process.env.REVENUE_OUT=dir;
 const {server}=await import('../server.mjs?it=integration');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 async function call(p,data,origin=null){const options=data===undefined?{}:{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(data)};const res=await fetch(url+p,options);return {res,json:res.headers.get('content-type')?.includes('json')?await res.json():null};}
 try {
  let health=await call('/api/health');assert.equal(health.res.status,200);assert.equal(health.json.ok,true);
  const bad=await call('/api/creative',sample,'https://outside.test');assert.equal(bad.res.status,403);
  const made=await call('/api/creative',sample);assert.equal(made.res.status,200,JSON.stringify(made.json));
  assert.match(made.json.job,/^creative-[a-f0-9]{12}$/);
  assert.ok(made.json.jobRecord.files.includes('advertisement.mp4'), JSON.stringify(made.json.renderWarning));
  const video=await fetch(url+`/files/${made.json.job}/advertisement.mp4`);assert.equal(video.status,200);assert.equal(video.headers.get('content-type'),'video/mp4');
  let jobs=await call('/api/jobs');assert.equal(jobs.json.jobs.length,1);
  const rejected=await call(`/api/jobs/${made.json.job}/approve`,{checks:{rights:true}});assert.equal(rejected.res.status,400);
  const approved=await call(`/api/jobs/${made.json.job}/approve`,{checks:{rights:true,accuracy:true,claims:true,channels:true}});assert.equal(approved.json.status,'APPROVED');
  const pack=await call(`/api/jobs/${made.json.job}/package`,{});assert.equal(pack.res.status,200);assert.match(pack.json.downloadUrl,/\.zip$/);
  const zipped=await fetch(url+pack.json.downloadUrl);assert.equal(zipped.status,200);assert.equal(zipped.headers.get('content-type'),'application/zip');
  const report=await call('/api/report',{csv:'date,product,quantity,unit_price\n2026-11-01,텀블러,2,8000\n'});assert.equal(report.json.summary.revenue,16000);
 }finally{await new Promise(r=>server.close(r));if(original===undefined)delete process.env.REVENUE_OUT;else process.env.REVENUE_OUT=original;await rm(dir,{recursive:true,force:true});}
});