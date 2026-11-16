import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCreativePack } from './core.mjs';
import { writeSalesReport } from './report.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
const [command, input, destination] = process.argv.slice(2);
const outputRoot = path.resolve(destination || path.join(base, 'output'));
async function main() {
  if (command === 'serve') { const { server } = await import('./server.mjs'); const port = Number(process.env.REVENUE_PORT || 8038); server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`)); return; }
  if (!['creative','report'].includes(command)) throw new Error('사용법: node revenue_factory/cli.mjs [creative 상품.json | report 매출.csv | serve] [결과폴더]');
  if (!input) throw new Error('입력 파일 경로를 지정하세요.');
  const data = await readFile(path.resolve(input),'utf8');
  const result = command === 'creative' ? await writeCreativePack(JSON.parse(data), outputRoot) : await writeSalesReport(data, outputRoot);
  console.log(JSON.stringify({ ...result, outputDirectory: path.join(outputRoot, result.job) }, null, 2));
}
main().catch(e => { console.error(`오류: ${e.message}`); process.exitCode = 1; });