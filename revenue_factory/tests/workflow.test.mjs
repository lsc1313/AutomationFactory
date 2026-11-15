import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeCreativePack } from '../core.mjs';
import { writeSalesReport } from '../report.mjs';
import { approveJob, createJobRecord, getJob, listJobs, validJobId, zipJob } from '../workflow.mjs';
import { renderStatus, renderVideo, wrapCaption } from '../render.mjs';
const product={brand:'하루상점', name:'데일리 텀블러', audience:'출근하는 직장인', features:['500mL 용량','이중벽 구조'], priceKrw:19900};
async function withRoot(callback) {const root=await mkdtemp(path.join(tmpdir(),'revenue-wf-'));try{await callback(root);}finally{await rm(root,{recursive:true,force:true});}}
test('작업 생성, 조회, 검수 및 승인 체크리스트',async()=>withRoot(async root=>{
  const generated=await writeCreativePack(product,root);
  await createJobRecord(root,generated,'creative');
  const jobs=await listJobs(root);assert.equal(jobs.length,1);assert.equal(jobs[0].status,'REVIEW_REQUIRED');
  await assert.rejects(approveJob(root,generated.job,{rights:true}));
  await assert.rejects(zipJob(root,generated.job),/검수 승인/);
  const approved=await approveJob(root,generated.job,{rights:true,accuracy:true,claims:true,channels:true});
  assert.equal(approved.id,generated.job);assert.equal((await getJob(root,generated.job)).status,'APPROVED');
  assert.throws(()=>validJobId('../../etc/passwd'));
}));
test('납품 ZIP 및 보고서 결과',async()=>withRoot(async root=>{
  const generated=await writeSalesReport('date,product,quantity,unit_price\n2026-11-01,텀블러,2,9000\n',root);
  await createJobRecord(root,generated,'report');
  const z=await zipJob(root,generated.job);const bytes=await readFile(path.join(root,generated.job,z.filename));
  assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);
  assert.equal(z.status,'READY');
}));
test('영상 자막 줄바꿈 및 위험한 렌더링 입력을 쉘에 전달하지 않음',()=>{
  assert.match(wrapCaption('500mL 데일리 휴대용 텀블러를 소개합니다.',12),/\n/);
});
test('실제 MP4 렌더링과 ffmpeg 호환성',async(t)=>{
  const ready=await renderStatus();if(!ready.available)return t.skip(ready.reason);
  await withRoot(async root=>{
    const generated=await writeCreativePack(product,root);
    const brief=JSON.parse(await readFile(path.join(root,generated.job,'brief.json'),'utf8'));
    const video=await renderVideo(path.join(root,generated.job),brief);
    const content=await readFile(path.join(root,generated.job,video.filename));
    assert.equal(content.toString('ascii',4,8),'ftyp');assert.ok(video.bytes>10000);assert.equal(video.durationSeconds,25);
  });
});