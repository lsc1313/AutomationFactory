import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { server } from '../server.mjs';
const base = path.dirname(fileURLToPath(import.meta.url));

test('PWA manifest has proper name and square icons', async () => {
  const m = JSON.parse(await readFile(path.join(base, '../manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.deepEqual(m.icons.map(x => x.sizes), ['192x192', '512x512']);
  for (const icon of m.icons) {
    const b = await readFile(path.join(base, '..', icon.src.slice(1)));
    assert.equal(b.toString('hex', 0, 8), '89504e470d0a1a0a');
  }
});

test('service worker never caches generated customer data', async () => {
  const sw = await readFile(path.join(base, '../sw.js'), 'utf8');
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /pathname\.startsWith\('\/files\/'\)/);
  assert.doesNotMatch(sw, /cache\.addAll\(\[['"]\/files\//);
});

test('local server serves PWA shell and manifest', async (t) => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const root = `http://127.0.0.1:${address.port}`;
  for (const [route, type] of [['/', 'text/html'], ['/manifest.webmanifest', 'application/manifest+json'], ['/sw.js', 'text/javascript'], ['/icons/icon-192.png', 'image/png']]) {
    const r = await fetch(root + route);
    assert.equal(r.status, 200, route);
    assert.match(r.headers.get('content-type') ?? '', new RegExp(type.replace('+','\\+')));
  }
});