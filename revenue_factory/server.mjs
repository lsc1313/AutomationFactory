import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCreativePack } from './core.mjs';
import { writeSalesReport } from './report.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.resolve(process.env.REVENUE_OUT || path.join(base, 'output'));
const port = Number(process.env.REVENUE_PORT || 8038);
const mime = { '.webmanifest': 'application/manifest+json', '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg':'image/svg+xml', '.csv': 'text/csv; charset=utf-8', '.jpg':'image/jpeg', '.png':'image/png', '.webp':'image/webp' };
const headers = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'" };
function respond(res, code, body, type='application/json; charset=utf-8') { res.writeHead(code, { ...headers, 'Content-Type': type }); res.end(type.includes('json') ? JSON.stringify(body) : body); }
async function parseRequest(req) {
  const chunks = []; let size = 0;
  for await (const b of req) { size += b.length; if (size > 7_500_000) throw new Error('요청 크기 초과(7.5MB)'); chunks.push(b); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON 객체를 보내세요.');
  return value;
}
export const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') {
      return respond(res, 200, await readFile(path.join(base,'ui.html'),'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && ['/manifest.webmanifest', '/sw.js', '/offline.html', '/icons/icon-192.png', '/icons/icon-512.png'].includes(url.pathname)) {
      const staticFile = path.resolve(base, '.' + url.pathname);
      if (!staticFile.startsWith(base + path.sep)) return respond(res, 404, { error: 'Not found' });
      const content = await readFile(staticFile);
      const extra = url.pathname === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {};
      res.writeHead(200, { ...headers, ...extra, 'Content-Type': mime[path.extname(staticFile)] || 'application/octet-stream' });
      res.end(content); return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
      const relative = decodeURIComponent(url.pathname.slice('/files/'.length));
      if (!/^(creative|report)-[a-f0-9]{12}\/[a-zA-Z0-9._-]+$/.test(relative) || relative.includes('..')) return respond(res,404,{error:'Not found'});
      const filename = path.resolve(outputRoot, relative);
      if (!filename.startsWith(outputRoot + path.sep)) return respond(res,404,{error:'Not found'});
      const content = await readFile(filename);
      res.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' }); res.end(content); return;
    }
    if (req.method === 'POST' && ['/api/creative','/api/report'].includes(url.pathname)) {
      const payload = await parseRequest(req);
      const result = url.pathname === '/api/creative'
        ? await writeCreativePack(payload, outputRoot)
        : await writeSalesReport(payload.csv, outputRoot);
      return respond(res,200,{...result,previewUrl:`/files/${result.preview}`});
    }
    return respond(res,404,{error:'해당 페이지가 없습니다.'});
  } catch(e) { return respond(res,400,{error:e.message}); }
});
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port,'127.0.0.1',()=>console.log(`Revenue Factory local MVP: http://127.0.0.1:${port}`));
}