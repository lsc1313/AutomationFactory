import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function required(value, name, max = 140) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 항목이 필요합니다.`);
  if (value.trim().length > max) throw new Error(`${name}은 ${max}자 이하여야 합니다.`);
  return value.trim();
}

export function validateProduct(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('상품 JSON 객체가 필요합니다.');
  const name = required(value.name, '상품명');
  const brand = required(value.brand, '브랜드', 80);
  const audience = required(value.audience || '상품에 관심 있는 고객', '고객 대상');
  const features = value.features;
  if (!Array.isArray(features) || features.length < 1 || features.length > 5) throw new Error('특징은 1~5개가 필요합니다.');
  const cleanedFeatures = features.map((x, i) => required(x, `특징 ${i + 1}`, 120));
  const price = value.priceKrw === '' || value.priceKrw == null ? null : Number(value.priceKrw);
  if (price !== null && (!Number.isSafeInteger(price) || price < 0 || price > 1000000000)) throw new Error('가격은 유효한 0원 이상의 숫자여야 합니다.');
  const imageDataUrl = value.imageDataUrl ?? null;
  if (imageDataUrl !== null) {
    if (typeof imageDataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(imageDataUrl)) throw new Error('사진은 PNG/JPEG/WEBP 형식이어야 합니다.');
    if (imageDataUrl.length > 7_000_000) throw new Error('사진은 약 5MB 이하여야 합니다.');
  }
  return { name, brand, audience, features: cleanedFeatures, priceKrw: price, imageDataUrl, landingUrl: typeof value.landingUrl === 'string' && /^https:\/\//.test(value.landingUrl) && value.landingUrl.length <= 1024 ? value.landingUrl : null };
}

export function makeCreativeBrief(raw) {
  const p = validateProduct(raw);
  const copy = {
    hook: `${p.audience}에게 소개하는 ${p.name}`,
    shortTitle: `${p.brand} | ${p.name}`,
    featureLines: p.features,
    callToAction: p.landingUrl ? '상품 정보를 확인해 보세요.' : '상품 정보는 판매자에게 확인하세요.',
    priceLabel: p.priceKrw === null ? '가격 문의' : `${p.priceKrw.toLocaleString('ko-KR')}원`,
  };
  const riskPatterns = [/[가-힣\w]*최저가/, /국내\s*1위|판매\s*1위/, /100\s*%/, /완치|치료|부작용\s*없/, /무조건|보장|확정/];
  const risky = [...p.features, p.name].filter(v => riskPatterns.some(r => r.test(v)));
  return { status: 'DRAFT_REVIEW_REQUIRED', product: { ...p, imageDataUrl: undefined }, copy,
    storyboard: [
      { start: 0, end: 4, scene: '첫 장면: 상품 사진과 고객 관심 문구', voice: copy.hook },
      { start: 4, end: 12, scene: '핵심 특징 1', voice: p.features[0] },
      { start: 12, end: 20, scene: '나머지 특징과 제품 이미지', voice: p.features.slice(1).join('. ') || '상품의 상세 정보를 확인하세요.' },
      { start: 20, end: 25, scene: '가격 및 행동 유도', voice: `${copy.priceLabel}. ${copy.callToAction}` },
    ],
    channels: ['youtube-shorts', 'instagram-reels', 'naver-commerce'],
    review: {
      claimReviewRequired: risky.length > 0,
      claimsToVerify: risky,
      checklist: ['판매 권한이 있는 상품 사진인지 확인', '상품명·가격·특징의 실제 정보 확인', '과장된 효능·1위·최저가 표현 검증', '채널별 광고 표시 및 사용권 확인', '게시 전 사람의 최종 승인'],
    },
    limitations: ['문구 초안·SVG 이미지·스토리보드만 제작합니다.', '영상 렌더링, AI 이미지 생성, 외부 업로드, 결제는 연결되지 않았습니다.'],
  };
}

function svgCard(p, brief, step) {
  const backgrounds = ['#10172b', '#0e2930', '#28172e'];
  const accents = ['#b7d6ff', '#c5f3cf', '#efd3ff'];
  const title = [brief.copy.hook, p.features[0], brief.copy.callToAction][step];
  const sub = [p.features[0], p.features.slice(1).join(' · ') || p.name, brief.copy.priceLabel][step];
  const e = escapeHtml;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <rect width="1080" height="1350" fill="${backgrounds[step]}"/>
  <rect x="72" y="75" width="936" height="1200" rx="45" fill="none" stroke="${accents[step]}" stroke-opacity=".4" stroke-width="3"/>
  <text x="110" y="190" font-family="Arial, sans-serif" font-size="49" fill="${accents[step]}">${e(p.brand)}</text>
  <rect x="110" y="292" width="860" height="6" fill="${accents[step]}"/>
  <foreignObject x="110" y="390" width="860" height="580"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,'Noto Sans KR',sans-serif;color:#fff;font-size:70px;font-weight:800;line-height:1.3;overflow-wrap:anywhere">${e(title)}</div></foreignObject>
  <foreignObject x="110" y="1070" width="860" height="130"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,'Noto Sans KR',sans-serif;color:${accents[step]};font-size:40px;overflow-wrap:anywhere">${e(sub)}</div></foreignObject>
</svg>`;
}

export async function writeCreativePack(raw, outputRoot) {
  const p = validateProduct(raw);
  const brief = makeCreativeBrief(raw);
  const job = `creative-${randomBytes(6).toString('hex')}`;
  const dir = path.join(outputRoot, job);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const files = ['card-1.svg', 'card-2.svg', 'card-3.svg'];
  await Promise.all(files.map((filename, i) => writeFile(path.join(dir, filename), svgCard(p, brief, i))));
  let photoFilename = null;
  if (p.imageDataUrl) {
    const [, type, b64] = p.imageDataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > 5_000_000) throw new Error('이미지는 5MB 이하여야 합니다.');
    photoFilename = `product.${type === 'jpeg' ? 'jpg' : type}`;
    await writeFile(path.join(dir, photoFilename), bytes);
  }
  await writeFile(path.join(dir, 'brief.json'), JSON.stringify(brief, null, 2), 'utf8');
  await writeFile(path.join(dir, 'captions.txt'), brief.storyboard.map(s => `[${s.start}-${s.end}초] ${s.voice}`).join('\n'), 'utf8');
  const preview = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>광고 시안 - 검토 필요</title><style>body{font-family:system-ui,sans-serif;background:#111827;color:white;max-width:1050px;margin:35px auto;padding:16px}img{max-width:100%;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}.notice{padding:18px;background:#422006;border-radius:10px}a{color:#a5d7ff}</style><h1>${escapeHtml(p.name)} 광고 시안</h1><div class="notice"><strong>초안 · 게시 전 사람 검토 필수</strong><p>제품·가격·광고 표시·이미지 사용권 확인 후 게시하세요.</p></div>${photoFilename ? `<h2>판매자 제공 사진</h2><img width="350" src="${photoFilename}" alt="상품 사진">` : '<p>상품 사진 없음 — 텍스트 템플릿 시안입니다.</p>'}<h2>이미지 시안</h2><div class="grid">${files.map(f => `<img src="${f}" alt="광고 카드">`).join('')}</div><h2>25초 영상 스토리보드</h2><ol>${brief.storyboard.map(s => `<li>${s.start}-${s.end}초: ${escapeHtml(s.voice)}</li>`).join('')}</ol><h2>검수 항목</h2><ul>${brief.review.checklist.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul><p>이 시안은 최종 영상이 아니며 자동 게시되지 않습니다.</p></html>`;
  await writeFile(path.join(dir, 'preview.html'), preview, 'utf8');
  return { job, files: [...files, 'brief.json', 'captions.txt', 'preview.html', ...(photoFilename ? [photoFilename] : [])], preview: `${job}/preview.html`, status: brief.status, review: brief.review };
}