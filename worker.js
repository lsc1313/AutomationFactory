import { judgeOpportunity } from "./judge.js";
import { collectSources, SOURCE_REGISTRY, collectMarketplaceValidationEvidence } from "./sources.js";

const APP_VERSION = "0.18.0";
const APP_NAME = "Money Scout";

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

function nowIso() {
  return new Date().toISOString();
}

function safeId(source, sourceItemId) {
  return `${source}:${sourceItemId}`.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 240);
}

async function ensureSchema(env) {
  if (!env.DB) throw new Error("D1 binding DB가 없습니다. wrangler.jsonc의 DB 설정을 확인하세요.");

  // D1Database.exec()는 여러 쿼리를 줄바꿈으로 구분해 해석할 수 있어
  // 여러 줄 CREATE TABLE 문을 한 번에 넘기면 첫 줄만 잘려 실행될 수 있다.
  // 각 DDL을 완전한 prepared statement로 만든 뒤 batch()로 실행한다.
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS opportunities (
      opportunity_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_item_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'unknown',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      budget_min REAL,
      budget_max REAL,
      currency TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      skills TEXT NOT NULL DEFAULT '',
      posted_at TEXT NOT NULL DEFAULT '',
      deadline TEXT NOT NULL DEFAULT '',
      competition INTEGER,
      url TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 0,
      grade TEXT NOT NULL DEFAULT 'cold',
      score_breakdown TEXT NOT NULL DEFAULT '{}',
      judge_reason TEXT NOT NULL DEFAULT '',
      user_state TEXT NOT NULL DEFAULT 'unreviewed',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source, source_item_id)
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_opportunities_grade_score ON opportunities(grade, score DESC)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_opportunities_state_score ON opportunities(user_state, score DESC)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_opportunities_source_seen ON opportunities(source, last_seen_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scout_runs (
      run_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '',
      source_count INTEGER NOT NULL DEFAULT 0,
      found_count INTEGER NOT NULL DEFAULT 0,
      saved_count INTEGER NOT NULL DEFAULT 0,
      hot_count INTEGER NOT NULL DEFAULT 0,
      watch_count INTEGER NOT NULL DEFAULT 0,
      cold_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]'
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_scout_runs_started ON scout_runs(started_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sandbox_runs (
      run_id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      bundle_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'created',
      conclusion TEXT NOT NULL DEFAULT '',
      log_summary TEXT NOT NULL DEFAULT '',
      github_run_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_sandbox_runs_opportunity ON sandbox_runs(opportunity_id, created_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS production_runs (
      run_id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      bundle_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'created',
      conclusion TEXT NOT NULL DEFAULT '',
      log_summary TEXT NOT NULL DEFAULT '',
      github_run_id TEXT NOT NULL DEFAULT '',
      package_summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_production_runs_opportunity ON production_runs(opportunity_id, created_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS client_intakes (
      opportunity_id TEXT PRIMARY KEY,
      public_answers_json TEXT NOT NULL DEFAULT '{}',
      secret_answers_enc TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'not_started',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_client_intakes_status ON client_intakes(status, updated_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS opportunity_evidence (
      opportunity_id TEXT NOT NULL,
      evidence_key TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      app_id TEXT NOT NULL DEFAULT '',
      app_name TEXT NOT NULL DEFAULT '',
      evidence_kind TEXT NOT NULL DEFAULT '',
      evidence_quality TEXT NOT NULL DEFAULT '',
      complaint_bearing INTEGER NOT NULL DEFAULT 0,
      rating REAL,
      text TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      posted_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(opportunity_id, evidence_key)
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_evidence_opportunity ON opportunity_evidence(opportunity_id)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_candidates (
      fingerprint TEXT PRIMARY KEY,
      demand_group TEXT NOT NULL DEFAULT '',
      signal_count INTEGER NOT NULL DEFAULT 0,
      independent_repo_count INTEGER NOT NULL DEFAULT 0,
      promoted_signal_count INTEGER NOT NULL DEFAULT 0,
      raw_market_evidence_count INTEGER NOT NULL DEFAULT 0,
      competitor_count INTEGER NOT NULL DEFAULT 0,
      payment_evidence_count INTEGER NOT NULL DEFAULT 0,
      pricing_evidence_count INTEGER NOT NULL DEFAULT 0,
      weak_competitor_count INTEGER NOT NULL DEFAULT 0,
      commercialization_status TEXT NOT NULL DEFAULT 'validation_required',
      validation_missing TEXT NOT NULL DEFAULT '[]',
      representative_title TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_market_candidates_status ON market_candidates(commercialization_status, signal_count DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS opportunity_outcomes (
      opportunity_id TEXT PRIMARY KEY,
      result TEXT NOT NULL DEFAULT '',
      actual_revenue REAL,
      actual_cost REAL,
      actual_minutes INTEGER,
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )`)
  ]);
}


function adminAuthorized(request, env) {
  const configured = String(env.ADMIN_TOKEN || "").trim();
  if (!configured) return true;
  const supplied = String(request.headers.get("x-admin-token") || "").trim();
  return supplied === configured;
}

function requireAdmin(request, env) {
  if (!adminAuthorized(request, env)) {
    return json({ ok: false, error: "관리키가 맞지 않습니다." }, 401);
  }
  return null;
}

async function upsertOpportunity(env, raw) {
  const source = String(raw.source || "manual").trim();
  const sourceItemId = String(raw.source_item_id || crypto.randomUUID()).trim();
  const opportunityId = safeId(source, sourceItemId);
  const ts = nowIso();
  const normalized = {
    source,
    source_item_id: sourceItemId,
    type: String(raw.type || "unknown"),
    title: String(raw.title || "제목 없음").trim(),
    description: String(raw.description || "").trim(),
    budget_min: raw.budget_min ?? null,
    budget_max: raw.budget_max ?? null,
    currency: String(raw.currency || ""),
    location: String(raw.location || ""),
    skills: Array.isArray(raw.skills) ? raw.skills.join(", ") : String(raw.skills || ""),
    posted_at: String(raw.posted_at || ""),
    deadline: String(raw.deadline || ""),
    competition: raw.competition ?? raw.applicant_count ?? null,
    url: String(raw.url || "")
  };

  const judged = judgeOpportunity(normalized);

  await env.DB.prepare(`
    INSERT INTO opportunities (
      opportunity_id, source, source_item_id, type, title, description,
      budget_min, budget_max, currency, location, skills, posted_at, deadline,
      competition, url, score, grade, score_breakdown, judge_reason,
      user_state, first_seen_at, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unreviewed', ?, ?, ?)
    ON CONFLICT(source, source_item_id) DO UPDATE SET
      type=excluded.type,
      title=excluded.title,
      description=excluded.description,
      budget_min=excluded.budget_min,
      budget_max=excluded.budget_max,
      currency=excluded.currency,
      location=excluded.location,
      skills=excluded.skills,
      posted_at=excluded.posted_at,
      deadline=excluded.deadline,
      competition=excluded.competition,
      url=excluded.url,
      score=excluded.score,
      grade=excluded.grade,
      score_breakdown=excluded.score_breakdown,
      judge_reason=excluded.judge_reason,
      last_seen_at=excluded.last_seen_at,
      updated_at=excluded.updated_at
  `).bind(
    opportunityId,
    normalized.source,
    normalized.source_item_id,
    normalized.type,
    normalized.title,
    normalized.description,
    normalized.budget_min,
    normalized.budget_max,
    normalized.currency,
    normalized.location,
    normalized.skills,
    normalized.posted_at,
    normalized.deadline,
    normalized.competition,
    normalized.url,
    judged.score,
    judged.grade,
    JSON.stringify(judged.breakdown),
    judged.reason,
    ts,
    ts,
    ts
  ).run();

  if (Array.isArray(raw.evidence)) {
    await env.DB.prepare("DELETE FROM opportunity_evidence WHERE opportunity_id=?").bind(opportunityId).run();
    for (const [i, e] of raw.evidence.slice(0, 20).entries()) {
      const evidenceKey = String(e.evidence_id || e.app_id || e.url || i).slice(0, 300);
      await env.DB.prepare(`INSERT OR REPLACE INTO opportunity_evidence (
        opportunity_id,evidence_key,source,app_id,app_name,evidence_kind,evidence_quality,
        complaint_bearing,rating,text,url,posted_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        opportunityId,evidenceKey,String(e.marketplace||e.source||source),String(e.app_id||""),
        String(e.app_name||""),String(e.evidence_kind||""),String(e.evidence_quality||""),
        e.complaint_bearing ? 1 : 0,e.rating ?? null,String(e.text||"").slice(0,2000),
        String(e.url||""),String(e.posted_at||""),ts
      ).run();
    }
  }
  return { opportunity_id: opportunityId, ...judged };
}

async function runScout(env, sourceNames = null) {
  await ensureSchema(env);
  const runId = crypto.randomUUID();
  const started = nowIso();
  const names = Array.isArray(sourceNames) && sourceNames.length
    ? sourceNames.filter((x) => SOURCE_REGISTRY[x])
    : Object.keys(SOURCE_REGISTRY);

  await env.DB.prepare(`
    INSERT INTO scout_runs (run_id, started_at, source_count)
    VALUES (?, ?, ?)
  `).bind(runId, started, names.length).run();

  const collected = await collectSources(names);
  let found = 0;
  let saved = 0;
  let hot = 0;
  let watch = 0;
  let cold = 0;
  const sourceDiagnostics = {};

  for (const group of collected.results) {
    if (group.items?.diagnostics) sourceDiagnostics[group.source] = group.items.diagnostics;
    found += group.items.length;
    for (const item of group.items) {
      try {
        const r = await upsertOpportunity(env, item);
        saved += 1;
        if (r.grade === "hot") hot += 1;
        else if (r.grade === "watch") watch += 1;
        else cold += 1;
      } catch (error) {
        collected.errors.push({
          source: group.source,
          error: `저장 실패: ${error?.message || String(error)}`
        });
      }
    }
  }

  const finished = nowIso();
  await env.DB.prepare(`
    UPDATE scout_runs SET
      finished_at=?, found_count=?, saved_count=?, hot_count=?, watch_count=?, cold_count=?,
      error_count=?, errors_json=?
    WHERE run_id=?
  `).bind(
    finished,
    found,
    saved,
    hot,
    watch,
    cold,
    collected.errors.length,
    JSON.stringify([...collected.errors, ...Object.entries(sourceDiagnostics).map(([source, d]) => ({ source, diagnostic: d }))]),
    runId
  ).run();

  return {
    ok: true,
    run_id: runId,
    started_at: started,
    finished_at: finished,
    sources: names,
    found,
    saved,
    grades: { hot, watch, cold },
    errors: collected.errors,
    diagnostics: sourceDiagnostics
  };
}

async function crossValidateMarkets(env) {
  await ensureSchema(env);
  const raw = await collectMarketplaceValidationEvidence();
  const rows=(await env.DB.prepare(`SELECT opportunity_id,source,source_item_id,type,title,description,budget_min,budget_max,currency,location,skills,posted_at,deadline,competition,url FROM opportunities WHERE source='github_demand' ORDER BY last_seen_at DESC LIMIT 2000`).all()).results||[];
  const fp=v=>(String(v||"").match(/demand_fingerprint:([a-z0-9_-]+)/i)||[])[1]||"";
  const markets=new Map();
  for(const e of raw.evidence){
    const k=String(e.fingerprint||""); if(!k||k==="unclassified")continue;
    const m=markets.get(k)||{payment:0,pricing:0,competitors:new Set(),weak:0,evidence:0};
    const text=String(e.text||"");
    if(/(paid|pricing|price|plan|subscription|monthly|annual|per month|per year|\$\s*\d+|€\s*\d+|£\s*\d+)/i.test(text))m.payment++;
    if(/(\$|€|£)\s*\d+|\b\d+(?:\.\d+)?\s*(?:usd|eur|gbp)\b|per month|per year|\/month|\/year/i.test(text))m.pricing++;
    if(e.app_id)m.competitors.add(e.marketplace+":"+e.app_id);
    if(e.competitor_strength==="weak")m.weak++;
    m.evidence++;
    markets.set(k,m);
  }
  let matched=0,promoted=0;
  for(const r of rows){
    const k=fp(r.skills),m=markets.get(k); if(!k||!m)continue;
    matched++;
    const base=String(r.skills||"").replace(/,?\s*(payment_evidence|pricing_evidence|competitor_evidence|weak_competitor_signals|cross_market_validation):[^,]+/gi,"").replace(/^,\s*|,\s*$/g,"");
    r.skills=[base,"payment_evidence:"+m.payment,"pricing_evidence:"+m.pricing,"competitor_evidence:"+m.competitors.size,"weak_competitor_signals:"+m.weak,"cross_market_validation:yes"].filter(Boolean).join(", ");
    const j=judgeOpportunity(r);
    if(j.breakdown?.commercialization_status==="commercialization_candidate")promoted++;
    await env.DB.prepare(`UPDATE opportunities SET skills=?,score=?,grade=?,score_breakdown=?,judge_reason=?,updated_at=? WHERE opportunity_id=?`).bind(r.skills,j.score,j.grade,JSON.stringify(j.breakdown),j.reason,nowIso(),r.opportunity_id).run();
  }
  const clusters=new Map();
  for(const r of rows){
    const k=fp(r.skills); if(!k||k==="unclassified")continue;
    let bd={}; try{bd=JSON.parse((await env.DB.prepare("SELECT score_breakdown FROM opportunities WHERE opportunity_id=?").bind(r.opportunity_id).first())?.score_breakdown||"{}");}catch{}
    const c=clusters.get(k)||{fingerprint:k,demand_group:bd.demand_group||"",signals:0,repos:new Set(),promoted:0,title:r.title||"",missing:new Set()};
    c.signals++;
    const repo=String(r.source_item_id||"").split("#")[0]; if(repo)c.repos.add(repo);
    if(bd.commercialization_status==="commercialization_candidate")c.promoted++;
    for(const x of (Array.isArray(bd.validation_missing)?bd.validation_missing:[]))c.missing.add(x);
    clusters.set(k,c);
  }
  for(const [k,c] of clusters){
    const m=markets.get(k)||{payment:0,pricing:0,competitors:new Set(),weak:0,evidence:0};
    const verifiedMissing=[];
    if(c.repos.size<2) verifiedMissing.push("independent_demand");
    if(m.evidence<2) verifiedMissing.push("market_evidence");
    if(m.payment<1) verifiedMissing.push("payment");
    if(m.pricing<1) verifiedMissing.push("pricing");
    if(m.competitors.size<1) verifiedMissing.push("buyer_market");
    const verifiedMoney=verifiedMissing.length===0 && c.promoted>0;
    const status=verifiedMoney?"verified_money":"validation_required";
    const combinedMissing=new Set([...c.missing,...verifiedMissing]);
    await env.DB.prepare(`INSERT INTO market_candidates (
      fingerprint,demand_group,signal_count,independent_repo_count,promoted_signal_count,
      raw_market_evidence_count,competitor_count,payment_evidence_count,pricing_evidence_count,
      weak_competitor_count,commercialization_status,validation_missing,representative_title,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      demand_group=excluded.demand_group,signal_count=excluded.signal_count,
      independent_repo_count=excluded.independent_repo_count,promoted_signal_count=excluded.promoted_signal_count,
      raw_market_evidence_count=excluded.raw_market_evidence_count,competitor_count=excluded.competitor_count,
      payment_evidence_count=excluded.payment_evidence_count,pricing_evidence_count=excluded.pricing_evidence_count,
      weak_competitor_count=excluded.weak_competitor_count,commercialization_status=excluded.commercialization_status,
      validation_missing=excluded.validation_missing,representative_title=excluded.representative_title,updated_at=excluded.updated_at
    `).bind(k,c.demand_group,c.signals,c.repos.size,c.promoted,m.evidence,m.competitors.size,m.payment,m.pricing,m.weak,status,JSON.stringify([...combinedMissing]),c.title,nowIso()).run();
  }
  const marketCandidates=[...clusters.values()].filter(c=>c.promoted>0).length;
  return {ok:true,matched,promoted,market_candidates:marketCandidates,cluster_count:clusters.size,market_fingerprints:markets.size,raw_evidence:raw.evidence.length,diagnostics:raw.diagnostics};
}

async function runMoneyPipeline(env) {
  await ensureSchema(env);
  const scan = await runScout(env);
  const rejudge = await rejudgeAll(env);
  const validation = await crossValidateMarkets(env);
  return {
    ok: true,
    mode: "autopilot",
    scan: { found: scan.found, saved: scan.saved, errors: scan.errors?.length || 0 },
    rejudge: { count: rejudge.rejudged, grades: rejudge.grades },
    validation: {
      raw_evidence: validation.raw_evidence,
      matched: validation.matched,
      promoted: validation.promoted,
      market_candidates: validation.market_candidates
    },
    finished_at: nowIso()
  };
}

async function rejudgeAll(env) {
  const rows = (await env.DB.prepare(`
    SELECT opportunity_id, source, source_item_id, type, title, description,
           budget_min, budget_max, currency, location, skills, posted_at, deadline,
           competition, url
    FROM opportunities
    ORDER BY last_seen_at DESC
    LIMIT 2000
  `).all()).results || [];

  let hot = 0, watch = 0, cold = 0;
  const statements = [];
  for (const row of rows) {
    const judged = judgeOpportunity(row);
    if (judged.grade === "hot") hot++;
    else if (judged.grade === "watch") watch++;
    else cold++;
    statements.push(env.DB.prepare(`
      UPDATE opportunities
      SET score=?, grade=?, score_breakdown=?, judge_reason=?, updated_at=?
      WHERE opportunity_id=?
    `).bind(
      judged.score,
      judged.grade,
      JSON.stringify(judged.breakdown),
      judged.reason,
      nowIso(),
      row.opportunity_id
    ));
  }

  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }

  return { ok: true, rejudged: rows.length, grades: { hot, watch, cold }, judge: "marketplace-evidence-v0.4.5" };
}

async function rebuildMarketplace(env) {
  await ensureSchema(env);

  // Delete only legacy, unreviewed marketplace aggregates. Explicit user decisions
  // are preserved even when the old evidence is no longer reproducible.
  const stale = await env.DB.prepare(`
    SELECT opportunity_id
    FROM opportunities
    WHERE source='marketplace_demand'
      AND user_state='unreviewed'
      AND description NOT LIKE '[MARKETPLACE EVIDENCE v0.4.6]%'
  `).all();
  const staleIds = (stale.results || []).map((x) => x.opportunity_id);

  for (let i = 0; i < staleIds.length; i += 50) {
    await env.DB.batch(staleIds.slice(i, i + 50).map((id) =>
      env.DB.prepare(`DELETE FROM opportunities WHERE opportunity_id=? AND source='marketplace_demand' AND user_state='unreviewed'`).bind(id)
    ));
  }

  // Recollect only Marketplace Demand under the current evidence-integrity rules.
  const scan = await runScout(env, ["marketplace_demand"]);
  const keptDecisions = await env.DB.prepare(`
    SELECT COUNT(*) c FROM opportunities
    WHERE source='marketplace_demand' AND user_state<>'unreviewed'
  `).first();

  return {
    ok: true,
    removed_legacy_unreviewed: staleIds.length,
    preserved_decisions: Number(keptDecisions?.c || 0),
    scan
  };
}

async function getStats(env) {
  const total = await env.DB.prepare(`SELECT COUNT(*) c FROM opportunities`).first();
  const byGrade = await env.DB.prepare(`SELECT grade, COUNT(*) c FROM opportunities GROUP BY grade`).all();
  const byState = await env.DB.prepare(`SELECT user_state, COUNT(*) c FROM opportunities GROUP BY user_state`).all();
  const lastRun = await env.DB.prepare(`SELECT * FROM scout_runs ORDER BY started_at DESC LIMIT 1`).first();

  const grades = { hot: 0, watch: 0, cold: 0 };
  for (const row of byGrade.results || []) grades[row.grade] = Number(row.c || 0);
  const states = { unreviewed: 0, proceed: 0, hold: 0, reject: 0 };
  for (const row of byState.results || []) states[row.user_state] = Number(row.c || 0);

  return {
    total: Number(total?.c || 0),
    ...grades,
    states,
    last_run: lastRun || null
  };
}

async function listOpportunities(env, url) {
  const grade = url.searchParams.get("grade") || "all";
  const state = url.searchParams.get("state") || "all";
  const source = url.searchParams.get("source") || "all";
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 60)));

  const where = [];
  const binds = [];
  if (grade !== "all") { where.push("grade=?"); binds.push(grade); }
  if (state !== "all") { where.push("user_state=?"); binds.push(state); }
  if (source !== "all") { where.push("source=?"); binds.push(source); }

  let q = `SELECT * FROM opportunities`;
  if (where.length) q += ` WHERE ${where.join(" AND ")}`;
  q += ` ORDER BY score DESC, COALESCE(NULLIF(posted_at,''), last_seen_at) DESC LIMIT ?`;
  binds.push(limit);

  return (await env.DB.prepare(q).bind(...binds).all()).results || [];
}

async function setDecision(env, opportunityId, state) {
  const allowed = new Set(["unreviewed", "proceed", "hold", "reject"]);
  if (!allowed.has(state)) throw new Error("허용되지 않은 상태입니다.");
  await env.DB.prepare(`
    UPDATE opportunities SET user_state=?, updated_at=? WHERE opportunity_id=?
  `).bind(state, nowIso(), opportunityId).run();
}

function intakeField(id,label,type="text",required=false,secret=false,help="",options=[]) {
  return {id,label,type,required,secret,help,options};
}

function clientIntakeSpec(row, plan=null) {
  const raw=(String(row?.title||"")+" "+String(row?.description||"")+" "+String(row?.skills||"")).toLowerCase();
  const korean=((String(row?.title||"")+" "+String(row?.description||"")).match(/[가-힣]/g)||[]).length>20;
  const fields=[], seen=new Set();
  const add=(f)=>{if(!seen.has(f.id)){seen.add(f.id);fields.push(f)}};
  const yesNo=[{value:"yes",label:korean?"예":"Yes"},{value:"no",label:korean?"아니오":"No"}];
  if(/squarespace/.test(raw)){
    add(intakeField("squarespace_access_confirmed",korean?"Squarespace 접근 권한 준비 여부":"Squarespace access available","select",true,false,"",yesNo));
    add(intakeField("squarespace_token",korean?"Squarespace API 토큰":"Squarespace API token","password",true,true,korean?"암호화 저장되며 화면/API에 다시 표시하지 않습니다.":"Encrypted at rest and never returned by the UI/API."));
    add(intakeField("product_scope",korean?"이전할 상품 범위":"Product scope to migrate","textarea",true,false,korean?"전체 상품 또는 상품명/ID/SKU 범위를 적어주세요.":"Specify all products or the product IDs/SKUs to migrate."));
  }
  if(/etsy/.test(raw)){
    add(intakeField("etsy_shop_status",korean?"Etsy 상점 상태":"Etsy shop status","select",true,false,"",[{value:"existing",label:korean?"이미 생성됨":"Already created"},{value:"needs_setup",label:korean?"생성/초기설정 필요":"Needs setup"}]));
    add(intakeField("etsy_shop_id",korean?"Etsy Shop ID":"Etsy Shop ID","text",true,false));
    add(intakeField("etsy_oauth_token",korean?"Etsy OAuth 토큰":"Etsy OAuth token","password",true,true,korean?"암호화 저장 · 결과 ZIP에는 포함되지 않습니다.":"Encrypted at rest; never included in the output ZIP."));
    add(intakeField("etsy_api_key",korean?"Etsy API Key":"Etsy API key","password",true,true,korean?"암호화 저장 · 결과 ZIP에는 포함되지 않습니다.":"Encrypted at rest; never included in the output ZIP."));
    add(intakeField("etsy_taxonomy_id",korean?"Etsy Taxonomy ID":"Etsy taxonomy ID","text",true,false));
    add(intakeField("etsy_shipping_profile_id",korean?"Etsy Shipping Profile ID":"Etsy shipping profile ID","text",true,false));
    add(intakeField("etsy_readiness_state_id",korean?"Etsy Readiness State ID":"Etsy readiness state ID","text",true,false));
    add(intakeField("etsy_section_id",korean?"Etsy Section ID (선택)":"Etsy section ID (optional)","text",false,false));
  }
  if(/prodigi/.test(raw)){
    add(intakeField("prodigi_api_key",korean?"Prodigi API Key":"Prodigi API key","password",true,true,korean?"먼저 Sandbox 키를 권장합니다.":"A Sandbox key is recommended first."));
    add(intakeField("prodigi_mode",korean?"Prodigi 검수 환경":"Prodigi validation mode","select",true,false,"",[{value:"sandbox",label:"Sandbox"},{value:"live_after_approval",label:korean?"Sandbox 통과 후 Live":"Live after Sandbox approval"}]));
    add(intakeField("prodigi_sku_mapping",korean?"SKU → Prodigi 상품/템플릿 매핑":"SKU → Prodigi product/template mapping","textarea",true,false,korean?"예: SKU별 Prodigi product ID, print area, 옵션 매핑":"Provide Prodigi product ID, print area and options per SKU."));
  }
  if(/tax|shipping/.test(raw)||/etsy/.test(raw)){
    add(intakeField("shipping_regions",korean?"판매/배송 대상 지역":"Target shipping regions","textarea",true,false,korean?"예: 미국 본토 전체, 제외 지역 등":"Example: continental US and excluded regions."));
    add(intakeField("shipping_policy",korean?"배송 정책":"Shipping policy","textarea",true,false));
    add(intakeField("tax_policy",korean?"세금 처리 기준":"Tax handling preference","textarea",true,false,korean?"플랫폼 자동 처리 여부 등":"State whether platform-managed tax rules should be used."));
  }
  if(/excel|spreadsheet|workbook|google sheets|sheet/.test(raw)){
    add(intakeField("source_data",korean?"원본 데이터/파일 위치":"Source data/file location","textarea",true,false,korean?"파일명, Drive 링크 또는 데이터 구조 설명":"File name, Drive link, or data-structure description."));
    add(intakeField("workbook_requirements",korean?"시트/수식/대시보드 요구사항":"Workbook/formula/dashboard requirements","textarea",true,false));
    add(intakeField("output_format",korean?"최종 납품 형식":"Final delivery format","select",true,false,"",[{value:"xlsx",label:"Excel .xlsx"},{value:"google_sheets",label:"Google Sheets"},{value:"xlsx_and_pdf",label:"Excel + PDF"}]));
    add(intakeField("sample_style",korean?"원하는 디자인/예시":"Preferred design/reference","textarea",false,false));
  }
  if(/api|integration|integrate|webhook/.test(raw) && !(/squarespace|etsy|prodigi/.test(raw))){
    add(intakeField("api_docs_url",korean?"연동 API 문서 URL":"API documentation URL","text",true,false));
    add(intakeField("sample_payload",korean?"샘플 입력/출력 또는 요청·응답":"Sample input/output or request/response","textarea",true,false));
    add(intakeField("integration_credentials",korean?"연동 인증정보":"Integration credentials","password",true,true,korean?"암호화 저장되며 제작 ZIP에는 들어가지 않습니다.":"Encrypted at rest and excluded from the production ZIP."));
  }
  const questions=plan?.clarification_questions||[];
  for(const [i,q] of questions.entries()){const qt=String(q).toLowerCase();if(/squarespace/.test(qt)&&fields.some(f=>f.id==="squarespace_access_confirmed"))continue;if(/etsy/.test(qt)&&fields.some(f=>f.id==="etsy_shop_status"))continue;if(/prodigi/.test(qt)&&fields.some(f=>f.id==="prodigi_api_key"))continue;if(/tax|shipping/.test(qt)&&fields.some(f=>f.id==="shipping_policy"))continue;if(/delivery|deadline|납기|마감/.test(qt))continue;const id="clarification_"+(i+1);add(intakeField(id,String(q),"textarea",true,false));}
  add(intakeField("delivery_date",korean?"희망 납기일":"Preferred delivery date","text",!String(row?.deadline||"").trim(),false));
  add(intakeField("client_notes",korean?"추가 메모":"Additional client notes","textarea",false,false));
  return {intake_version:"client-intake-v1",language:korean?"ko":"en",job_id:row?.opportunity_id||"",title:row?.title||"",fields};
}

function clientRequestMessage(row,spec) {
  const ko=spec.language==="ko", required=spec.fields.filter(f=>f.required);
  const lines=required.map((f,i)=>(i+1)+". "+f.label+(f.secret?(ko?" (보안정보)":" (secure credential)"):""));
  if(ko)return "작업 시작을 위해 아래 정보를 부탁드립니다.\n"+lines.join("\n")+"\n보안정보는 작업용 보안 입력란으로만 받고 결과 파일에는 포함하지 않습니다.";
  return "To start the project, please provide the following:\n"+lines.join("\n")+"\nSecure credentials are stored only in the protected intake vault and are never included in delivery files.";
}

function bytesToBase64(bytes) { let s=""; for(const b of bytes)s+=String.fromCharCode(b); return btoa(s); }
function base64ToBytes(s) { const raw=atob(s), out=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i); return out; }
async function clientVaultKey(env) {
  const material=String(env.SANDBOX_CALLBACK_TOKEN||""); if(!material)return null;
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("AutomationFactory-ClientVault-v1:"+material));
  return crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function encryptClientSecrets(env,obj) {
  if(!obj||!Object.keys(obj).length)return ""; const key=await clientVaultKey(env); if(!key)throw new Error("Client vault key unavailable");
  const iv=crypto.getRandomValues(new Uint8Array(12)), data=new TextEncoder().encode(JSON.stringify(obj));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,data));
  return "v1."+bytesToBase64(iv)+"."+bytesToBase64(encrypted);
}
async function decryptClientSecrets(env,cipher) {
  if(!cipher)return {}; const parts=String(cipher).split("."); if(parts.length!==3||parts[0]!=="v1")return {};
  const key=await clientVaultKey(env); if(!key)throw new Error("Client vault key unavailable");
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:base64ToBytes(parts[1])},key,base64ToBytes(parts[2]));
  return JSON.parse(new TextDecoder().decode(plain));
}
function intakeCompletion(spec,publicAnswers,secrets) {
  const missing=[]; for(const f of spec.fields||[]){if(!f.required)continue;const v=f.secret?secrets?.[f.id]:publicAnswers?.[f.id];if(v==null||String(v).trim()==="")missing.push(f.id)}
  const required=(spec.fields||[]).filter(f=>f.required).length; return {status:missing.length?"collecting":"ready_for_build",missing,required,complete:required-missing.length};
}
async function getClientIntake(env,row,plan=null) {
  const spec=clientIntakeSpec(row,plan), saved=await env.DB.prepare("SELECT * FROM client_intakes WHERE opportunity_id=?").bind(row.opportunity_id).first();
  let publicAnswers={}, secrets={};
  if(saved){try{publicAnswers=JSON.parse(saved.public_answers_json||"{}")}catch{} try{secrets=await decryptClientSecrets(env,saved.secret_answers_enc||"")}catch{}}
  const completion=intakeCompletion(spec,publicAnswers,secrets), secretPresent={}; for(const f of spec.fields||[])if(f.secret)secretPresent[f.id]=Boolean(secrets[f.id]);
  return {ok:true,spec,answers:publicAnswers,secret_present:secretPresent,status:completion.status,completion,request_message:clientRequestMessage(row,spec),updated_at:saved?.updated_at||null};
}
async function saveClientIntake(env,row,plan,body) {
  const spec=clientIntakeSpec(row,plan), allowed=new Map(spec.fields.map(f=>[f.id,f]));
  const existing=await env.DB.prepare("SELECT * FROM client_intakes WHERE opportunity_id=?").bind(row.opportunity_id).first();
  let publicAnswers={}, secrets={};
  if(existing){try{publicAnswers=JSON.parse(existing.public_answers_json||"{}")}catch{} try{secrets=await decryptClientSecrets(env,existing.secret_answers_enc||"")}catch{}}
  const incoming=body?.answers&&typeof body.answers==="object"?body.answers:{};
  for(const [id,value] of Object.entries(incoming)){const fld=allowed.get(id);if(!fld)continue;const v=String(value??"").trim();if(fld.secret){if(v)secrets[id]=v}else publicAnswers[id]=v}
  const completion=intakeCompletion(spec,publicAnswers,secrets), ts=nowIso(), encrypted=await encryptClientSecrets(env,secrets);
  const sql="INSERT INTO client_intakes(opportunity_id,public_answers_json,secret_answers_enc,status,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(opportunity_id) DO UPDATE SET public_answers_json=excluded.public_answers_json,secret_answers_enc=excluded.secret_answers_enc,status=excluded.status,updated_at=excluded.updated_at";
  await env.DB.prepare(sql).bind(row.opportunity_id,JSON.stringify(publicAnswers),encrypted,completion.status,existing?.created_at||ts,ts).run();
  const secretPresent={}; for(const fld of spec.fields||[])if(fld.secret)secretPresent[fld.id]=Boolean(secrets[fld.id]);
  return {ok:true,status:completion.status,completion,answers:publicAnswers,secret_present:secretPresent,request_message:clientRequestMessage(row,spec),updated_at:ts};
}

function paidJobPlan(row) {
  let bd={}; try{bd=JSON.parse(row.score_breakdown||"{}")}catch{}
  const raw=String(row.title||"")+" "+String(row.description||""), desc=String(row.description||"");
  const text=raw.toLowerCase(), korean=(raw.match(/[가-힣]/g)||[]).length>20;
  const requirements=[]; const addReq=(test,en,ko)=>{if(test)requirements.push(korean?ko:en)};
  // Manager v2: domain/workflow requirements from the actual client brief, before generic technical support.
  addReq(/squarespace/.test(text)&&/(export|migrat|move|transfer|jump)/.test(text),"Export the selected products from Squarespace with existing copy, imagery, pricing and variants","Squarespace 선택 상품의 설명·이미지·가격·옵션을 함께 추출");
  addReq(/etsy/.test(text)&&/(listing|listings|shop)/.test(text),"Create the Etsy listings with required sections, shipping profiles and attributes","Etsy 상품 등록 및 섹션·배송 프로필·필수 속성 구성");
  addReq(/image/.test(text)&&/(dimension|optim|re-format|reformat)/.test(text),"Reformat and optimize product assets for Etsy image, title, tag and SEO requirements","Etsy 이미지·제목·태그·SEO 기준에 맞게 상품 자산 최적화");
  addReq(/prodigi/.test(text)&&/(connect|mapping|map|fulfil|fulfill)/.test(text),"Connect Etsy to Prodigi and map each product to the correct print-on-demand template","Etsy와 Prodigi를 연결하고 각 상품을 올바른 POD 템플릿에 매핑");
  addReq(/workflow/.test(text)&&/etsy/.test(text)&&/prodigi/.test(text),"Test the end-to-end Squarespace → Etsy → Prodigi order/fulfilment workflow","Squarespace → Etsy → Prodigi 전체 주문·이행 흐름 테스트");
  addReq(/tax/.test(text)&&/shipping/.test(text),"Configure and verify US-targeted tax and shipping settings within the supported platform options","지원 범위 내 미국 판매용 세금·배송 설정 구성 및 확인");
  addReq(/hand.?over|step-by-step guide|future updates/.test(text),"Provide concise hand-over instructions for editing products and adding future listings","향후 상품 수정·추가를 위한 인수인계 가이드 제공");
  addReq(/csv|json|bulk migration|bulk upload/.test(text),"Use an appropriate bulk migration/import path (API, CSV or JSON) where it improves speed and accuracy","속도·정확도를 위해 적절한 대량 이전 방식(API/CSV/JSON) 적용");
  addReq(/slot|availability/.test(text)&&/(monitor|check|page)/.test(text),"Monitor the target slot/availability page at the requested interval","요청 주기로 슬롯/가용성 페이지 감시");
  addReq(/slot|availability/.test(text)&&/telegram/.test(text),"Send Telegram alerts immediately when the requested availability state changes","가용성 상태 변경 즉시 Telegram 알림");
  addReq(/retry|resilien|robust/.test(text),"Add retry, error handling and recovery for transient failures","일시 오류에 대한 재시도·오류처리·복구 구성");
  if(!requirements.length){
    addReq(/scrap|crawl|monitor/.test(text),"Implement the requested web data/monitoring workflow","요청된 웹 데이터/모니터링 흐름 구현");
    addReq(/api|integration|integrate/.test(text),"Implement the requested service/API integration","요청된 서비스/API 연동 구현");
  }
  if(!requirements.length) requirements.push(korean?"의뢰문에 명시된 핵심 결과물을 실행 가능한 형태로 구현":"Implement the concrete deliverable described in the client brief");
  const deliverables=[...new Set(requirements)].slice(0,10);
  if(!deliverables.some(x=>/hand-over|guide|인수인계/.test(x))) deliverables.push(korean?"설치·운영·검수 및 인수인계 안내":"Setup, operation, acceptance-test and hand-over instructions");
  const q=[]; const ask=(needed,answered,en,ko)=>{if(needed&&!answered)q.push(korean?ko:en)};
  ask(/squarespace/.test(text),/credentials.+(?:shared|provided|supply)|(?:share|provide|supply).+credentials/.test(text),"Please confirm the Squarespace access/permissions to be provided at project start.","프로젝트 시작 시 제공할 Squarespace 접근 권한을 확인해주세요.");
  ask(/prodigi/.test(text)&&/api/.test(text),/(?:api keys?|credentials).+(?:shared|provided|supply)|(?:share|provide|supply).+(?:api keys?|credentials)/.test(text),"Please confirm the Prodigi API credentials/access available for testing.","Prodigi 테스트용 API 접근정보를 확인해주세요.");
  ask(/etsy/.test(text),/etsy.+(?:credentials|access).+(?:shared|provided)|(?:share|provide).+etsy.+(?:credentials|access)/.test(text),"Please confirm Etsy shop access and whether the shop is already created/configured.","Etsy 상점 접근 권한과 상점 생성/초기설정 여부를 확인해주세요.");
  ask(/tax/.test(text)&&/shipping/.test(text),false,"Please confirm the target US shipping regions, shipping policy, and whether tax settings should follow Etsy's platform-managed rules.","미국 판매 대상 지역·배송 정책과 세금 설정 기준을 확인해주세요.");
  if(!/deadline|deliver by|within \d+ (?:day|hour)|납기|마감/.test(text)) q.push(korean?"원하는 납기일을 알려주세요.":"What is your preferred delivery date?");
  const questions=[...new Set(q)].slice(0,4);
  const complexity=Math.min(5,Math.max(1,Math.ceil((deliverables.length+questions.length)/3))), hours=[0,2,4,8,16,28][complexity];
  const externalCostKnown=/no external cost|no paid service|no paid api|no additional cost|without paid services|외부비용 없음|추가 비용 없음/.test(text);
  const externalCost=externalCostKnown?0:null, externalCostStatus=externalCostKnown?"source_indicates_none":"needs_validation";
  const risks=[]; if(/credentials|api key|account|shop/.test(text))risks.push(korean?"외부 계정·권한 의존":"external account/access dependency"); if(/tax/.test(text))risks.push(korean?"세금 설정 범위 확인 필요":"tax configuration scope"); if(/bulk|11-50|\d+\s*(?:products|items)/.test(text))risks.push(korean?"대량 데이터 이전 검수":"bulk migration validation");
  const risk=risks.length>=2?"medium":risks.length?"low":"low";
  const scopeText=deliverables.slice(0,6).join(korean?" → ":"; ");
  const proposal=korean?`안녕하세요. 의뢰문 기준으로 ${scopeText} 범위로 진행할 수 있습니다. 시작 전에는 ${questions.join(" ")} 를 확인하겠습니다. 범위 확정 후 구현·이전·통합 테스트를 진행하고 검수 가능한 결과물과 인수인계 안내를 함께 납품하겠습니다. 현재 명세 기준 예상 작업시간은 약 ${hours}시간이며 외부 서비스 비용은 ${externalCostKnown?"원문상 별도 비용 없음":"사용 계정·서비스 조건 확인 후 확정"}입니다.`:`Hello, I can deliver the requested scope covering: ${scopeText}. Before starting, I would confirm: ${questions.join(" ")} After scope confirmation, I will implement/migrate the requested workflow, test the end-to-end result, and provide the completed deliverable with hand-over instructions. Based on the current brief, I estimate about ${hours} hours of work. External service cost will be confirmed from the actual account/service requirements.`;
  const buildSpec={spec_version:"factory-build-spec-v2",job_id:row.opportunity_id,title:row.title||"",language:korean?"ko":"en",objective:deliverables[0],functional_requirements:deliverables,open_questions:questions,acceptance_criteria:deliverables.slice(0,Math.min(6,deliverables.length)),target_runtime:null,estimated_build_hours:hours,external_cost_status:externalCostStatus,external_cost:externalCost,risk_level:risk,risk_factors:risks,source_url:row.url||""};
  const inputDiagnostics={title:String(row.title||""),description:desc,description_length:desc.length,skills:String(row.skills||""),url:String(row.url||""),analysis_text_length:raw.length,analysis_preview:raw.slice(0,700)};
  return {manager_version:"paid-job-manager-v2.0",input_diagnostics:inputDiagnostics,status:"needs_user_approval",detected_language:korean?"ko":"en",implementation_plan:deliverables,deliverables,requested_functions:deliverables,clarification_questions:questions,estimated_build_hours:hours,estimated_external_cost:externalCost,external_cost_status:externalCostStatus,delivery_risk:risk,risk_factors:risks,build_spec:buildSpec,proposal_draft:proposal,application_url:row.url||""};
}

function factoryBuilder(plan) {
  const req=plan?.build_spec?.functional_requirements||[], joined=req.join(" ").toLowerCase();
  const tasks=[]; let n=0;
  const add=(worker,title,outputs=[],gate=null)=>tasks.push({id:"T"+String(++n).padStart(2,"0"),worker,title,outputs,status:gate?"blocked_by_client_access":"ready_for_build",blocked_by:gate});
  if(/squarespace/.test(joined)) add("data-migration-worker","Extract and normalize selected Squarespace product data",["normalized product dataset","asset manifest"],"Squarespace authorized access");
  if(/etsy/.test(joined)&&/(listing|sections|shipping profiles|attributes)/.test(joined)) add("commerce-integration-worker","Prepare and create Etsy listing payloads, sections, shipping profiles and attributes",["Etsy listing payloads","listing creation report"],"Etsy shop authorized access");
  if(/image|seo|title|tag/.test(joined)) add("content-transform-worker","Transform product imagery and listing metadata to Etsy constraints",["optimized assets","title/tag/SEO mapping"]);
  if(/prodigi/.test(joined)) add("pod-integration-worker","Map Etsy products to Prodigi POD templates and integration flow",["product-template mapping","integration configuration"],"Prodigi API credentials");
  if(/tax|shipping/.test(joined)) add("commerce-config-worker","Apply agreed US-targeted shipping and platform tax configuration",["shipping configuration checklist","platform tax-setting record"],"client-approved shipping/tax configuration");
  if(/workflow|fulfil|fulfill|end-to-end/.test(joined)) add("integration-test-worker","Run end-to-end migration/listing/order-flow acceptance tests",["acceptance test report"],"required external accounts/test access");
  add("documentation-worker","Produce setup, operation and hand-over documentation",["handover guide","future-update procedure"]);
  if(tasks.length===1) add("implementation-worker","Implement the functional requirements from the Manager build spec",["runnable deliverable"]);
  return {builder_version:"factory-builder-v1",source_spec_version:plan?.build_spec?.spec_version||null,status:"blueprint_ready",execution_policy:"user_approval_required_before_external_actions",tasks,workers:[...new Set(tasks.map(x=>x.worker))],ready_tasks:tasks.filter(x=>x.status==="ready_for_build").length,blocked_tasks:tasks.filter(x=>x.status==="blocked_by_client_access").length,qc:{required:true,checks:["All Manager acceptance criteria mapped to deliverables","No external action performed without required authorization","End-to-end acceptance evidence captured before delivery"]}};
}

function workerExecutionPlan(plan) {
  const fb=plan?.factory_builder||factoryBuilder(plan), jobs=(fb.tasks||[]).map(t=>{
    const safe=t.status==="ready_for_build";
    const recipes={
      "content-transform-worker":["Define deterministic image/title/tag transformation rules","Prepare reusable transformation templates","Create fixture-based validation cases"],
      "documentation-worker":["Generate hand-over document outline from Manager requirements","Map each requirement to operation/update instructions","Prepare acceptance checklist"],
      "implementation-worker":["Create project skeleton","Implement requirements as isolated modules","Add automated tests and run instructions"]
    };
    return {task_id:t.id,worker:t.worker,title:t.title,state:safe?"queued_internal_build":"waiting_for_client_access",external_action_allowed:false,recipe:safe?(recipes[t.worker]||["Prepare implementation design and fixtures","Build locally without external side effects","Produce testable artifact for QC"]):[],expected_outputs:t.outputs||[],blocked_by:t.blocked_by||null};
  });
  return {execution_version:"worker-execution-v1",mode:"safe_internal_only",status:"execution_plan_ready",jobs,queued_internal_builds:jobs.filter(x=>x.state==="queued_internal_build").length,waiting_for_client_access:jobs.filter(x=>x.state==="waiting_for_client_access").length,next_gate:"user_approval_before_any_external_action",note:"This stage prepares internal build artifacts only; it does not contact clients, log into client accounts, publish listings, or submit work."};
}

function buildRuntime(plan) {
  const wx=plan?.worker_execution||workerExecutionPlan(plan);
  const artifacts=[];
  for(const j of wx.jobs||[]){
    if(j.state!=="queued_internal_build") continue;
    const base=(j.worker||"worker").replace(/-worker$/,"").replace(/[^a-z0-9-]/g,"-");
    for(const [idx,name] of (j.expected_outputs||["build artifact"]).entries()){
      const ext=/guide|procedure|checklist|report|instructions|mapping/i.test(name)?".md":/dataset|manifest|payload|configuration/i.test(name)?".json":".txt";
      artifacts.push({artifact_id:j.task_id+"-A"+String(idx+1).padStart(2,"0"),task_id:j.task_id,worker:j.worker,name,path:"artifacts/"+j.task_id.toLowerCase()+"/"+base+"-"+String(idx+1).padStart(2,"0")+ext,type:ext.slice(1),status:"planned_internal_artifact",external_side_effect:false});
    }
  }
  return {runtime_version:"build-runtime-v1",mode:"artifact_manifest_only",status:artifacts.length?"artifact_manifest_ready":"waiting_for_buildable_tasks",artifacts,artifact_count:artifacts.length,external_side_effects:false};
}

function artifactGenerator(plan) {
  const rt=plan?.build_runtime||buildRuntime(plan), req=plan?.build_spec?.functional_requirements||[];
  const generated=(rt.artifacts||[]).map(a=>{
    let content="";
    if(a.type==="json") content=JSON.stringify({artifact_id:a.artifact_id,purpose:a.name,source_requirements:req,status:"template_ready",external_side_effects:false},null,2);
    else if(a.type==="md") content="# "+a.name+"\n\n## Source requirements\n"+req.map(x=>"- "+x).join("\n")+"\n\n## Safety\n- Internal draft only\n- External account actions require user approval\n\n## Acceptance\n"+(plan?.build_spec?.acceptance_criteria||[]).map(x=>"- "+x).join("\n");
    else content=["Artifact: "+a.name,"Task: "+a.task_id,"Worker: "+a.worker,"","Requirements:",...req.map(x=>"- "+x),"","External actions: disabled"].join("\n");
    return {...a,status:"generated_internal_draft",content,bytes:new TextEncoder().encode(content).length};
  });
  return {generator_version:"artifact-generator-v1",mode:"deterministic_internal_drafts",status:generated.length?"generated":"nothing_to_generate",artifacts:generated,generated_count:generated.length,total_bytes:generated.reduce((n,a)=>n+a.bytes,0),external_side_effects:false,note:"Generated artifacts are internal drafts derived from the Manager spec. They are not client-side changes or completed integrations."};
}


function codeWorker(plan) {
  const req=plan?.build_spec?.functional_requirements||[], text=req.join(" ").toLowerCase();
  const isAutomation=/api|integration|automat|monitor|scrap|webhook|migration|import|export/.test(text);
  if(!isAutomation) return {code_worker_version:"code-worker-v2.1",status:"not_applicable",files:[],test_execution:"not_requested"};
  const safeReq=req.map(x=>String(x));
  const isCommerceMigration=/squarespace/.test(text)&&/etsy/.test(text);
  const files=[
    {path:"project/package.json",language:"json",content:JSON.stringify({name:"automation-factory-deliverable",version:"1.0.0",private:true,type:"module",scripts:isCommerceMigration?{test:"node --test",build:"node src/cli.js fixtures/squarespace-products.json config/example.json delivery-output.json"}:{test:"node --test"}},null,2)},
    {path:"project/src/spec.js",language:"javascript",content:"export const requirements = "+JSON.stringify(safeReq,null,2)+";\nexport const externalActionsAllowed = false;\n"}
  ];

  if(isCommerceMigration){
    files.push(
      {path:"project/src/normalize.js",language:"javascript",content:[
        "export function normalizeSquarespaceExport(input){",
        "  const rows=Array.isArray(input)?input:(Array.isArray(input?.products)?input.products:[]);",
        "  return rows.map((p,index)=>{",
        "    const variants=Array.isArray(p?.variants)&&p.variants.length?p.variants:[{sku:p?.sku||'',price:p?.price??0,options:p?.options||{}}];",
        "    return {",
        "      sourceId:String(p?.id??p?.product_id??index+1),",
        "      title:String(p?.title??p?.name??'').trim(),",
        "      description:String(p?.description??p?.body??''),",
        "      tags:Array.isArray(p?.tags)?p.tags.map(String).filter(Boolean):[],",
        "      images:(Array.isArray(p?.images)?p.images:[]).map(x=>typeof x==='string'?x:x?.url).filter(Boolean),",
        "      variants:variants.map((v,n)=>({sku:String(v?.sku||p?.sku||('SKU-'+(index+1)+'-'+(n+1))),price:Number(v?.price??p?.price??0),options:v?.options&&typeof v.options==='object'?v.options:{}}))",
        "    };",
        "  });",
        "}"
      ].join("\n")},
      {path:"project/src/etsy.js",language:"javascript",content:[
        "const clean=s=>String(s??'').replace(/\\s+/g,' ').trim();",
        "export function buildEtsyListingDrafts(products,config={}){",
        "  return products.map(p=>{",
        "    const tags=[...new Set([...(p.tags||[]),...(config.defaultTags||[])].map(clean).filter(Boolean))].slice(0,13);",
        "    return {sourceId:p.sourceId,title:clean(p.title).slice(0,140),description:String(p.description||''),price:Number(p.variants?.[0]?.price||0),quantity:Number(config.defaultQuantity||999),tags,images:p.images||[],variants:p.variants||[],sectionId:config.sectionId||null,shippingProfileId:config.shippingProfileId||null,status:'draft'};",
        "  });",
        "}"
      ].join("\n")},
      {path:"project/src/prodigi.js",language:"javascript",content:[
        "export function buildProdigiMappings(products,config={}){",
        "  const skuMap=config.skuMap||{},mappings=[],missing=[];",
        "  for(const p of products){for(const v of p.variants||[]){const target=skuMap[v.sku];if(!target){missing.push({sourceId:p.sourceId,sku:v.sku});continue;}mappings.push({sourceId:p.sourceId,sku:v.sku,prodigiProductId:String(target.prodigiProductId||''),printArea:String(target.printArea||'default'),attributes:target.attributes||{}});}}",
        "  return {mappings,missing,ready:missing.length===0};",
        "}"
      ].join("\n")},
      {path:"project/src/pipeline.js",language:"javascript",content:[
        "import { normalizeSquarespaceExport } from './normalize.js';",
        "import { buildEtsyListingDrafts } from './etsy.js';",
        "import { buildProdigiMappings } from './prodigi.js';",
        "import { externalActionsAllowed, requirements } from './spec.js';",
        "export function buildDeliveryPackage(input,config={}){",
        "  const products=normalizeSquarespaceExport(input),etsyDrafts=buildEtsyListingDrafts(products,config.etsy||{}),prodigi=buildProdigiMappings(products,config.prodigi||{}),errors=[];",
        "  if(!products.length) errors.push('No Squarespace products supplied');",
        "  for(const p of products){if(!p.title)errors.push('Missing title: '+p.sourceId);if(!(p.variants||[]).length)errors.push('Missing variants: '+p.sourceId);if((p.variants||[]).some(v=>!Number.isFinite(v.price)||v.price<=0))errors.push('Invalid price: '+p.sourceId);}",
        "  for(const m of prodigi.missing) errors.push('Missing Prodigi mapping: '+m.sku);",
        "  return {packageVersion:'squarespace-etsy-prodigi-v1',externalActionsAllowed,requirements,products,etsyDrafts,prodigiMappings:prodigi.mappings,validation:{ready:errors.length===0,errors,warnings:[]}};",
        "}"
      ].join("\n")},
      {path:"project/src/cli.js",language:"javascript",content:[
        "import fs from 'node:fs';",
        "import { buildDeliveryPackage } from './pipeline.js';",
        "const inputPath=process.argv[2],configPath=process.argv[3],outputPath=process.argv[4]||'delivery-output.json';",
        "if(!inputPath||!configPath){console.error('Usage: node src/cli.js <squarespace.json> <config.json> [output.json]');process.exit(1);}",
        "const input=JSON.parse(fs.readFileSync(inputPath,'utf8')),config=JSON.parse(fs.readFileSync(configPath,'utf8')),out=buildDeliveryPackage(input,config);",
        "fs.writeFileSync(outputPath,JSON.stringify(out,null,2));",
        "console.log('delivery package:',out.validation.ready?'READY':'BLOCKED','products='+out.products.length,'etsy='+out.etsyDrafts.length,'prodigi='+out.prodigiMappings.length);",
        "if(!out.validation.ready){console.error(out.validation.errors.join('\\n'));process.exitCode=2;}"
      ].join("\n")},
      {path:"project/test/pipeline.test.js",language:"javascript",content:[
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import fs from 'node:fs';",
        "import { buildDeliveryPackage } from '../src/pipeline.js';",
        "test('builds a validated Squarespace to Etsy/Prodigi dry-run package',()=>{",
        " const input=JSON.parse(fs.readFileSync(new URL('../fixtures/squarespace-products.json',import.meta.url),'utf8'));",
        " const config=JSON.parse(fs.readFileSync(new URL('../config/example.json',import.meta.url),'utf8'));",
        " const out=buildDeliveryPackage(input,config);",
        " assert.equal(out.externalActionsAllowed,false);assert.equal(out.products.length,1);assert.equal(out.etsyDrafts.length,1);assert.equal(out.prodigiMappings.length,2);assert.equal(out.validation.ready,true);assert.deepEqual(out.validation.errors,[]);assert.ok(out.etsyDrafts[0].tags.length<=13);",
        "});"
      ].join("\n")},
      {path:"project/fixtures/squarespace-products.json",language:"json",content:JSON.stringify({products:[{id:"demo-shirt",title:"Demo POD Shirt",description:"Fixture used for internal validation only.",tags:["shirt","pod"],images:["https://example.invalid/demo.jpg"],variants:[{sku:"DEMO-BLK-M",price:29.95,options:{color:"Black",size:"M"}},{sku:"DEMO-BLK-L",price:29.95,options:{color:"Black",size:"L"}}]}]},null,2)},
      {path:"project/config/example.json",language:"json",content:JSON.stringify({etsy:{defaultQuantity:999,defaultTags:["print on demand"],sectionId:null,shippingProfileId:null},prodigi:{skuMap:{"DEMO-BLK-M":{prodigiProductId:"FIXTURE-PRODUCT",printArea:"front",attributes:{size:"M",color:"Black"}},"DEMO-BLK-L":{prodigiProductId:"FIXTURE-PRODUCT",printArea:"front",attributes:{size:"L",color:"Black"}}}}},null,2)},

      {path:"project/src/live-connectors.js",language:"javascript",content:[
        "export const endpoints={squarespaceProducts:'https://api.squarespace.com/v2/commerce/products',etsyListings:shopId=>'https://openapi.etsy.com/v3/application/shops/'+encodeURIComponent(shopId)+'/listings',prodigiProduct:(sku,sandbox=true)=>(sandbox?'https://api.sandbox.prodigi.com':'https://api.prodigi.com')+'/v4.0/products/'+encodeURIComponent(sku),prodigiOrders:(sandbox=true)=>(sandbox?'https://api.sandbox.prodigi.com':'https://api.prodigi.com')+'/v4.0/orders'};",
        "const need=(v,name)=>{if(v==null||v==='')throw new Error('Missing '+name);return v};",
        "const approved=o=>{if(o?.allowExternalActions!==true)throw new Error('External action blocked: explicit approval required')};",
        "async function readJson(r){const text=await r.text();let body;try{body=text?JSON.parse(text):{}}catch{body={raw:text}}if(!r.ok)throw new Error('HTTP '+r.status+': '+JSON.stringify(body).slice(0,500));return body}",
        "export async function fetchSquarespaceProducts({token,userAgent='AutomationFactory-Deliverable/1.0',fetchImpl=fetch,cursor=null}={}){need(token,'Squarespace token');const u=new URL(endpoints.squarespaceProducts);if(cursor)u.searchParams.set('cursor',cursor);const r=await fetchImpl(u,{headers:{Authorization:'Bearer '+token,'User-Agent':userAgent,Accept:'application/json'}});return readJson(r)}",
        "export async function createEtsyDraft({shopId,token,apiKey,listing,allowExternalActions=false,fetchImpl=fetch}={}){approved({allowExternalActions});need(shopId,'Etsy shop id');need(token,'Etsy OAuth token');need(apiKey,'Etsy API key');const body=new URLSearchParams();const src={quantity:listing?.quantity,title:listing?.title,description:listing?.description,price:listing?.price,who_made:listing?.whoMade,when_made:listing?.whenMade,taxonomy_id:listing?.taxonomyId,shipping_profile_id:listing?.shippingProfileId,readiness_state_id:listing?.readinessStateId};for(const [k,v] of Object.entries(src))if(v!=null&&v!=='')body.set(k,String(v));for(const tag of listing?.tags||[])body.append('tags[]',tag);const r=await fetchImpl(endpoints.etsyListings(shopId),{method:'POST',headers:{Authorization:'Bearer '+token,'x-api-key':apiKey,'Content-Type':'application/x-www-form-urlencoded'},body});return readJson(r)}",
        "export async function getProdigiProduct({sku,apiKey,sandbox=true,fetchImpl=fetch}={}){need(sku,'Prodigi SKU');need(apiKey,'Prodigi API key');const r=await fetchImpl(endpoints.prodigiProduct(sku,sandbox),{headers:{'X-API-Key':apiKey,Accept:'application/json'}});return readJson(r)}",
        "export async function createProdigiOrder({order,apiKey,sandbox=true,allowExternalActions=false,fetchImpl=fetch}={}){approved({allowExternalActions});need(apiKey,'Prodigi API key');if(sandbox!==true)throw new Error('Live Prodigi orders require a separate production approval step');const r=await fetchImpl(endpoints.prodigiOrders(true),{method:'POST',headers:{'X-API-Key':apiKey,'Content-Type':'application/json'},body:JSON.stringify(order||{})});return readJson(r)}"
      ].join("\n")},
      {path:"project/test/live-connectors.test.js",language:"javascript",content:[
        "import test from 'node:test';import assert from 'node:assert/strict';import {endpoints,createEtsyDraft,createProdigiOrder} from '../src/live-connectors.js';",
        "test('official API endpoints are wired',()=>{assert.equal(endpoints.squarespaceProducts,'https://api.squarespace.com/v2/commerce/products');assert.match(endpoints.etsyListings('123'),/openapi\\.etsy\\.com\\/v3\\/application\\/shops\\/123\\/listings/);assert.match(endpoints.prodigiProduct('SKU',true),/api\\.sandbox\\.prodigi\\.com\\/v4\\.0\\/products\\/SKU/)});",
        "test('write operations require explicit approval',async()=>{await assert.rejects(()=>createEtsyDraft({shopId:'1',token:'t',apiKey:'k',listing:{}}),/explicit approval/);await assert.rejects(()=>createProdigiOrder({order:{},apiKey:'k'}),/explicit approval/)})"
      ].join("\n")},
      {path:"project/.env.example",language:"text",content:["SQUARESPACE_TOKEN=","ETSY_SHOP_ID=","ETSY_OAUTH_TOKEN=","ETSY_API_KEY=","PRODIGI_SANDBOX_API_KEY=","# Live credentials are intentionally not enabled by default."].join("\n")},
      {path:"project/LIVE_RUNBOOK.md",language:"markdown",content:["# Live connector runbook","","The package includes real connector functions for Squarespace Products API v2, Etsy Open API v3 draft listings, and Prodigi Print API v4 sandbox.","","## Safety model","- Read operations can be used after credentials are supplied.","- Etsy write calls require allowExternalActions=true.","- Prodigi order creation is restricted to the Sandbox host in the generated connector.","- Prodigi Live order submission remains blocked until a separate production approval step is implemented.","","## Required Etsy fields","Before creating physical draft listings, provide quantity, title, description, price, whoMade, whenMade, taxonomyId, shippingProfileId and readinessStateId.","","## Acceptance","Run npm test, create one Etsy draft in an authorized shop, verify SKU/variant mapping, then create one Prodigi Sandbox order before any live rollout."].join("\n")},

      {path:"project/README.md",language:"markdown",content:["# Squarespace → Etsy → Prodigi delivery package","","Implements the repeatable transformation layer without touching external accounts.","","## Implemented","- Normalize Squarespace-style product JSON, variants, images and tags.","- Produce Etsy listing drafts with title/tag/price/variant constraints.","- Map variant SKUs to client-supplied Prodigi product/template settings.","- Validate missing titles, invalid prices and missing Prodigi mappings.","- Run deterministic tests with npm test.","","## Run","1. Replace fixtures/squarespace-products.json with the authorized client export.","2. Fill config/example.json with approved Etsy profile IDs and Prodigi SKU mappings.","3. Run npm test.","4. Run node src/cli.js <products.json> <config.json> delivery-output.json.","","External publishing is intentionally disabled. Credentials are never embedded."].join("\n")},
      {path:"project/HANDOVER.md",language:"markdown",content:["# Hand-over and client-access gate","","## Internal production complete","Migration transformation, listing-draft generation, SKU mapping and validation can be built and tested without client credentials.","","## Required before live execution","- Authorized Squarespace product export or account access.","- Etsy shop access plus approved section/shipping profile identifiers.","- Prodigi account/API access and the real SKU-to-product/template mapping.","- Client approval for shipping/tax configuration and a live test order.","","## Live acceptance sequence","Authorized export → validation → Etsy listing creation with approved access → real Prodigi mapping → controlled end-to-end test order → acceptance evidence.","","No external account action is performed until explicitly authorized."].join("\n")}
    );
  } else {
    files.push(
      {path:"project/src/index.js",language:"javascript",content:"import { requirements, externalActionsAllowed } from './spec.js';\nexport function buildPlan(){ return { requirements, externalActionsAllowed, status:'internal-build-ready' }; }\n"},
      {path:"project/test/spec.test.js",language:"javascript",content:"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { buildPlan } from '../src/index.js';\ntest('external actions stay disabled',()=>{ const p=buildPlan(); assert.equal(p.externalActionsAllowed,false); assert.ok(p.requirements.length>0); });\n"},
      {path:"project/README.md",language:"markdown",content:"# Automation Factory generated project\n\nInternal build package generated from the Manager specification. External client/account actions remain disabled until explicit approval and authorized credentials are available.\n"}
    );
  }
  return {code_worker_version:"code-worker-v2",status:"source_generated",implementation_level:isCommerceMigration?"runnable_job_specific_package":"runnable_generic_scaffold",project_kind:"node-esm",files,file_count:files.length,test_execution:"sandbox_runner_available",test_runner:"github-actions:sandbox-runner-v1",test_command:"npm test",external_side_effects:false,note:"Source and tests are generated in Cloudflare Worker; execution is delegated to the isolated GitHub Actions runner. Production packages remain side-effect-free until explicit user approval and authorized client access."};
}

function sandboxBundle(opportunityId, plan) {
  const cw=plan?.code_worker||codeWorker(plan);
  const files=(cw.files||[]).map(f=>({path:String(f.path||"").replace(/^project\//,""),content:String(f.content||"")}));
  return {bundle_version:"job-sandbox-bundle-v1",opportunity_id:opportunityId,project_kind:cw.project_kind||"",test_command:cw.test_command||"npm test",files,external_actions_allowed:false};
}

async function dispatchSandbox(request, env, opportunityId) {
  const row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(opportunityId).first();
  if(!row) return json({ok:false,error:"Paid job not found"},404);
  let bd={};try{bd=JSON.parse(row.score_breakdown||"{}")}catch{}
  if(!bd.actionable_paid_job||!bd.factory_fulfillable) return json({ok:false,error:"Factory-ready paid job only"},400);
  const plan=paidJobPlan(row); plan.factory_builder=factoryBuilder(plan); plan.worker_execution=workerExecutionPlan(plan); plan.build_runtime=buildRuntime(plan); plan.artifact_generator=artifactGenerator(plan); plan.code_worker=codeWorker(plan);
  if(plan.code_worker.status!=="source_generated") return json({ok:false,error:"No generated code for sandbox"},400);
  const runId="sbx_"+crypto.randomUUID(), bundle=sandboxBundle(opportunityId,plan), now=nowIso();
  await env.DB.prepare("INSERT INTO sandbox_runs(run_id,opportunity_id,bundle_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(runId,opportunityId,JSON.stringify(bundle),"created",now,now).run();
  const missingConfig=[]; if(!env.GITHUB_ACTIONS_TOKEN)missingConfig.push("GITHUB_ACTIONS_TOKEN"); if(!env.SANDBOX_CALLBACK_TOKEN)missingConfig.push("SANDBOX_CALLBACK_TOKEN");
  if(missingConfig.length) return json({ok:true,run_id:runId,status:"config_required",missing_configuration:missingConfig,note:"Bundle created safely; dispatch is blocked until runtime configuration is complete."},202);
  const api="https://api.github.com/repos/lsc1313/AutomationFactory/actions/workflows/sandbox-runner.yml/dispatches";
  const publicBaseUrl=String(env.PUBLIC_BASE_URL||new URL(request.url).origin).replace(/\/$/,"");
  const bundleUrl=publicBaseUrl+"/api/sandbox-runs/"+encodeURIComponent(runId)+"/bundle";
  const callbackUrl=publicBaseUrl+"/api/sandbox-runs/"+encodeURIComponent(runId)+"/result";
  const gh=await fetch(api,{method:"POST",headers:{"authorization":"Bearer "+env.GITHUB_ACTIONS_TOKEN,"accept":"application/vnd.github+json","content-type":"application/json","x-github-api-version":"2022-11-28","user-agent":"AutomationFactory-MoneyScout/0.18.0"},body:JSON.stringify({ref:"main",inputs:{run_id:runId,bundle_url:bundleUrl,callback_url:callbackUrl}})});
  if(!gh.ok){const msg=(await gh.text()).slice(0,500);await env.DB.prepare("UPDATE sandbox_runs SET status='dispatch_failed',log_summary=?,updated_at=? WHERE run_id=?").bind(msg,nowIso(),runId).run();return json({ok:false,run_id:runId,error:"GitHub dispatch failed",detail:msg},502);}
  await env.DB.prepare("UPDATE sandbox_runs SET status='dispatched',updated_at=? WHERE run_id=?").bind(nowIso(),runId).run();
  return json({ok:true,run_id:runId,status:"dispatched"},202);
}


function productionBundle(opportunityId, plan) {
  const cw=plan?.code_worker||codeWorker(plan), generated=plan?.artifact_generator||artifactGenerator(plan);
  const files=(cw.files||[]).map(f=>({path:String(f.path||"").replace(/^project\//,""),content:String(f.content||"")}));
  for(const a of generated.artifacts||[]){
    const rel=String(a.path||a.name||a.artifact_id||"artifact.txt").replace(/^artifacts\//,"").replace(/\.\./g,"_");
    files.push({path:"delivery/"+rel,content:String(a.content||"")});
  }
  const intake=plan?.client_intake||{status:"not_started",answers:{},secret_present:{},completion:{missing:[]}};
  const safeIntake={intake_version:"client-intake-v1",status:intake.status||"not_started",answers:intake.answers||{},secret_present:intake.secret_present||{},completion:intake.completion||{},note:"Secret values are intentionally excluded from this package."};
  files.push({path:"client/CLIENT_INPUT.json",content:JSON.stringify(safeIntake,null,2)});
  const ia=safeIntake.answers||{};
  let parsedSkuMap={}; try{const x=JSON.parse(ia.prodigi_sku_mapping||"{}");if(x&&typeof x==="object"&&!Array.isArray(x))parsedSkuMap=x}catch{}
  const clientConfig={
    etsy:{shopId:ia.etsy_shop_id||"",taxonomyId:ia.etsy_taxonomy_id||"",shippingProfileId:ia.etsy_shipping_profile_id||"",readinessStateId:ia.etsy_readiness_state_id||"",sectionId:ia.etsy_section_id||""},
    prodigi:{mode:ia.prodigi_mode||"sandbox",skuMap:parsedSkuMap,skuMappingRaw:ia.prodigi_sku_mapping||""},
    scope:{productScope:ia.product_scope||"",shippingRegions:ia.shipping_regions||"",shippingPolicy:ia.shipping_policy||"",taxPolicy:ia.tax_policy||"",deliveryDate:ia.delivery_date||""},
    credentialsPresent:safeIntake.secret_present||{},
    externalActionsAllowed:false
  };
  files.push({path:"config/client.json",content:JSON.stringify(clientConfig,null,2)});
  const missing=(safeIntake.completion?.missing||[]);
  const accessLines=Object.entries(safeIntake.secret_present||{}).map(([k,v])=>"- "+k+": "+(v?"stored in encrypted vault":"missing"));
  files.push({path:"client/ACCESS_STATUS.md",content:["# Client intake/access status","","Intake status: "+safeIntake.status,"Missing required fields: "+(missing.length?missing.join(", "):"none"),"","## Secure credentials",...(accessLines.length?accessLines:["- none required"]), "", "Secret values are not exported to GitHub Actions artifacts or delivery ZIP files."].join("\n")});
  const manifest={pipeline_version:"production-pipeline-v2",opportunity_id:opportunityId,title:plan?.build_spec?.title||"",implementation_level:cw.implementation_level||"unknown",requirements:plan?.build_spec?.functional_requirements||[],acceptance_criteria:plan?.build_spec?.acceptance_criteria||[],qc:plan?.qc||null,factory_builder:plan?.factory_builder||null,client_intake:{status:safeIntake.status,completion:safeIntake.completion,secret_present:safeIntake.secret_present},external_actions_allowed:false,generated_at:nowIso()};
  files.push({path:"delivery/MANIFEST.json",content:JSON.stringify(manifest,null,2)});
  return {bundle_version:"job-production-bundle-v2",opportunity_id:opportunityId,project_kind:cw.project_kind||"",test_command:cw.test_command||"npm test",files,external_actions_allowed:false};
}

async function dispatchProduction(request, env, opportunityId) {
  const row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(opportunityId).first();
  if(!row) return json({ok:false,error:"Paid job not found"},404);
  let bd={};try{bd=JSON.parse(row.score_breakdown||"{}")}catch{}
  if(!bd.actionable_paid_job||!bd.factory_fulfillable) return json({ok:false,error:"Factory-ready paid job only"},400);
  const sandbox=await env.DB.prepare("SELECT run_id FROM sandbox_runs WHERE opportunity_id=? AND status='completed' AND conclusion='success' ORDER BY created_at DESC LIMIT 1").bind(opportunityId).first();
  if(!sandbox) return json({ok:true,status:"sandbox_required",note:"Run and pass the sandbox test before starting production."});
  const plan=paidJobPlan(row); plan.factory_builder=factoryBuilder(plan); plan.worker_execution=workerExecutionPlan(plan); plan.build_runtime=buildRuntime(plan); plan.artifact_generator=artifactGenerator(plan); plan.code_worker=codeWorker(plan); plan.qc=qcPlan(plan);
  const intake=await getClientIntake(env,row,plan);
  plan.client_intake={status:intake.status,answers:intake.answers,secret_present:intake.secret_present,completion:intake.completion,request_message:intake.request_message};
  if(plan.qc.status!=="preflight_pass") return json({ok:false,error:"QC preflight blocked",qc:plan.qc},400);
  if(plan.code_worker.status!=="source_generated") return json({ok:false,error:"No generated code for production"},400);
  const runId="prd_"+crypto.randomUUID(), bundle=productionBundle(opportunityId,plan), now=nowIso();
  const nextGate=intake.status!=="ready_for_build"?"client_intake_required":((plan.factory_builder.blocked_tasks||0)>0?"secure_execution_approval":"user_delivery_review");
  const summary={pipeline_version:"production-pipeline-v2",implementation_level:plan.code_worker.implementation_level||"unknown",file_count:bundle.files.length,qc_status:plan.qc.status,ready_tasks:plan.factory_builder.ready_tasks||0,blocked_tasks:plan.factory_builder.blocked_tasks||0,intake_status:intake.status,intake_missing:intake.completion?.missing||[],next_gate:nextGate,sandbox_run_id:sandbox.run_id,external_actions_allowed:false};
  await env.DB.prepare("INSERT INTO production_runs(run_id,opportunity_id,bundle_json,status,package_summary_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(runId,opportunityId,JSON.stringify(bundle),"created",JSON.stringify(summary),now,now).run();
  const missingConfig=[]; if(!env.GITHUB_ACTIONS_TOKEN)missingConfig.push("GITHUB_ACTIONS_TOKEN"); if(!env.SANDBOX_CALLBACK_TOKEN)missingConfig.push("SANDBOX_CALLBACK_TOKEN");
  if(missingConfig.length) return json({ok:true,run_id:runId,status:"config_required",missing_configuration:missingConfig,summary},202);
  const api="https://api.github.com/repos/lsc1313/AutomationFactory/actions/workflows/sandbox-runner.yml/dispatches";
  const publicBaseUrl=String(env.PUBLIC_BASE_URL||new URL(request.url).origin).replace(/\/$/,"");
  const bundleUrl=publicBaseUrl+"/api/production-runs/"+encodeURIComponent(runId)+"/bundle", callbackUrl=publicBaseUrl+"/api/production-runs/"+encodeURIComponent(runId)+"/result";
  const gh=await fetch(api,{method:"POST",headers:{"authorization":"Bearer "+env.GITHUB_ACTIONS_TOKEN,"accept":"application/vnd.github+json","content-type":"application/json","x-github-api-version":"2022-11-28","user-agent":"AutomationFactory-MoneyScout/0.18.0"},body:JSON.stringify({ref:"main",inputs:{run_id:runId,bundle_url:bundleUrl,callback_url:callbackUrl}})});
  if(!gh.ok){const msg=(await gh.text()).slice(0,500);await env.DB.prepare("UPDATE production_runs SET status='dispatch_failed',log_summary=?,updated_at=? WHERE run_id=?").bind(msg,nowIso(),runId).run();return json({ok:false,run_id:runId,error:"GitHub production dispatch failed",detail:msg},502);}
  await env.DB.prepare("UPDATE production_runs SET status='dispatched',updated_at=? WHERE run_id=?").bind(nowIso(),runId).run();
  return json({ok:true,run_id:runId,status:"dispatched",summary},202);
}

function qcPlan(plan) {
  const rt=plan?.build_runtime||buildRuntime(plan), gen=plan?.artifact_generator||artifactGenerator(plan), cw=plan?.code_worker||codeWorker(plan), spec=plan?.build_spec||{};
  const checks=[
    {id:"QC01",name:"manager_requirements_present",pass:(spec.functional_requirements||[]).length>0},
    {id:"QC02",name:"internal_artifacts_declared",pass:rt.artifact_count>0},
    {id:"QC03",name:"external_side_effects_blocked",pass:rt.external_side_effects===false&&gen.external_side_effects===false},
    {id:"QC03A",name:"internal_artifacts_generated",pass:gen.generated_count>0},
    {id:"QC04",name:"acceptance_criteria_present",pass:(spec.acceptance_criteria||[]).length>0},
    {id:"QC04A",name:"generated_code_keeps_external_actions_disabled",pass:cw.status==="not_applicable"||cw.external_side_effects===false},
    {id:"QC05",name:"external_actions_require_user_approval",pass:plan?.worker_execution?.next_gate==="user_approval_before_any_external_action"}
  ];
  return {qc_version:"qc-v1",status:checks.every(x=>x.pass)?"preflight_pass":"preflight_blocked",checks,passed:checks.filter(x=>x.pass).length,total:checks.length,note:"QC v1 validates the internal build manifest and safety gates. It does not claim client-side acceptance before authorized external integration tests."};
}

async function listRuns(env) {
  return (await env.DB.prepare(`
    SELECT * FROM scout_runs ORDER BY started_at DESC LIMIT 20
  `).all()).results || [];
}

function appHtml() {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#08101d" />
<title>Automation Factory · Money Scout</title>
<style>
:root{color-scheme:dark;--bg:#070d18;--panel:#111a2a;--panel2:#0c1524;--line:#27344b;--text:#f3f7fc;--muted:#99a8bd;--hot:#53e49d;--watch:#ffd269;--cold:#93a0b4;--accent:#7eb0ff;--danger:#ff8f9b}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#070d18,#0b1321);font-family:system-ui,-apple-system,sans-serif;color:var(--text)}button,input,select,textarea{font:inherit}.wrap{max-width:1120px;margin:auto;padding:18px 14px 44px}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.brand{font-size:25px;font-weight:900}.sub{color:var(--muted);font-size:12px;line-height:1.5}.badge{border:1px solid var(--line);border-radius:999px;padding:7px 10px;color:var(--muted);font-size:12px}.notice{margin:12px 0;padding:10px 12px;border:1px solid var(--line);background:var(--panel2);border-radius:12px;color:var(--muted);font-size:12px}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:14px 0}.stat{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:13px}.stat b{display:block;font-size:22px;margin-top:4px}.toolbar{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.toolbar button,.action{background:#17243a;color:white;border:1px solid #34435c;border-radius:10px;padding:9px 11px;font-weight:800}.toolbar button.active{background:#264e82;border-color:#6da7ff}.scan{background:#173d2c!important}.token{display:flex;gap:7px;margin:10px 0}.token input{min-width:0;flex:1;background:#0d1624;color:white;border:1px solid var(--line);border-radius:10px;padding:10px}.intakeField{margin:9px 0}.intakeField label{display:block;font-size:11px;font-weight:800;margin-bottom:5px;color:#cbd6e5}.intakeField input,.intakeField select,.intakeField textarea{width:100%;background:#0d1624;color:white;border:1px solid var(--line);border-radius:9px;padding:9px}.intakeField textarea{min-height:78px;resize:vertical}.intakeHelp{font-size:10px;color:var(--muted);margin-top:4px}.intakeReady{color:#6bf0aa;font-weight:850}.intakeMissing{color:#ffdc7f;font-weight:850}.token button{background:#17243a;color:white;border:1px solid var(--line);border-radius:10px;padding:9px 11px}.filters{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.filters select{background:#0d1624;color:white;border:1px solid var(--line);border-radius:10px;padding:9px 10px}.card{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:14px;margin:10px 0}.head{display:flex;gap:10px;justify-content:space-between}.title{font-size:16px;font-weight:900;line-height:1.35}.score{min-width:54px;text-align:center;border-radius:12px;padding:8px 7px;font-size:20px;font-weight:950;background:#0b1422;border:1px solid var(--line)}.score small{display:block;font-size:9px;color:var(--muted);font-weight:700}.meta,.reason{color:var(--muted);font-size:12px;margin-top:7px;line-height:1.5}.metrics{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.metric{font-size:11px;padding:5px 7px;border-radius:8px;background:#0b1422;border:1px solid var(--line);color:#cbd6e5}.desc{font-size:13px;line-height:1.55;margin-top:9px;color:#d9e1ed;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.pill{display:inline-block;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:900}.hot{background:#123d2a;color:#6bf0aa}.watch{background:#493914;color:#ffdc7f}.cold{background:#252d3a;color:#b0bbca}.paycheck{background:#273657;color:#aecdff}.decisions{display:flex;gap:6px;flex-wrap:wrap;margin-top:11px}.decisions button{border:1px solid var(--line);background:#0e1828;color:white;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:850}.decisions button.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}.link{color:#9fc5ff;text-decoration:none}.empty{text-align:center;color:var(--muted);padding:42px 5px}.runinfo{color:var(--muted);font-size:11px;margin:10px 0}.runerrors{display:none;margin:8px 0 12px;padding:10px 12px;border:1px solid #633845;background:#24131a;border-radius:10px;color:#ffb4bd;font-size:11px;line-height:1.55;white-space:pre-wrap}.footer{color:var(--muted);font-size:11px;text-align:center;margin-top:28px}.error{color:#ffabb3}
@media(max-width:760px){.stats{grid-template-columns:repeat(2,1fr)}.stats .stat:first-child{grid-column:span 2}.head{align-items:flex-start}.brand{font-size:22px}.card{padding:13px}.wrap{padding:14px 10px 36px}.toolbar button{flex:1 0 auto}}
</style>
</head>
<body><div class="wrap">
  <div class="top">
    <div><div class="brand">💰 Money Scout</div><div class="sub">Automation Factory · 수익 기회 탐색 + Opportunity Judge</div></div>
    <div class="badge">v${APP_VERSION}</div>
  </div>
  <div id="notice" class="notice">상태 확인 중…</div>
  <div class="stats">
    <div class="stat"><span class="sub">전체</span><b id="s-total">0</b></div>
    <div class="stat"><span class="sub">🔥 HOT</span><b id="s-hot">0</b></div>
    <div class="stat"><span class="sub">👀 WATCH</span><b id="s-watch">0</b></div>
    <div class="stat"><span class="sub">🧊 COLD</span><b id="s-cold">0</b></div>
    <div class="stat"><span class="sub">✅ 진행</span><b id="s-proceed">0</b></div>
  </div>
  <div class="toolbar">
    <button class="active" data-grade="all">전체</button>
    <button data-grade="hot">HOT</button>
    <button data-grade="watch">WATCH</button>
    <button data-grade="cold">COLD</button>
    <button id="paidJobsBtn">💵 지금 지원 가능한 유료 일감</button>\n    <button id="candidateBtn">🧪 장기 시장후보</button>
  </div>
  <div class="filters">
    <select id="stateFilter">
      <option value="all">결정 전체</option>
      <option value="unreviewed">미검토</option>
      <option value="proceed">진행</option>
      <option value="hold">보류</option>
      <option value="reject">제외</option>
    </select>
    <select id="sourceFilter">
      <option value="all">소스 전체</option>
      <option value="agent_bounties">Agent Bounties (공식 claimable)</option>
      <option value="github_paid">GitHub Paid Discovery</option>
      <option value="github_demand">GitHub Product Demand</option>\n      <option value="marketplace_demand">Marketplace Demand</option>
      <option value="remoteok">RemoteOK (채용 참고)</option>
      <option value="github_bounty">Legacy GitHub Bounty</option>
    </select>
  </div>
  <div class="token">
    <input id="token" type="password" placeholder="관리키 (설정한 경우만 입력)" autocomplete="off" />
    <button id="saveToken">저장</button>
  </div>
  <div id="runinfo" class="runinfo"></div>\n  <div id="runerrors" class="runerrors"></div>
  <div id="paidJobsList"></div>\n  <div id="candidateList"></div>\n  <div id="list"><div class="empty">불러오는 중…</div></div>
  <div class="footer">v${APP_VERSION} · Client Intake v1 · 수집→질문→보안입력→재제작→QC</div>
</div>
<script>
let grade='all';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tokenEl=document.getElementById('token');
tokenEl.value=localStorage.getItem('af_admin_token')||'';
function headers(){const h={'content-type':'application/json'};const t=localStorage.getItem('af_admin_token')||'';if(t)h['x-admin-token']=t;return h;}
async function api(url,opt={}){const r=await fetch(url,{...opt,headers:{...headers(),...(opt.headers||{})}});const j=await r.json().catch(()=>({error:'응답 해석 실패'}));if(!r.ok){const detail=j.detail?(' · '+String(j.detail).slice(0,300)):'';throw new Error((j.error||('HTTP '+r.status))+detail);}return j;}
function money(a,b,c){if(a==null&&b==null)return '';const f=n=>Number(n||0).toLocaleString();return (a===b||!b?f(a):f(a)+' ~ '+f(b))+(c?' '+c:'');}
function when(s){if(!s)return '';const d=new Date(s);return isNaN(d)?'':d.toLocaleString();}
function stateLabel(s){return s==='proceed'?'진행':s==='hold'?'보류':s==='reject'?'제외':'미검토';}
function breakdown(j){try{return JSON.parse(j.score_breakdown||'{}')}catch{return {}}}
async function load(){
 const state=document.getElementById('stateFilter').value, source=document.getElementById('sourceFilter').value;
 const [health,stats,jobs]=await Promise.all([
   api('/api/health'), api('/api/stats'), api('/api/opportunities?grade='+encodeURIComponent(grade)+'&state='+encodeURIComponent(state)+'&source='+encodeURIComponent(source))
 ]);
 document.getElementById('notice').innerHTML='실데이터 소스: <b>'+esc(health.sources.join(', '))+'</b> · 보안: <b>'+esc(health.security_mode)+'</b>';
 ['total','hot','watch','cold'].forEach(k=>document.getElementById('s-'+k).textContent=stats[k]||0);
 document.getElementById('s-proceed').textContent=stats.states?.proceed||0;
 const lr=stats.last_run;
 let runMeta=''; try{const a=JSON.parse(lr?.errors_json||'[]'); const d=a.find(x=>x.source==='freelancer_projects'&&x.diagnostic)?.diagnostic; if(d)runMeta=' · Freelancer '+d.pages_succeeded+'/'+d.pages_requested+'페이지 · 원본 '+d.raw_count+' · 고유 '+d.unique_count;}catch{}
 document.getElementById('runinfo').textContent=lr?('마지막 스캔 '+when(lr.finished_at||lr.started_at)+' · 발견 '+lr.found_count+' · 저장 '+lr.saved_count+' · 오류 '+lr.error_count+runMeta):'아직 스캔 기록이 없습니다.';
 const re=document.getElementById('runerrors');
 let errs=[];try{errs=JSON.parse(lr?.errors_json||'[]').filter(x=>x.error)}catch{}
 if(errs.length){re.style.display='block';re.textContent='⚠ 최근 스캔 오류 상세\\n'+errs.map((e,i)=>(i+1)+'. ['+(e.source||'unknown')+'] '+(e.error||'알 수 없는 오류')).join('\\n');}else{re.style.display='none';re.textContent='';}
 const evidenceById={}; await Promise.all(jobs.map(async j=>{try{evidenceById[j.opportunity_id]=await api('/api/opportunities/'+encodeURIComponent(j.opportunity_id)+'/evidence')}catch{evidenceById[j.opportunity_id]=[]}}));
 const el=document.getElementById('list');
 if(!jobs.length){el.innerHTML='<div class="empty">표시할 수익 기회가 없습니다.<br>「지금 스캔」을 눌러 첫 수집을 실행하세요.</div>';return;}
 el.innerHTML=jobs.map(j=>{
   const budget=money(j.budget_min,j.budget_max,j.currency);
   const bd=breakdown(j);
   const meta=[j.source,j.type,j.location,budget,j.posted_at?('등록 '+when(j.posted_at)):''].filter(Boolean).map(esc).join(' · ');
   const link=j.url?'<a class="link" href="'+esc(j.url)+'" target="_blank" rel="noopener">원문 보기</a>':'';
   const ev=evidenceById[j.opportunity_id]||[];
   const evidenceHtml=ev.length?'<details><summary>🔎 근거 '+ev.length+'건 보기</summary><div class="reason">'+ev.map((e,i)=>(i+1)+'. '+esc('['+(e.source||'source')+'] '+(e.app_name||e.app_id||e.evidence_id||'evidence')+' · '+(e.evidence_kind||'unknown')+' / '+(e.evidence_quality||'unknown')+(e.rating!=null?' · ★'+e.rating:''))+(e.url?' <a class="link" href="'+esc(e.url)+'" target="_blank" rel="noopener">원문</a>':'')).join('<br>')+'</div></details>':'<div class="meta">근거 상세: 다음 수집부터 기록</div>';
   const btn=(s,l)=>'<button data-id="'+esc(j.opportunity_id)+'" data-state="'+s+'" class="'+(j.user_state===s?'on':'')+'">'+l+'</button>';
   const isDemand=bd.judge_mode==='demand';
   const paycheck=!!bd.requires_pay_check;
   const tokenCheck=bd.payout_kind==='token_fixed';
   const label=isDemand
     ? (bd.demand_status==='product_candidate'?'PRODUCT':bd.demand_status==='noise'?'NOISE':'SIGNAL')
     : (tokenCheck?'TOKEN CHECK':paycheck?'PAY CHECK':j.grade.toUpperCase());
   const pillClass=(paycheck||tokenCheck)?'paycheck':j.grade;
   const metric=(icon,name,val)=>'<span class="metric">'+icon+' '+name+' '+esc(val??0)+'</span>';
   const paidMetrics=metric('💰','MONEY',bd.money)+metric('🤖','AUTO',bd.automation)+metric('⚡','SPEED',bd.speed)+metric('📈','SCALE',bd.scale)+metric('🧭','TYPE',bd.opportunity_type||j.type);
   const evidenceMetrics=bd.opportunity_type==='business_opportunity'&&j.source==='marketplace_demand'
     ? metric('🗣','COMPLAINTS',bd.complaint_count)+metric('⭐','LOW STAR',bd.low_star_reviews)+metric('🧱','WEAK COMP',bd.weak_competitor_signals)+metric('🔎','EVIDENCE',bd.marketplace_evidence_ready?'READY':'WEAK')
     : '';
   const demandMetrics=metric('📣','DEMAND',bd.demand)+metric('🔁','REPEAT',bd.demand_repeat_count)+metric('🛠','BUILD',bd.build)+metric('💼','MONETIZE',bd.monetize)+metric('🧬','FINGERPRINT',bd.demand_fingerprint||'legacy')+evidenceMetrics;
   const payout=isDemand?'':'<span class="metric">💳 '+esc(bd.payout_kind||'unknown')+' · '+esc(bd.payout_trust||'unknown')+'</span>';
   const metrics2=(isDemand?demandMetrics:paidMetrics)+payout;
   return '<div class="card"><div class="head"><div><div><span class="pill '+esc(pillClass)+'">'+esc(label)+'</span></div><div class="title">'+esc(j.title)+'</div><div class="meta">'+meta+'</div><div class="metrics">'+metrics2+'</div></div><div class="score">'+esc(j.score)+'<small>/100</small></div></div><div class="desc">'+esc(j.description||'설명 없음')+'</div><div class="reason">'+esc(j.judge_reason||'')+'</div>'+evidenceHtml+'<div class="meta">'+link+' · 현재결정: '+esc(stateLabel(j.user_state))+'</div><div class="decisions">'+btn('proceed','✅ 진행')+btn('hold','⏸ 보류')+btn('reject','✕ 제외')+btn('unreviewed','↺ 미검토')+'</div></div>';
 }).join('');
 document.querySelectorAll('[data-id][data-state]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/api/opportunities/'+encodeURIComponent(b.dataset.id)+'/decision',{method:'POST',body:JSON.stringify({state:b.dataset.state})});await load();}catch(e){alert(e.message);}finally{b.disabled=false;}});
}
document.querySelectorAll('[data-grade]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-grade]').forEach(x=>x.classList.remove('active'));b.classList.add('active');grade=b.dataset.grade;load();});
document.getElementById('stateFilter').onchange=load;document.getElementById('sourceFilter').onchange=load;
document.getElementById('saveToken').onclick=()=>{localStorage.setItem('af_admin_token',tokenEl.value.trim());alert('이 휴대폰 브라우저에 관리키를 저장했습니다.');};
async function loadMarketCandidates(){
 const rows=await api('/api/market-candidates');
 const el=document.getElementById('candidateList');
 if(!rows.length){el.innerHTML='<div class="empty">아직 시장후보가 없습니다. 시장 교차검증을 먼저 실행하세요.</div>';return;}
 const ready=rows.filter(c=>c.commercialization_status==='verified_money');
 const pending=rows.filter(c=>c.commercialization_status!=='verified_money');
 const card=c=>{
   let missing=[];try{missing=JSON.parse(c.validation_missing||'[]')}catch{}
   return '<details class="card"><summary><b>'+esc(c.fingerprint)+'</b> · '+esc(c.commercialization_status)+'</summary>'+
   '<div class="metrics">'+
   '<span class="metric">🔁 독립수요 '+esc(c.independent_repo_count)+'</span>'+
   '<span class="metric">📣 신호 '+esc(c.signal_count)+'</span>'+
   '<span class="metric">🔎 시장근거 '+esc(c.raw_market_evidence_count)+'</span>'+
   '<span class="metric">🏪 경쟁 '+esc(c.competitor_count)+'</span>'+
   '<span class="metric">💳 결제근거 '+esc(c.payment_evidence_count)+'</span>'+
   '<span class="metric">💵 가격근거 '+esc(c.pricing_evidence_count)+'</span>'+
   '<span class="metric">🧱 약한경쟁 '+esc(c.weak_competitor_count)+'</span></div>'+
   '<div class="desc">'+esc(c.representative_title||'')+'</div>'+
   '<div class="reason">추가검증: '+esc(missing.length?missing.join(', '):'없음')+'</div>'+
   '<button data-market-detail="'+esc(c.fingerprint)+'">상세 근거 보기</button><div id="market-'+esc(c.fingerprint)+'"></div></details>';
 };
 el.innerHTML='<div class="sub" style="margin:14px 0 8px">🎯 사업화 후보 '+ready.length+'개</div>'+ready.map(card).join('')+
   '<details style="margin-top:12px"><summary class="sub">🧪 검증 대기 '+pending.length+'개 보기</summary>'+pending.map(card).join('')+'</details>';
 document.querySelectorAll('[data-market-detail]').forEach(b=>b.onclick=async()=>{
   const fp=b.dataset.marketDetail, target=document.getElementById('market-'+fp);
   b.disabled=true;
   try{
     const d=await api('/api/market-candidates/'+encodeURIComponent(fp));
     target.innerHTML='<div class="reason"><b>GitHub 수요 근거 '+d.signals.length+'건</b><br>'+d.signals.map((x,i)=>(i+1)+'. '+esc(x.title)+' · '+esc(x.source_item_id||'')+(x.url?' <a class="link" href="'+esc(x.url)+'" target="_blank" rel="noopener">원문</a>':'')).join('<br>')+'</div>';
   }catch(e){target.textContent='상세 조회 실패: '+e.message;}finally{b.disabled=false;}
 });
}
async function loadPaidJobs(){
 const rows=await api('/api/paid-jobs');
 const el=document.getElementById('paidJobsList');
 const money=j=>j.budget_min||j.budget_max?((j.currency||'')+' '+Number(j.budget_min||j.budget_max).toLocaleString()+(j.budget_max&&j.budget_max!==j.budget_min?' ~ '+Number(j.budget_max).toLocaleString():'')):'';
 el.innerHTML='<div class="sub" style="margin:14px 0 8px">💵 제작·납품 가능한 유료 일감 '+rows.length+'개</div>'+rows.map(j=>'<div class="card"><div class="title">'+esc(j.title)+'</div><div class="meta">'+esc([j.source,j.type,money(j),j.deadline?('마감 '+j.deadline):''].filter(Boolean).join(' · '))+'</div><div class="desc">'+esc(j.description||'')+'</div><div class="reason">'+esc(j.judge_reason||'')+'</div><div class="decisions"><button class="managerPlanBtn" data-job-id="'+esc(j.opportunity_id)+'">🧭 작업계획 보기</button><button class="sandboxRunBtn" data-job-id="'+esc(j.opportunity_id)+'">🧪 샌드박스 테스트</button><button class="clientIntakeBtn" data-job-id="'+esc(j.opportunity_id)+'">👤 고객정보</button><button class="productionRunBtn" data-job-id="'+esc(j.opportunity_id)+'">🏭 실제 제작</button> <a class="link" target="_blank" rel="noopener" href="'+esc(j.url)+'">원문/지원 페이지</a></div><div class="managerPlan" id="plan-'+esc(j.opportunity_id)+'"></div><div class="reason" id="sandbox-'+esc(j.opportunity_id)+'"></div><div class="reason" id="intake-'+esc(j.opportunity_id)+'"></div><div class="reason" id="production-'+esc(j.opportunity_id)+'"></div></div>').join('');
}
async function runSandbox(btn){
  const id=btn.dataset.jobId, el=document.getElementById('sandbox-'+id); if(!el)return;
  btn.disabled=true; const old=btn.textContent; btn.textContent='실행 요청 중…'; el.textContent='GitHub Actions 샌드박스 실행을 요청하고 있습니다.';
  try{
    const start=await api('/api/paid-jobs/'+encodeURIComponent(id)+'/sandbox',{method:'POST'});
    if(start.status!=='dispatched'){const missing=Array.isArray(start.missing_configuration)&&start.missing_configuration.length?' · 누락: '+start.missing_configuration.join(', '):'';el.textContent='샌드박스 상태: '+esc(start.status||'unknown')+esc(missing);return;}
    el.textContent='샌드박스 실행됨 · run '+esc(start.run_id)+' · 결과 확인 중…';
    for(let i=0;i<30;i++){
      await new Promise(r=>setTimeout(r,2000));
      const s=await api('/api/paid-jobs/'+encodeURIComponent(id)+'/sandbox');
      if(s.status==='completed'){
        const ok=s.conclusion==='success';
        el.innerHTML='<b>'+(ok?'✅ 샌드박스 테스트 성공':'❌ 샌드박스 테스트 실패')+'</b><br>GitHub run '+esc(s.github_run_id||'')+' · '+esc(s.log_summary||'');
        return;
      }
      if(s.status==='dispatch_failed'){el.textContent='샌드박스 dispatch 실패: '+esc(s.log_summary||'');return;}
      el.textContent='샌드박스 상태: '+esc(s.status||'running')+' · 결과 확인 중…';
    }
    el.textContent='샌드박스가 아직 실행 중입니다. 잠시 후 버튼을 다시 눌러 상태를 확인하세요.';
  }catch(err){el.textContent='샌드박스 실행 실패: '+esc(err.message);}
  finally{btn.disabled=false;btn.textContent=old;}
}


async function showClientIntake(btn){
  const id=btn.dataset.jobId, el=document.getElementById("intake-"+id); if(!el)return;
  btn.disabled=true; const old=btn.textContent; btn.textContent="불러오는 중…";
  try{
    const d=await api("/api/paid-jobs/"+encodeURIComponent(id)+"/intake");
    const a=d.answers||{}, sp=d.secret_present||{}, fields=d.spec?.fields||[];
    const fieldHtml=fields.map(f=>{
      const val=a[f.id]??""; const req=f.required?" *":""; const help=f.help?("<div class=\"intakeHelp\">"+esc(f.help)+"</div>"):"";
      let control="";
      if(f.type==="select"){control="<select data-intake-field=\""+esc(f.id)+"\">"+((f.options||[]).map(o=>"<option value=\""+esc(o.value)+"\" "+(String(val)===String(o.value)?"selected":"")+">"+esc(o.label)+"</option>").join(""))+"</select>";}
      else if(f.type==="textarea"){control="<textarea data-intake-field=\""+esc(f.id)+"\">"+esc(val)+"</textarea>";}
      else if(f.type==="password"){control="<input data-intake-field=\""+esc(f.id)+"\" type=\"password\" value=\"\" placeholder=\""+(sp[f.id]?"암호화 저장됨 — 변경할 때만 입력":"보안정보 입력")+"\">";}
      else {control="<input data-intake-field=\""+esc(f.id)+"\" type=\"text\" value=\""+esc(val)+"\">";}
      return "<div class=\"intakeField\"><label>"+esc(f.label)+req+(f.secret?" 🔐":"")+"</label>"+control+help+"</div>";
    }).join("");
    const status=d.status==="ready_for_build"?("<div class=\"intakeReady\">✅ 고객정보 준비 완료 · 실제 제작을 다시 누르면 반영됩니다.</div>"):("<div class=\"intakeMissing\">🟡 입력 진행 중 · 필수 "+esc(d.completion?.complete||0)+"/"+esc(d.completion?.required||0)+"</div>");
    el.innerHTML="<div class=\"card\" style=\"margin-top:10px\"><b>👤 고객정보 / Client Intake</b><div class=\"reason\" style=\"white-space:pre-wrap\"><b>고객에게 보낼 질문</b><br>"+esc(d.request_message||"")+"</div>"+status+"<div data-intake-form=\""+esc(id)+"\">"+fieldHtml+"<button class=\"clientIntakeSaveBtn\" data-job-id=\""+esc(id)+"\">💾 고객정보 저장</button></div></div>";
  }catch(err){el.innerHTML="<div class=\"empty error\">고객정보 조회 실패: "+esc(err.message)+"</div>";}
  finally{btn.disabled=false;btn.textContent=old;}
}
async function saveClientIntakeUi(btn){
  const id=btn.dataset.jobId, el=document.getElementById("intake-"+id); if(!el)return;
  btn.disabled=true; const old=btn.textContent; btn.textContent="저장 중…";
  try{
    const answers={}; el.querySelectorAll("[data-intake-field]").forEach(x=>answers[x.dataset.intakeField]=x.value);
    const d=await api("/api/paid-jobs/"+encodeURIComponent(id)+"/intake",{method:"POST",body:JSON.stringify({answers})});
    const fake={dataset:{jobId:id},disabled:false,textContent:"👤 고객정보"}; await showClientIntake(fake);
    if(d.status==="ready_for_build")alert("고객정보 준비 완료. 이제 실제 제작을 다시 누르면 고객정보가 반영됩니다.");
  }catch(err){alert("고객정보 저장 실패: "+err.message);}
  finally{btn.disabled=false;btn.textContent=old;}
}

async function runProduction(btn){
  const id=btn.dataset.jobId, el=document.getElementById('production-'+id); if(!el)return;
  btn.disabled=true; const old=btn.textContent; btn.textContent='제작 시작 중…'; el.textContent='Factory Worker가 납품 패키지를 생성하고 있습니다.';
  try{
    const start=await api('/api/paid-jobs/'+encodeURIComponent(id)+'/production',{method:'POST'});
    if(start.status==='sandbox_required'){el.innerHTML='<b>🧪 샌드박스 성공이 먼저 필요합니다.</b><br>같은 카드의 샌드박스 테스트를 성공시킨 뒤 다시 눌러주세요.';return;}
    if(start.status!=='dispatched'){const missing=Array.isArray(start.missing_configuration)&&start.missing_configuration.length?' · 누락: '+start.missing_configuration.join(', '):'';el.textContent='제작 상태: '+esc(start.status||'unknown')+esc(missing);return;}
    el.textContent='제작 실행됨 · '+esc(start.run_id)+' · Factory Worker/QC 결과 확인 중…';
    for(let i=0;i<40;i++){
      await new Promise(r=>setTimeout(r,2000));
      const p=await api('/api/paid-jobs/'+encodeURIComponent(id)+'/production');
      if(p.status==='completed'){
        const ok=p.conclusion==='success', sm=p.summary||{};
        const gate=sm.next_gate==='client_intake_required'?'고객정보 입력 필요':sm.next_gate==='secure_execution_approval'?'보안연동 승인 대기':sm.next_gate==='client_access_required'?'고객 계정·권한 연결 대기':'납품 검토 가능';
        el.innerHTML='<b>'+(ok?'✅ 제작 패키지 생성·QC 테스트 통과':'❌ 제작 패키지 테스트 실패')+'</b><br>GitHub run '+esc(p.github_run_id||'')+' · 파일 '+esc(sm.file_count||0)+'개 · QC '+esc(sm.qc_status||'')+' · '+esc(gate)+(ok?'<br><button class="productionPackageBtn" data-job-id="'+esc(id)+'">📦 결과물 파일 보기</button><button class="productionDownloadBtn" data-job-id="'+esc(id)+'">⬇ ZIP 다운로드</button>':'')+'<div id="production-package-'+esc(id)+'"></div>';
        return;
      }
      if(p.status==='dispatch_failed'){el.textContent='실제 제작 dispatch 실패: '+esc(p.log_summary||'');return;}
      el.textContent='제작 상태: '+esc(p.status||'running')+' · Factory Worker/QC 결과 확인 중…';
    }
    el.textContent='제작 작업이 아직 실행 중입니다. 잠시 후 다시 실제 제작 버튼을 눌러 상태를 확인하세요.';
  }catch(err){el.textContent='실제 제작 실패: '+esc(err.message);}
  finally{btn.disabled=false;btn.textContent=old;}
}

async function downloadProduction(btn){
  const id=btn.dataset.jobId; btn.disabled=true; const old=btn.textContent; btn.textContent='ZIP 준비 중…';
  try{
    const r=await fetch('/api/paid-jobs/'+encodeURIComponent(id)+'/production/download',{headers:headers()});
    if(!r.ok){const j=await r.json().catch(()=>({error:'다운로드 실패'}));throw new Error(j.error||('HTTP '+r.status));}
    const blob=await r.blob(), a=document.createElement('a'), url=URL.createObjectURL(blob);
    a.href=url; a.download='automation-factory-deliverable.zip'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(err){alert('ZIP 다운로드 실패: '+err.message);}
  finally{btn.disabled=false;btn.textContent=old;}
}

async function showProductionPackage(btn){
  const id=btn.dataset.jobId, target=document.getElementById('production-package-'+id); if(!target)return;
  btn.disabled=true;
  try{
    const d=await api('/api/paid-jobs/'+encodeURIComponent(id)+'/production/package');
    const files=d.files||[];
    target.innerHTML='<details open style="margin-top:8px"><summary>📦 생성 파일 '+esc(files.length)+'개</summary><div class="meta" style="white-space:pre-wrap;margin-top:8px">'+files.map(f=>'• '+esc(f.path)+' · '+esc(String(f.bytes||0))+' bytes').join('<br>')+'</div></details>';
  }catch(err){target.textContent='파일 목록 조회 실패: '+err.message;}
  finally{btn.disabled=false;}
}

async function showManagerPlan(btn){
 const id=btn.dataset.jobId, el=document.getElementById('plan-'+id); if(!el)return;
 btn.disabled=true; const old=btn.textContent; btn.textContent='분석 중…';
 try{
  const p=await api('/api/paid-jobs/'+encodeURIComponent(id)+'/plan');
  const req=(p.deliverables||p.requested_functions||[]).map(x=>'• '+esc(x)).join('<br>')||'• 명세 확인 필요';
  const qs=(p.clarification_questions||[]).map((x,i)=>(i+1)+'. '+esc(x)).join('<br>');
  const fb=p.factory_builder||{}; const bt=(fb.tasks||[]).map(t=>'• '+esc(t.id)+' · '+esc(t.worker)+' · '+esc(t.title)+' ['+esc(t.status)+']'+(t.blocked_by?' — '+esc(t.blocked_by):'')).join('<br>');
  const wx=p.worker_execution||{}; const wj=(wx.jobs||[]).map(j=>'• '+esc(j.task_id)+' · '+esc(j.worker)+' ['+esc(j.state)+']').join('<br>');
  const br=p.build_runtime||{}, ag=p.artifact_generator||{}, cw=p.code_worker||{}, qc=p.qc||{}; const arts=(br.artifacts||[]).map(a=>'• '+esc(a.artifact_id)+' · '+esc(a.path)).join('<br>');
  const d=p.input_diagnostics||{};
  const diag='<details style="margin:10px 0"><summary>🔎 Manager 실제 입력 진단</summary><div class="meta" style="white-space:pre-wrap;margin-top:8px">TITLE: '+esc(d.title||'')+'\\nDESCRIPTION LENGTH: '+esc(d.description_length)+'\\nDESCRIPTION: '+esc(d.description||'')+'\\nSKILLS: '+esc(d.skills||'')+'\\nURL: '+esc(d.url||'')+'\\nANALYSIS LENGTH: '+esc(d.analysis_text_length)+'\\nANALYSIS PREVIEW: '+esc(d.analysis_preview||'')+'</div></details>';
  el.innerHTML='<div class="reason" style="margin-top:12px"><div class="meta">Manager '+esc(p.manager_version)+' · '+esc(p.build_spec?.spec_version||'no-build-spec')+'</div>'+diag+'<b>🧩 요구 기능</b><br>'+req+'<br><br><b>🏭 Factory Builder</b><br>'+esc(fb.builder_version||'')+' · 준비 '+esc(fb.ready_tasks||0)+' · 외부권한 대기 '+esc(fb.blocked_tasks||0)+'<br>'+bt+'<br><br><b>⚙️ Worker Execution</b><br>'+esc(wx.execution_version||'')+' · 내부 제작큐 '+esc(wx.queued_internal_builds||0)+' · 고객권한 대기 '+esc(wx.waiting_for_client_access||0)+'<br>'+wj+'<br><br><b>📦 Build Runtime</b><br>'+esc(br.runtime_version||'')+' · 산출물 '+esc(br.artifact_count||0)+'개<br>'+arts+'<br><br><b>🛠 Artifact Generator</b><br>'+esc(ag.generator_version||'')+' · 실제 초안 '+esc(ag.generated_count||0)+'개 · '+esc(ag.total_bytes||0)+' bytes<br><br><b>💻 Code Worker</b><br>'+esc(cw.code_worker_version||'')+' · '+esc(cw.status||'')+' · 파일 '+esc(cw.file_count||0)+'개 · 테스트 '+esc(cw.test_execution||'')+'<br><br><b>🧪 QC</b><br>'+esc(qc.qc_version||'')+' · '+esc(qc.status||'')+' · '+esc(qc.passed||0)+'/'+esc(qc.total||0)+'<br><br><b>❓ 고객 확인 질문</b><br>'+qs+'<br><br><b>⏱ 예상 제작</b> '+esc(p.estimated_build_hours)+'시간 · <b>외부비용</b> '+(p.external_cost_status==='needs_validation'||p.estimated_external_cost==null?'확인 필요':esc(p.estimated_external_cost))+' · <b>위험도</b> '+esc(p.delivery_risk)+'<br><br><b>✉️ 지원 메시지 초안</b><br>'+esc(p.proposal_draft)+'<br><br><b>상태</b> '+esc(p.status)+' — 승인 전에는 자동 지원/전송하지 않음</div>';
 }catch(err){el.innerHTML='<div class="empty error">작업계획 조회 실패: '+esc(err.message)+'</div>';}
 finally{btn.disabled=false;btn.textContent=old;}
}

document.addEventListener('click',async e=>{
 const intakeSave=e.target.closest('.clientIntakeSaveBtn'); if(intakeSave){await saveClientIntakeUi(intakeSave);return;}
 const intakeBtn=e.target.closest('.clientIntakeBtn'); if(intakeBtn){await showClientIntake(intakeBtn);return;}
 const downloadBtn=e.target.closest('.productionDownloadBtn'); if(downloadBtn){await downloadProduction(downloadBtn);return;}
 const packageBtn=e.target.closest('.productionPackageBtn'); if(packageBtn){await showProductionPackage(packageBtn);return;}
 const production=e.target.closest('.productionRunBtn'); if(production){await runProduction(production);return;}
 const sandbox=e.target.closest('.sandboxRunBtn'); if(sandbox){await runSandbox(sandbox);return;}
  const plan=e.target.closest('.managerPlanBtn'); if(plan){await showManagerPlan(plan);return;}
 const paid=e.target.closest('#paidJobsBtn'); if(paid){paid.disabled=true;try{await loadPaidJobs()}catch(err){alert(err.message)}finally{paid.disabled=false}return;}\n const b=e.target.closest('#candidateBtn'); if(!b)return;
 e.preventDefault(); b.disabled=true; const old=b.textContent; b.textContent='시장후보 불러오는 중…';
 const el=document.getElementById('candidateList'); el.innerHTML='<div class="empty">시장후보 불러오는 중…</div>';
 try{await loadMarketCandidates();el.scrollIntoView({behavior:'smooth',block:'start'});}
 catch(err){el.innerHTML='<div class="empty error">시장후보 조회 실패: '+esc(err.message)+'</div>';alert('시장후보 조회 실패: '+err.message);}
 finally{b.disabled=false;b.textContent=old;}
});
load().catch(e=>document.getElementById('list').innerHTML='<div class="empty error">오류: '+esc(e.message)+'</div>');
</script></body></html>`;
}

export default {
  async fetch(request, env, ctx) {
    globalThis.__moneyScoutCtx = ctx;
    try {
      await ensureSchema(env);
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/api/health") {
        return json({
          ok: true,
          app: APP_NAME,
          version: APP_VERSION,
          time: nowIso(),
          sources: Object.keys(SOURCE_REGISTRY),
          security_mode: env.ADMIN_TOKEN ? "관리키 보호" : "OPEN(테스트용)"
        });
      }
      const evidenceMatch = path.match(/^\/api\/opportunities\/([^/]+)\/evidence$/);
      if (evidenceMatch && request.method === "GET") {
        const id = decodeURIComponent(evidenceMatch[1]);
        const rows = await env.DB.prepare(`SELECT evidence_key AS evidence_id,source,app_id,app_name,evidence_kind,evidence_quality,complaint_bearing,rating,text,url,posted_at FROM opportunity_evidence WHERE opportunity_id=? ORDER BY complaint_bearing DESC, rating ASC LIMIT 20`).bind(id).all();
        return json(rows.results || []);
      }
      if (path === "/api/pipeline/run" && request.method === "POST") {
        const denied = requireAdmin(request, env); if (denied) return denied;
        return json(await runMoneyPipeline(env));
      }

      const intakeMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/intake$/);
      if(intakeMatch&&(request.method==="GET"||request.method==="POST")){
        const denied=requireAdmin(request,env);if(denied)return denied;
        const id=decodeURIComponent(intakeMatch[1]), row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(id).first();
        if(!row)return json({ok:false,error:"Paid job not found"},404);
        let bd={};try{bd=JSON.parse(row.score_breakdown||"{}")}catch{}
        if(!bd.actionable_paid_job||!bd.factory_fulfillable)return json({ok:false,error:"Factory-ready paid job only"},400);
        const plan=paidJobPlan(row);
        if(request.method==="GET")return json(await getClientIntake(env,row,plan));
        const body=await request.json().catch(()=>({})); return json(await saveClientIntake(env,row,plan,body));
      }
      const sandboxBundleMatch=path.match(/^\/api\/sandbox-runs\/([^/]+)\/bundle$/);
      if(sandboxBundleMatch&&request.method==="GET"){
        if(!env.SANDBOX_CALLBACK_TOKEN||request.headers.get("authorization")!=="Bearer "+env.SANDBOX_CALLBACK_TOKEN)return json({ok:false,error:"Unauthorized"},401);
        const r=await env.DB.prepare("SELECT bundle_json,status FROM sandbox_runs WHERE run_id=?").bind(decodeURIComponent(sandboxBundleMatch[1])).first();
        if(!r)return json({ok:false,error:"Sandbox run not found"},404);
        return json(JSON.parse(r.bundle_json||"{}"));
      }
      const sandboxResultMatch=path.match(/^\/api\/sandbox-runs\/([^/]+)\/result$/);
      if(sandboxResultMatch&&request.method==="POST"){
        if(!env.SANDBOX_CALLBACK_TOKEN||request.headers.get("authorization")!=="Bearer "+env.SANDBOX_CALLBACK_TOKEN)return json({ok:false,error:"Unauthorized"},401);
        const body=await request.json(); const conclusion=body.conclusion==="success"?"success":"failure";
        await env.DB.prepare("UPDATE sandbox_runs SET status='completed',conclusion=?,log_summary=?,github_run_id=?,updated_at=? WHERE run_id=?").bind(conclusion,String(body.log_summary||"").slice(0,2000),String(body.github_run_id||""),nowIso(),decodeURIComponent(sandboxResultMatch[1])).run();
        return json({ok:true});
      }
      const sandboxStartMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/sandbox$/);
      if(sandboxStartMatch&&request.method==="POST"){const denied=requireAdmin(request,env);if(denied)return denied;return dispatchSandbox(request,env,decodeURIComponent(sandboxStartMatch[1]));}
      const sandboxStatusMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/sandbox$/);
      if(sandboxStatusMatch&&request.method==="GET"){
        const r=await env.DB.prepare("SELECT run_id,status,conclusion,log_summary,github_run_id,created_at,updated_at FROM sandbox_runs WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 1").bind(decodeURIComponent(sandboxStatusMatch[1])).first();
        return json(r||{status:"not_run"});
      }

      const productionBundleMatch=path.match(/^\/api\/production-runs\/([^/]+)\/bundle$/);
      if(productionBundleMatch&&request.method==="GET"){
        if(!env.SANDBOX_CALLBACK_TOKEN||request.headers.get("authorization")!=="Bearer "+env.SANDBOX_CALLBACK_TOKEN)return json({ok:false,error:"Unauthorized"},401);
        const r=await env.DB.prepare("SELECT bundle_json,status FROM production_runs WHERE run_id=?").bind(decodeURIComponent(productionBundleMatch[1])).first();
        if(!r)return json({ok:false,error:"Production run not found"},404);
        return json(JSON.parse(r.bundle_json||"{}"));
      }
      const productionResultMatch=path.match(/^\/api\/production-runs\/([^/]+)\/result$/);
      if(productionResultMatch&&request.method==="POST"){
        if(!env.SANDBOX_CALLBACK_TOKEN||request.headers.get("authorization")!=="Bearer "+env.SANDBOX_CALLBACK_TOKEN)return json({ok:false,error:"Unauthorized"},401);
        const body=await request.json(); const conclusion=body.conclusion==="success"?"success":"failure";
        await env.DB.prepare("UPDATE production_runs SET status='completed',conclusion=?,log_summary=?,github_run_id=?,updated_at=? WHERE run_id=?").bind(conclusion,String(body.log_summary||"").slice(0,2000),String(body.github_run_id||""),nowIso(),decodeURIComponent(productionResultMatch[1])).run();
        return json({ok:true});
      }
      const productionStartMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/production$/);
      if(productionStartMatch&&request.method==="POST"){const denied=requireAdmin(request,env);if(denied)return denied;return dispatchProduction(request,env,decodeURIComponent(productionStartMatch[1]));}
      const productionStatusMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/production$/);
      if(productionStatusMatch&&request.method==="GET"){
        const r=await env.DB.prepare("SELECT run_id,status,conclusion,log_summary,github_run_id,package_summary_json,created_at,updated_at FROM production_runs WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 1").bind(decodeURIComponent(productionStatusMatch[1])).first();
        if(!r)return json({status:"not_run"});
        let summary={};try{summary=JSON.parse(r.package_summary_json||"{}")}catch{}
        return json({...r,summary});
      }
      const productionDownloadMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/production\/download$/);
      if(productionDownloadMatch&&request.method==="GET"){
        const denied=requireAdmin(request,env);if(denied)return denied;
        if(!env.GITHUB_ACTIONS_TOKEN)return json({ok:false,error:"GITHUB_ACTIONS_TOKEN missing"},500);
        const r=await env.DB.prepare("SELECT run_id,github_run_id,status,conclusion FROM production_runs WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 1").bind(decodeURIComponent(productionDownloadMatch[1])).first();
        if(!r||r.status!=="completed"||r.conclusion!=="success"||!r.github_run_id)return json({ok:false,error:"Completed production artifact not found"},404);
        const ghHeaders={"authorization":"Bearer "+env.GITHUB_ACTIONS_TOKEN,"accept":"application/vnd.github+json","x-github-api-version":"2022-11-28","user-agent":"AutomationFactory-MoneyScout/0.18.0"};
        const ar=await fetch("https://api.github.com/repos/lsc1313/AutomationFactory/actions/runs/"+encodeURIComponent(r.github_run_id)+"/artifacts",{headers:ghHeaders});
        if(!ar.ok)return json({ok:false,error:"GitHub artifact lookup failed",detail:(await ar.text()).slice(0,500)},502);
        const data=await ar.json(), expected="job-package-"+r.run_id, artifact=(data.artifacts||[]).find(a=>a.name===expected&&!a.expired);
        if(!artifact)return json({ok:false,error:"Production ZIP is not available yet. Try again shortly."},404);
        const zr=await fetch(artifact.archive_download_url,{headers:ghHeaders,redirect:"follow"});
        if(!zr.ok)return json({ok:false,error:"GitHub artifact download failed",detail:(await zr.text()).slice(0,500)},502);
        const h=new Headers(zr.headers);h.set("content-type","application/zip");h.set("content-disposition",'attachment; filename="automation-factory-'+r.run_id+'.zip"');h.set("cache-control","no-store");
        return new Response(zr.body,{status:200,headers:h});
      }

      const productionPackageMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/production\/package$/);
      if(productionPackageMatch&&request.method==="GET"){
        const denied=requireAdmin(request,env);if(denied)return denied;
        const r=await env.DB.prepare("SELECT bundle_json,status,conclusion FROM production_runs WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 1").bind(decodeURIComponent(productionPackageMatch[1])).first();
        if(!r)return json({ok:false,error:"Production package not found"},404);
        const bundle=JSON.parse(r.bundle_json||"{}");
        const files=(bundle.files||[]).map(f=>({path:f.path,bytes:new TextEncoder().encode(String(f.content||"")).length}));
        return json({ok:true,status:r.status,conclusion:r.conclusion,bundle_version:bundle.bundle_version,files});
      }

      const paidPlanMatch = path.startsWith("/api/paid-jobs/") && path.endsWith("/plan") ? { 1: path.slice("/api/paid-jobs/".length, -"/plan".length) } : null;
      if (paidPlanMatch && request.method === "GET") {
        const id=decodeURIComponent(paidPlanMatch[1]);
        const row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(id).first();
        if(!row) return json({ok:false,error:"Paid job not found"},404);
        let bd={};try{bd=JSON.parse(row.score_breakdown||"{}")}catch{}
        if(!bd.actionable_paid_job||!bd.factory_fulfillable) return json({ok:false,error:"Factory-ready paid job only"},400);
        const plan=paidJobPlan(row); plan.factory_builder=factoryBuilder(plan); plan.worker_execution=workerExecutionPlan(plan); plan.build_runtime=buildRuntime(plan); plan.artifact_generator=artifactGenerator(plan); plan.code_worker=codeWorker(plan); plan.qc=qcPlan(plan); return json(plan);
      }
      if (path === "/api/paid-jobs") {
        const paidSources = ["freelancer_projects","agent_bounties","github_paid"].filter(x => SOURCE_REGISTRY[x]);
        const staleJudge = await env.DB.prepare(`SELECT COUNT(*) AS c FROM opportunities WHERE source IN ('freelancer_projects','agent_bounties','github_paid') AND COALESCE(json_extract(score_breakdown,'$.judge_version'),'') != 'work-spec-gate-v0.7.8'`).first();
        if (Number(staleJudge?.c || 0) > 0) await rejudgeAll(env);
        const latestPaid = await env.DB.prepare(`SELECT MAX(last_seen_at) AS last_seen FROM opportunities WHERE source IN ('freelancer_projects','agent_bounties','github_paid')`).first();
        const ageMs = latestPaid?.last_seen ? Date.now() - Date.parse(latestPaid.last_seen) : Infinity;
        // Paid jobs are the fast-cash surface: refresh only these sources when stale.
        // waitUntil keeps the UI responsive; the next poll receives the fresh rows.
        if (ageMs > 30 * 60 * 1000 && paidSources.length) {
          const refresh = runScout(env, paidSources).catch(() => null);
          if (globalThis.__moneyScoutCtx?.waitUntil) globalThis.__moneyScoutCtx.waitUntil(refresh);
          else await refresh;
        }

        const rows = await env.DB.prepare(`SELECT * FROM opportunities WHERE user_state!='reject' AND json_extract(score_breakdown,'$.judge_version')='work-spec-gate-v0.7.8' AND json_extract(score_breakdown,'$.factory_fulfillable')=1 AND json_extract(score_breakdown,'$.actionable_paid_job')=1 ORDER BY score DESC,last_seen_at DESC LIMIT 50`).all();
        return json(rows.results || []);
      }
      if (path === "/api/market-candidates") {
        const rows = await env.DB.prepare(`SELECT * FROM market_candidates ORDER BY CASE commercialization_status WHEN 'verified_money' THEN 0 ELSE 1 END, independent_repo_count DESC, raw_market_evidence_count DESC, fingerprint ASC LIMIT 100`).all();
        return json(rows.results || []);
      }
      const marketCandidateMatch = path.match(/^\/api\/market-candidates\/([^/]+)$/);
      if (marketCandidateMatch) {
        const fingerprint = decodeURIComponent(marketCandidateMatch[1]);
        const candidate = await env.DB.prepare("SELECT * FROM market_candidates WHERE fingerprint=?").bind(fingerprint).first();
        if (!candidate) return json({ ok:false, error:"Market candidate not found" },404);
        const signals = await env.DB.prepare(`SELECT opportunity_id,title,source_item_id,score,grade,judge_reason,url,score_breakdown FROM opportunities WHERE source='github_demand' AND skills LIKE ? ORDER BY score DESC,last_seen_at DESC LIMIT 20`).bind("%demand_fingerprint:"+fingerprint+"%").all();
        return json({ ...candidate, signals: signals.results || [] });
      }
      if (path === "/api/stats") return json(await getStats(env));
      if (path === "/api/opportunities") return json(await listOpportunities(env, url));
      if (path === "/api/runs") return json(await listRuns(env));

      if (path === "/api/scout/run" && request.method === "POST") {
        const denied = requireAdmin(request, env); if (denied) return denied;
        let body = {};
        try { body = await request.json(); } catch {}
        return json(await runScout(env, Array.isArray(body.sources) ? body.sources : null));
      }

      if (path.startsWith("/api/opportunities/") && path.endsWith("/decision") && request.method === "POST") {
        const denied = requireAdmin(request, env); if (denied) return denied;
        const id = decodeURIComponent(path.slice("/api/opportunities/".length, -"/decision".length));
        const body = await request.json();
        await setDecision(env, id, String(body.state || ""));
        return json({ ok: true });
      }

      if (path === "/api/marketplace/rebuild" && request.method === "POST") {
        const denied = requireAdmin(request, env); if (denied) return denied;
        return json(await rebuildMarketplace(env));
      }

      if (path === "/api/validate/markets" && request.method === "POST") {
        const denied = requireAdmin(request, env); if (denied) return denied;
        return json(await crossValidateMarkets(env));
      }

      if (path === "/api/judge/rejudge" && request.method === "POST") {
        const denied = requireAdmin(request, env); if (denied) return denied;
        return json(await rejudgeAll(env));
      }

      if (path === "/api/opportunities/import" && request.method === "POST") {
        const denied = requireAdmin(request, env); if (denied) return denied;
        const body = await request.json();
        const items = Array.isArray(body) ? body : [body];
        const out = [];
        for (const item of items.slice(0, 100)) out.push(await upsertOpportunity(env, { ...item, source: item.source || "manual" }));
        return json({ ok: true, count: out.length, results: out });
      }

      if (path.startsWith("/api/")) return json({ ok: false, error: "Not found" }, 404);
      return html(appHtml());
    } catch (error) {
      return json({ ok: false, error: error?.message || String(error), version: APP_VERSION }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runMoneyPipeline(env));
  }
};
