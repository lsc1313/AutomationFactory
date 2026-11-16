import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
const JOB_ID = /^(creative|report)-[0-9a-f]{12}$/;
export function validJobId(id) { if(typeof id!=='string'||!JOB_ID.test(id)) throw new Error('잘못된 작업 번호입니다.');return id; }
function jobDir(root,id) {return path.join(root,validJobId(id));}
export async function getJob(root,id) {
  const meta=JSON.parse(await readFile(path.join(jobDir(root,id),'job.json'),'utf8'));
  return {id, ...meta};
}
export async function saveJob(root,id,data) {
  const dir=jobDir(root,id);
  await mkdir(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'job.json');const temp=path.join(dir,`.job-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temp,JSON.stringify(data,null,2),{mode:0o600});
  await rename(temp,file);
  return { ...data, id };
}
export async function createJobRecord(root,result,kind) {
  const now=new Date().toISOString();
  return saveJob(root,result.job,{kind,status:kind==='creative'?'REVIEW_REQUIRED':'READY',createdAt:now,updatedAt:now,approvedAt:null,files:result.files,preview:result.preview});
}
export async function listJobs(root,limit=50) {
  await mkdir(root,{recursive:true,mode:0o700});
  const entries=await readdir(root,{withFileTypes:true});
  const ids=entries.filter(x=>x.isDirectory()&&JOB_ID.test(x.name)).map(x=>x.name);
  const jobs=[];
  for(const id of ids) {try{jobs.push(await getJob(root,id));}catch{/* unrelated old job */}}
  return jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit);
}
export async function approveJob(root,id,checks) {
  const job=await getJob(root,id);
  if(job.kind!=='creative'||!['REVIEW_REQUIRED','APPROVED'].includes(job.status)) throw new Error('승인 가능한 광고 시안이 아닙니다.');
  const required=['rights','accuracy','claims','channels'];
  if(!checks||required.some(k=>checks[k]!==true)) throw new Error('사용권·상품정보·광고 주장·게시 표시를 모두 확인해야 합니다.');
  const now=new Date().toISOString();
  return saveJob(root,id,{...job,id:undefined,status:'APPROVED',approvedAt:now,updatedAt:now,approvalChecklist:Object.fromEntries(required.map(k=>[k,true]))});
}
// ZIP store writer: dependency-free on Windows/macOS/Linux. Files are held in memory up to 64 MB.
const crcTable = Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);return c>>>0;});
const crc32 = bytes => {let c=0xffffffff;for(const b of bytes)c=(c>>>8)^crcTable[(c^b)&255];return (c^0xffffffff)>>>0;};
export async function zipJob(root,id) {
  const job=await getJob(root,id);const dir=jobDir(root,id);
  if(job.kind==='creative'&&job.status!=='APPROVED')throw new Error('광고 시안 검수 승인 후 납품 ZIP을 생성할 수 있습니다.');
  const assets=job.files.filter(f=>/^[a-zA-Z0-9._-]+$/.test(f)&&f!=='job.json'&&f!=='delivery.zip');
  if(!assets.length)throw new Error('다운로드 가능한 파일이 없습니다.');
  const local=[],central=[];let offset=0,total=0;
  for(const filename of assets) {
    const data=await readFile(path.join(dir,filename));total+=data.length;
    if(total>64*1024*1024)throw new Error('압축 패키지의 최대 용량은 64MB입니다.');
    const name=Buffer.from(filename,'utf8');const crc=crc32(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    local.push(header,name,data);
    const cent=Buffer.alloc(46);cent.writeUInt32LE(0x02014b50,0);cent.writeUInt16LE(20,4);cent.writeUInt16LE(20,6);cent.writeUInt16LE(0x800,8);cent.writeUInt32LE(crc,16);cent.writeUInt32LE(data.length,20);cent.writeUInt32LE(data.length,24);cent.writeUInt16LE(name.length,28);cent.writeUInt32LE(offset,42);
    central.push(cent,name);offset+=30+name.length+data.length;
  }
  const dirBytes=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(assets.length,8);end.writeUInt16LE(assets.length,10);end.writeUInt32LE(dirBytes.length,12);end.writeUInt32LE(offset,16);
  const body=Buffer.concat([...local,dirBytes,end]);
  await writeFile(path.join(dir,'delivery.zip'),body,{mode:0o600});
  return {id,filename:'delivery.zip',bytes:body.length,status:job.status};
}