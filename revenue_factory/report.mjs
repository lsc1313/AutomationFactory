import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { escapeHtml } from './core.mjs';

export function parseCsv(src) {
  if (typeof src !== 'string' || !src.trim() || src.length > 5_000_000) throw new Error('5MB 이하의 CSV 내용이 필요합니다.');
  src = src.replace(/^\uFEFF/, '');
  const rows = []; let fields = []; let field = ''; let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') {
      if (field.length) throw new Error('CSV 따옴표 형식이 잘못되었습니다.');
      quoted = true;
    } else if (c === ',') { fields.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      fields.push(field); field = '';
      if (fields.some(x => x.trim())) rows.push(fields);
      fields = [];
    } else field += c;
  }
  if (quoted) throw new Error('닫히지 않은 CSV 따옴표입니다.');
  fields.push(field);
  if (fields.some(x => x.trim())) rows.push(fields);
  return rows;
}

const aliases = {
  date: ['date', '날짜', '주문일', '결제일'],
  product: ['product', '상품', '상품명', '품목'],
  quantity: ['quantity', 'qty', '수량'],
  unit_price: ['unit_price', 'unitprice', '단가', '판매단가'],
};
const parseNumber = (s, name, row) => {
  const v = String(s).trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(v)) throw new Error(`${row}행 ${name}: 유효한 0 이상의 숫자를 입력하세요.`);
  const n = Number(v);
  if (!Number.isFinite(n) || n > 1e10) throw new Error(`${row}행 ${name}: 값이 너무 큽니다.`);
  return n;
};
export function aggregateSales(csv) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error('헤더와 판매 데이터가 필요합니다.');
  const headers = rows[0].map(x => x.trim().toLowerCase());
  const idx = Object.fromEntries(Object.entries(aliases).map(([name, a]) => [name, headers.findIndex(h => a.includes(h))]));
  if (Object.values(idx).some(v => v < 0)) throw new Error('필수 열: date, product, quantity, unit_price (한글 열 이름 지원)');
  const sales = new Map(); let totalQuantity = 0; let revenue = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]; const line = i + 1;
    if (row.length !== headers.length) throw new Error(`${line}행의 CSV 열 수가 다릅니다.`);
    const date = row[idx.date].trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) !== date) throw new Error(`${line}행 날짜는 YYYY-MM-DD로 입력하세요.`);
    const product = row[idx.product].trim();
    if (!product || product.length > 120) throw new Error(`${line}행 상품명이 유효하지 않습니다.`);
    const quantity = parseNumber(row[idx.quantity], '수량', line);
    const unitPrice = parseNumber(row[idx.unit_price], '단가', line);
    if (!Number.isInteger(quantity)) throw new Error(`${line}행 수량은 정수여야 합니다.`);
    const amount = quantity * unitPrice;
    if (!Number.isSafeInteger(amount)) throw new Error(`${line}행 금액 계산이 안전하지 않습니다.`);
    const item = sales.get(product) || { product, quantity: 0, revenue: 0, orders: 0 };
    item.quantity += quantity; item.revenue += amount; item.orders++;
    sales.set(product, item); totalQuantity += quantity; revenue += amount;
  }
  const items = [...sales.values()].sort((a, b) => b.revenue - a.revenue);
  return { orders: rows.length - 1, totalQuantity, revenue, products: items, note: '세금·환불·배송비·수수료 미반영. 원본 주문 CSV의 고객 정보는 결과물에 포함하지 않습니다.' };
}
const csvCell = v => `"${String(v).replace(/^([=+@\-\t\r])/,'\'$1').replace(/"/g,'""')}"`;
export async function writeSalesReport(csv, outputRoot) {
  const summary = aggregateSales(csv);
  const job = `report-${randomBytes(6).toString('hex')}`;
  const dir = path.join(outputRoot, job);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  const outputCsv = [['상품명','수량','매출액','주문행수'], ...summary.products.map(x => [x.product,x.quantity,x.revenue,x.orders])].map(r => r.map(csvCell).join(',')).join('\n');
  await writeFile(path.join(dir, 'summary.csv'), `\uFEFF${outputCsv}`);
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>매출 요약</title><style>body{font-family:system-ui,sans-serif;margin:36px auto;padding:16px;max-width:980px;color:#e8efff;background:#0f172a}table{width:100%;border-collapse:collapse}td,th{padding:12px;text-align:left;border-bottom:1px solid #334155}.metric{font-size:30px;font-weight:700}small{color:#b0becd}</style><h1>상품별 매출 요약</h1><p class="metric">${summary.revenue.toLocaleString('ko-KR')}원</p><p>주문 행 ${summary.orders}건 · 총 수량 ${summary.totalQuantity}</p><table><thead><tr><th>상품</th><th>수량</th><th>매출액</th></tr></thead><tbody>${summary.products.map(x=>`<tr><td>${escapeHtml(x.product)}</td><td>${x.quantity}</td><td>${x.revenue.toLocaleString('ko-KR')}원</td></tr>`).join('')}</tbody></table><p><small>${escapeHtml(summary.note)}</small></p></html>`;
  await writeFile(path.join(dir, 'report.html'), html);
  return { job, files: ['summary.json','summary.csv','report.html'], preview: `${job}/report.html`, summary };
}