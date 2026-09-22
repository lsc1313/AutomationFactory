const APP_VERSION = "0.1.0";

const CANDIDATE_WORDS = [
  "자동화","업무자동화","api","연동","봇","관리자","대시보드","크롤링","스크래핑",
  "구글시트","google sheet","엑셀","excel","알림","스케줄","workflow","ai","챗봇",
  "discord","카카오","카톡","telegram","데이터 처리","사내도구","관리 시스템"
];
const REVIEW_WORDS = ["웹","웹사이트","앱","백엔드","프론트엔드","서버","database","db","saas"];
const IGNORE_WORDS = [
  "상주","파견","풀타임","하드웨어","pcb","펌웨어","3d 모델링","영상편집 전담",
  "원화","캐릭터 디자인","게임 전체 개발","unity 전체","unreal 전체"
];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function nowIso() { return new Date().toISOString(); }

function normalizeText(v) {
  return String(v || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function classifyJob(title, description, skills = "") {
  const text = normalizeText(`${title} ${description} ${skills}`);
  if (IGNORE_WORDS.some(k => text.includes(k))) return { status: "ignored", reason: "제외 신호 감지" };
  const candidateHits = CANDIDATE_WORDS.filter(k => text.includes(k));
  if (candidateHits.length >= 2) return { status: "candidate", reason: `자동화 적합 신호: ${candidateHits.slice(0, 4).join(", ")}` };
  const reviewHits = REVIEW_WORDS.filter(k => text.includes(k));
  if (candidateHits.length === 1 || reviewHits.length >= 1) return { status: "review", reason: "추가 검토 필요" };
  return { status: "ignored", reason: "자동화 관련 신호 부족" };
}

async function ensureSchema(env) {
  if (!env.DB) throw new Error("D1 binding DB가 없습니다.");
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_job_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      budget_min REAL,
      budget_max REAL,
      currency TEXT NOT NULL DEFAULT 'KRW',
      duration TEXT NOT NULL DEFAULT '',
      skills TEXT NOT NULL DEFAULT '',
      posted_at TEXT NOT NULL DEFAULT '',
      deadline TEXT NOT NULL DEFAULT '',
      applicant_count INTEGER,
      url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      classify_reason TEXT NOT NULL DEFAULT '',
      found_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source, source_job_id)
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_found ON jobs(status, found_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_source_posted ON jobs(source, posted_at DESC);
  `);
}

function makeJobId(source, sourceJobId) {
  return `${source}:${sourceJobId}`.replace(/[^a-zA-Z0-9:_-]/g, "_");
}

async function upsertJob(env, input) {
  const source = String(input.source || "demo").trim();
  const sourceJobId = String(input.source_job_id || crypto.randomUUID()).trim();
  const title = String(input.title || "제목 없음").trim();
  const description = String(input.description || "").trim();
  const skills = Array.isArray(input.skills) ? input.skills.join(", ") : String(input.skills || "");
  const c = classifyJob(title, description, skills);
  const ts = nowIso();
  const jobId = makeJobId(source, sourceJobId);

  await env.DB.prepare(`
    INSERT INTO jobs (
      job_id, source, source_job_id, title, description,
      budget_min, budget_max, currency, duration, skills,
      posted_at, deadline, applicant_count, url,
      status, classify_reason, found_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, source_job_id) DO UPDATE SET
      title=excluded.title,
      description=excluded.description,
      budget_min=excluded.budget_min,
      budget_max=excluded.budget_max,
      currency=excluded.currency,
      duration=excluded.duration,
      skills=excluded.skills,
      posted_at=excluded.posted_at,
      deadline=excluded.deadline,
      applicant_count=excluded.applicant_count,
      url=excluded.url,
      updated_at=excluded.updated_at
  `).bind(
    jobId, source, sourceJobId, title, description,
    input.budget_min ?? null, input.budget_max ?? null, String(input.currency || "KRW"),
    String(input.duration || ""), skills,
    String(input.posted_at || ""), String(input.deadline || ""), input.applicant_count ?? null,
    String(input.url || ""), c.status, c.reason, ts, ts
  ).run();

  return { job_id: jobId, status: c.status, reason: c.reason };
}

async function seedDemo(env) {
  const samples = [
    {
      source:"demo", source_job_id:"001",
      title:"Google Sheet와 사내 API 연동 업무 자동화",
      description:"매일 직원이 수기로 취합하는 엑셀 데이터를 API로 전송하고 관리자 대시보드에서 상태를 확인하고 싶습니다.",
      budget_min:500000, budget_max:1200000, currency:"KRW", duration:"1~2주",
      skills:["Google Sheet","API","Dashboard"], posted_at:nowIso(), applicant_count:3,
      url:"https://example.com/demo/001"
    },
    {
      source:"demo", source_job_id:"002",
      title:"카카오톡 기반 직원 출퇴근 관리 봇",
      description:"직원들이 카톡에서 출근/퇴근을 입력하면 DB에 기록하고 월별 근무일수를 관리자 화면에서 보고 싶습니다.",
      budget_min:700000, budget_max:1500000, currency:"KRW", duration:"2주",
      skills:["카카오","봇","DB","관리자"], posted_at:nowIso(), applicant_count:5,
      url:"https://example.com/demo/002"
    },
    {
      source:"demo", source_job_id:"003",
      title:"현장 상주 Unity 게임 개발자 모집",
      description:"6개월 이상 상주 가능한 풀타임 Unity 개발자를 구합니다.",
      budget_min:0, budget_max:0, currency:"KRW", duration:"6개월",
      skills:["Unity","게임 개발"], posted_at:nowIso(), applicant_count:1,
      url:"https://example.com/demo/003"
    },
    {
      source:"demo", source_job_id:"004",
      title:"소규모 주문 관리 웹 구축",
      description:"현재 주문을 엑셀로 관리하고 있으며 주문 상태와 알림을 웹에서 관리하고 싶습니다.",
      budget_min:400000, budget_max:900000, currency:"KRW", duration:"1주",
      skills:["웹","Excel","알림"], posted_at:nowIso(), applicant_count:8,
      url:"https://example.com/demo/004"
    }
  ];
  const out = [];
  for (const s of samples) out.push(await upsertJob(env, s));
  return out;
}

async function getStats(env) {
  const total = await env.DB.prepare(`SELECT COUNT(*) c FROM jobs`).first();
  const rows = await env.DB.prepare(`SELECT status, COUNT(*) c FROM jobs GROUP BY status`).all();
  const stats = { total: Number(total?.c || 0), candidate:0, review:0, ignored:0, new:0 };
  for (const r of rows.results || []) stats[r.status] = Number(r.c || 0);
  return stats;
}

async function listJobs(env, url) {
  const status = url.searchParams.get("status") || "";
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  let query = `SELECT * FROM jobs`;
  const binds = [];
  if (status && status !== "all") { query += ` WHERE status=?`; binds.push(status); }
  query += ` ORDER BY found_at DESC LIMIT ?`; binds.push(limit);
  return (await env.DB.prepare(query).bind(...binds).all()).results || [];
}

async function updateStatus(env, jobId, status) {
  const allowed = new Set(["new","candidate","review","ignored"]);
  if (!allowed.has(status)) throw new Error("허용되지 않은 상태입니다.");
  await env.DB.prepare(`UPDATE jobs SET status=?, updated_at=? WHERE job_id=?`).bind(status, nowIso(), jobId).run();
}

function appHtml() {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Automation Factory · Job Scout</title>
<style>
:root{color-scheme:dark;--bg:#090f1d;--panel:#111a2c;--line:#26334d;--text:#f4f7fb;--muted:#98a5ba;--good:#39d98a;--warn:#ffca5c;--bad:#7f8da8;--accent:#6ea8fe}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#07101f,#0b1220);font-family:system-ui,-apple-system,sans-serif;color:var(--text)}
.wrap{max-width:1100px;margin:auto;padding:22px}.top{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:18px}.brand{font-size:25px;font-weight:800}.sub{color:var(--muted);font-size:13px}.badge{border:1px solid var(--line);padding:7px 10px;border-radius:999px;color:var(--muted);font-size:12px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.stat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:15px}.stat b{font-size:25px;display:block;margin-top:5px}
.controls{display:flex;gap:8px;flex-wrap:wrap;margin:15px 0}button{background:#17243b;color:white;border:1px solid #344564;border-radius:10px;padding:10px 13px;font-weight:700}button:hover{cursor:pointer;border-color:var(--accent)}button.active{background:#24497d}.seed{margin-left:auto;background:#183c2b}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:15px;margin:10px 0}.row{display:flex;justify-content:space-between;gap:12px}.title{font-size:16px;font-weight:800}.meta,.reason{color:var(--muted);font-size:12px;margin-top:7px}.desc{font-size:14px;line-height:1.55;margin-top:10px;color:#d8e0ec}.pill{white-space:nowrap;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800;height:max-content}.candidate{background:#123c2a;color:#6ff0ad}.review{background:#4a3914;color:#ffd772}.ignored{background:#252c39;color:#adb7c8}.new{background:#1c3760;color:#9bc3ff}.empty{text-align:center;color:var(--muted);padding:40px 5px}.footer{color:var(--muted);font-size:11px;text-align:center;margin-top:30px}@media(max-width:700px){.grid{grid-template-columns:repeat(2,1fr)}.row{display:block}.pill{display:inline-block;margin-top:8px}.seed{margin-left:0}}
</style>
</head>
<body><div class="wrap">
  <div class="top"><div><div class="brand">🔎 Job Scout</div><div class="sub">Automation Factory · 일감 검색 Agent 기준본</div></div><div class="badge">v${APP_VERSION}</div></div>
  <div class="grid">
    <div class="stat"><span class="sub">전체</span><b id="s-total">0</b></div>
    <div class="stat"><span class="sub">🟢 후보</span><b id="s-candidate">0</b></div>
    <div class="stat"><span class="sub">🟡 검토</span><b id="s-review">0</b></div>
    <div class="stat"><span class="sub">⚫ 제외</span><b id="s-ignored">0</b></div>
  </div>
  <div class="controls">
    <button class="active" data-status="all">전체</button>
    <button data-status="candidate">후보</button>
    <button data-status="review">검토</button>
    <button data-status="ignored">제외</button>
    <button class="seed" id="seedBtn">샘플 일감 넣기</button>
  </div>
  <div id="list"><div class="empty">불러오는 중…</div></div>
  <div class="footer">v0.1은 기준본입니다. 실제 일감 사이트 수집은 다음 버전에서 연결합니다.</div>
</div>
<script>
let current='all';
const esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
function money(a,b,c){if(a==null&&b==null)return ''; const f=n=>Number(n||0).toLocaleString(); return (a===b||!b?f(a):f(a)+' ~ '+f(b))+' '+(c||'');}
async function load(){
 const [sr,jr]=await Promise.all([fetch('/api/stats'),fetch('/api/jobs?status='+encodeURIComponent(current))]);
 const s=await sr.json(), jobs=await jr.json();
 ['total','candidate','review','ignored'].forEach(k=>document.getElementById('s-'+k).textContent=s[k]||0);
 const el=document.getElementById('list');
 if(!jobs.length){el.innerHTML='<div class="empty">표시할 일감이 없습니다.</div>';return;}
 el.innerHTML=jobs.map(function(j){
   var label=j.status==='candidate'?'후보':j.status==='review'?'검토':j.status==='ignored'?'제외':'신규';
   var budget=money(j.budget_min,j.budget_max,j.currency);
   var link=j.url?'<div class="meta"><a href="'+esc(j.url)+'" target="_blank" style="color:#9bc3ff">원문 보기</a></div>':'';
   return '<div class="card"><div class="row"><div><div class="title">'+esc(j.title)+'</div><div class="meta">'+esc(j.source)+' · '+esc(j.duration||'기간 미상')+(budget?' · '+budget:'')+'</div></div><span class="pill '+esc(j.status)+'">'+label+'</span></div><div class="desc">'+esc(j.description)+'</div><div class="reason">'+esc(j.classify_reason||'')+'</div>'+link+'</div>';
 }).join('');
}
document.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-status]').forEach(x=>x.classList.remove('active'));b.classList.add('active');current=b.dataset.status;load();});
document.getElementById('seedBtn').onclick=async()=>{const b=document.getElementById('seedBtn');b.disabled=true;b.textContent='추가 중…';try{const r=await fetch('/api/demo-seed',{method:'POST'});if(!r.ok)throw new Error(await r.text());await load();}catch(e){alert('샘플 추가 실패: '+e.message);}finally{b.disabled=false;b.textContent='샘플 일감 넣기';}};
load().catch(e=>document.getElementById('list').innerHTML='<div class="empty">오류: '+esc(e.message)+'</div>');
</script></body></html>`;
}

export default {
  async fetch(request, env) {
    try {
      await ensureSchema(env);
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/api/health") return json({ ok:true, app:"Job Scout", version:APP_VERSION, time:nowIso() });
      if (path === "/api/stats") return json(await getStats(env));
      if (path === "/api/jobs") return json(await listJobs(env, url));
      if (path === "/api/demo-seed" && request.method === "POST") return json({ ok:true, inserted:await seedDemo(env) });
      if (path.startsWith("/api/jobs/") && path.endsWith("/status") && request.method === "POST") {
        const jobId = decodeURIComponent(path.slice("/api/jobs/".length, -"/status".length));
        const body = await request.json();
        await updateStatus(env, jobId, String(body.status || ""));
        return json({ ok:true });
      }
      if (path.startsWith("/api/")) return json({ ok:false, error:"Not found" },404);
      return html(appHtml());
    } catch (e) {
      return json({ ok:false, error:e?.message || String(e), version:APP_VERSION },500);
    }
  }
};
