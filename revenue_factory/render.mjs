/** Offline, deterministic 25-second vertical MP4 renderer. No paid AI or narration required. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const exec = promisify(execFile);
const DEFAULT_FONT_PATHS = [
  '/usr/share/fonts/truetype/nanum/NanumSquareB.ttf',
  '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf',
  '/usr/share/fonts/truetype/unfonts-core/UnDotumBold.ttf',
  'C:/Windows/Fonts/malgunbd.ttf',
  'C:/Windows/Fonts/malgun.ttf',
  '/System/Library/Fonts/AppleSDGothicNeo.ttc',
];
export async function locateFont() {
  const choices = [process.env.REVENUE_FONT, ...DEFAULT_FONT_PATHS].filter(Boolean);
  for (const candidate of choices) { try { await access(candidate); return candidate; } catch { /* try the next font */ } }
  throw new Error('한글 글꼴이 없습니다. REVENUE_FONT 환경변수로 한글 TTF/OTF 파일을 지정하세요.');
}
export async function renderStatus() {
  try { await exec('ffmpeg', ['-version'], { timeout: 5000 }); return { available: true, font: await locateFont() }; }
  catch (err) { return { available: false, reason: `FFmpeg 또는 한글 폰트 없음: ${err.message}` }; }
}
const escFilter = v => String(v).replaceAll('\\', '\\\\').replaceAll(':','\\:').replaceAll("'", "\\'").replaceAll(',', '\\,').replaceAll('[','\\[').replaceAll(']','\\]');
// Break lines at approximate Hangul widths, and bound visible copy before ffmpeg receives it.
export function wrapCaption(input, width = 16, maxLines = 4) {
  const parts = String(input).replace(/[\r\n]+/g,' ').split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  for (let word of parts) {
    while ([...word].length > width) { if (line) { lines.push(line); line=''; } lines.push([...word].slice(0,width).join('')); word=[...word].slice(width).join(''); }
    if (!line) line = word;
    else if ([...line, ' ', ...word].length <= width) line += ' ' + word;
    else { lines.push(line); line=word; }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines).join('\n');
}
export async function renderVideo(dir, brief, { timeoutMs = 120000, fps = 15 } = {}) {
  const status = await renderStatus();
  if (!status.available) throw new Error(status.reason);
  const width = 720, height = 1280;
  const config = [
    { duration: 4, text: brief.copy.hook },
    { duration: 8, text: brief.storyboard[1].voice },
    { duration: 8, text: brief.storyboard[2].voice },
    { duration: 5, text: `${brief.copy.priceLabel}\n${brief.copy.callToAction}` },
  ];
  const textFiles = [];
  for (let i=0;i<config.length;i++) {
    const file=`scene-${i+1}.txt`;
    await writeFile(path.join(dir,file),wrapCaption(config[i].text), 'utf8');
    textFiles.push(file);
  }
  const photoFiles=['product.png','product.jpg','product.webp'];
  let photo=null;
  for(const file of photoFiles) {try {await access(path.join(dir,file));photo=file;break;}catch{}}
  const args=['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`color=c=0x111827:s=${width}x${height}:r=${fps}:d=25`];
  if(photo) args.push('-loop','1','-framerate',String(fps),'-i',photo);
  const filters=[];
  if(photo) {
    filters.push('[1:v]scale=620:650:force_original_aspect_ratio=decrease,setsar=1[img]');
    filters.push('[0:v][img]overlay=x=(W-w)/2:y=145:shortest=1[base]');
  } else {
    await writeFile(path.join(dir,'product-title.txt'),wrapCaption(brief.product.name,12,3),'utf8');
    filters.push('[0:v]drawbox=x=42:y=140:w=636:h=645:color=0x21344D:t=fill[photoPanel]');
    filters.push(`[photoPanel]drawtext=fontfile='${escFilter(status.font)}':textfile=product-title.txt:fontcolor=0xEAF4FF:fontsize=60:line_spacing=18:x=(w-text_w)/2:y=420[base]`);
  }
  filters.push('[base]drawbox=x=30:y=840:w=660:h=355:color=black@0.78:t=fill[b1]');
  let last='b1';let elapsed=0;
  for(let i=0;i<config.length;i++) {
    const section=config[i];const start=elapsed;const end=elapsed+section.duration;
    const next=`t${i}`;
    filters.push(`[${last}]drawtext=fontfile='${escFilter(status.font)}':textfile=${textFiles[i]}:fontcolor=white:fontsize=46:line_spacing=20:x=(w-text_w)/2:y=917:enable='gte(t,${start})*lt(t,${end})'[${next}]`);
    last=next;elapsed=end;
  }
  filters.push(`[${last}]drawtext=fontfile='${escFilter(status.font)}':text='광고 시안 · 게시 전 검토 필수':fontcolor=0xFFE1A6:fontsize=24:x=(w-text_w)/2:y=1225[v]`);
  args.push('-filter_complex',filters.join(';'),'-map','[v]','-c:v','libx264','-preset','ultrafast','-crf','30','-pix_fmt','yuv420p','-r',String(fps),'-t','25','-movflags','+faststart','advertisement.mp4');
  try { await exec('ffmpeg',args,{cwd:dir,timeout:timeoutMs,maxBuffer:512*1024}); }
  catch(e) {throw new Error(`MP4 렌더링 실패: ${String(e.stderr||e.message).slice(0,500)}`);}
  const result = await readFile(path.join(dir,'advertisement.mp4'));
  if(result.length < 1024) throw new Error('생성된 영상 파일이 비정상적입니다.');
  return { filename: 'advertisement.mp4', bytes: result.length, durationSeconds: 25, width, height, fps, hasAudio: false, note: '무음 영상 시안. 음성·음악은 포함하지 않았습니다.' };
}