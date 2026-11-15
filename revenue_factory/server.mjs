import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCreativePack } from './core.mjs';
import { writeSalesReport } from './report.mjs';
import { approveJob, createJobRecord, getJob, listJobs, validJobId, zipJob, saveJob } from './workflow.mjs';
import { renderStatus, renderVideo } from './render.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.resolve(process.env.REVENUE_OUT || path.join(base, 'output'));
const port = Number(process.env.REVENUE_PORT || 8038);
const mime = { '.webmanifest': 'application/manifest+json', '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg':'image/svg+xml', '.csv': 'text/csv; charset=utf-8', '.jpg':'image/jpeg', '.png':'image/png', '.webp':'image/webp','.mp4':'video/mp4','.zip':'application/zip' };
const headers = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'" };
function respond(res, code, body, type='application/json; charset=utf-8') { res.writeHead(code, { ...headers, 'Content-Type': type }); res.end(type.includes('json') ? JSON.stringify(body) : body); }
async function parseRequest(req) {
  const chunks = []; let size = 0;
  for await (const b of req) { size += b.length; if (size > 7_500_000) throw new Error('요청 크기 초과(7.5MB)'); chunks.push(b); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON 객체를 보내세요.');
  return value;
}
const staticFiles = new Set(['/manifest.webmanifest', '/sw.js', '/offline.html', '/icons/icon-192.png', '/icons/icon-512.png']);
const runningJobs = new Set();
export const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const method=req.method;
    const host=String(req.headers.host||'').split(':')[0].toLowerCase();
    if(!['127.0.0.1','localhost'].includes(host))return respond(res,403,{error:'로컬 환경에서만 사용할 수 있습니다.'});
    // Origin checks prevent other websites silently submitting jobs to the local service.
    if(method==='POST') {
      const origin=req.headers.origin;
      if(origin) { const parsed=new URL(origin);if(!['localhost','127.0.0.1'].includes(parsed.hostname)||parsed.port!==String(server.address()?.port ?? port)) return respond(res,403,{error:'외부 웹사이트에서의 요청은 차단됩니다.'}); }
      if(!String(req.headers['content-type']??'').startsWith('application/json'))return respond(res,415,{error:'application/json 요청만 허용됩니다.'});
    }
    if (method === 'GET' && url.pathname === '/') return respond(res,200,await readFile(path.join(base,'ui.html'),'utf8'),'text/html; charset=utf-8');
    if (method === 'GET' && staticFiles.has(url.pathname)) {
      const staticFile = path.resolve(base, '.' + url.pathname);
      if (!staticFile.startsWith(base + path.sep)) return respond(res, 404, { error: 'Not found' });
      const content = await readFile(staticFile);
      const extra = url.pathname === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {};
      res.writeHead(200, { ...headers, ...extra, 'Content-Type': mime[path.extname(staticFile)] || 'application/octet-stream' });
      res.end(content); return;
    }
    if (method === 'GET' && url.pathname.startsWith('/files/')) {
      const relative = decodeURIComponent(url.pathname.slice('/files/'.length));
      if (!/^(creative|report)-[a-f0-9]{12}\/[a-zA-Z0-9._-]+$/.test(relative) || relative.includes('..')) return respond(res,404,{error:'Not found'});
      const filename = path.resolve(outputRoot, relative);
      if (!filename.startsWith(outputRoot + path.sep)) return respond(res,404,{error:'Not found'});
      const content = await readFile(filename);
      res.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', ...(filename.endsWith('.zip')?{'Content-Disposition':'attachment; filename="delivery.zip"'}:{}) });res.end(content);return;
    }
    if(method==='GET'&&url.pathname==='/api/health')return respond(res,200,{ok:true,mode:'local-only',render:await renderStatus(),product:'Revenue Factory'});
    if(method==='GET'&&url.pathname==='/api/jobs')return respond(res,200,{jobs:await listJobs(outputRoot)});
    const jobRoute=url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(render|approve|package))?$/);
    if(jobRoute) {
      const id=validJobId(jobRoute[1]);const action=jobRoute[2];
      if(method==='GET'&&!action)return respond(res,200,await getJob(outputRoot,id));
      if(method==='POST'&&action==='approve') {
        return respond(res,200,await approveJob(outputRoot,id,(await parseRequest(req)).checks));
      }
      if(method==='POST'&&action==='render') {
        if(runningJobs.has(id))return respond(res,409,{error:'이미 렌더링 중입니다.'});
        const job=await getJob(outputRoot,id);
        if(job.kind!=='creative')return respond(res,400,{error:'영상 작업만 렌더링할 수 있습니다.'});
        if(job.status==='RENDERING')return respond(res,409,{error:'이전 렌더 작업 상태를 먼저 확인하세요.'});
        if(job.files.includes('advertisement.mp4'))return respond(res,200,{...job,videoUrl:`/files/${id}/advertisement.mp4`});
        runningJobs.add(id);
        const now=new Date().toISOString();
        await saveJob(outputRoot,id,{...job,id:undefined,status:'RENDERING',updatedAt:now});
        try {
          const brief=JSON.parse(await readFile(path.join(outputRoot,id,'brief.json'),'utf8'));
          const video=await renderVideo(path.join(outputRoot,id),brief);
          const updated=await saveJob(outputRoot,id,{...job,id:undefined,status:'REVIEW_REQUIRED',updatedAt:new Date().toISOString(),files:[...job.files,video.filename],video});
          return respond(res,200,{...updated,videoUrl:`/files/${id}/${video.filename}`});
        }catch(e){await saveJob(outputRoot,id,{...job,id:undefined,status:'REVIEW_REQUIRED',updatedAt:new Date().toISOString(),renderError:e.message});throw e;}
        finally{runningJobs.delete(id);}
      }
      if(method==='POST'&&action==='package') {
        const result=await zipJob(outputRoot,id);
        return respond(res,200,{...result,downloadUrl:`/files/${id}/delivery.zip`});
      }
    }
    if (method === 'POST' && ['/api/creative','/api/report'].includes(url.pathname)) {
      const payload = await parseRequest(req);
      const kind=url.pathname==='/api/creative'?'creative':'report';
      const result = kind==='creative' ? await writeCreativePack(payload, outputRoot) : await writeSalesReport(payload.csv, outputRoot);
      let job=await createJobRecord(outputRoot,result,kind);
      let renderWarning=null;
      if(kind==='creative' && process.env.REVENUE_AUTO_RENDER!=='0') {
        const available=await renderStatus();
        if(available.available) {
          try {
            const brief=JSON.parse(await readFile(path.join(outputRoot,result.job,'brief.json'),'utf8'));
            const video=await renderVideo(path.join(outputRoot,result.job),brief);
            job=await saveJob(outputRoot,result.job,{...job,id:undefined,status:'REVIEW_REQUIRED',updatedAt:new Date().toISOString(),files:[...job.files,video.filename],video});
          } catch(e) {renderWarning=e.message;job=await saveJob(outputRoot,result.job,{...job,id:undefined,renderError:renderWarning});}
        } else renderWarning=available.reason;
      }
      return respond(res,200,{...result,jobRecord:job,renderWarning,previewUrl:`/files/${result.preview}`});
    }
    return respond(res,404,{error:'해당 페이지가 없습니다.'});
  } catch(e) {
    const notFound=e.code==='ENOENT';return respond(res,notFound?404:400,{error:notFound?'작업 또는 파일을 찾을 수 없습니다.':e.message});
  }
});
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) server.listen(port,'127.0.0.1',()=>console.log(`Revenue Factory: http://127.0.0.1:${port}`));