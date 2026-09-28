import { judgeOpportunity } from "./judge.js";
import { collectSources, SOURCE_REGISTRY, collectMarketplaceValidationEvidence } from "./sources.js";

const APP_VERSION = "0.8.0";
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
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#070d18,#0b1321);font-family:system-ui,-apple-system,sans-serif;color:var(--text)}button,input,select{font:inherit}.wrap{max-width:1120px;margin:auto;padding:18px 14px 44px}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.brand{font-size:25px;font-weight:900}.sub{color:var(--muted);font-size:12px;line-height:1.5}.badge{border:1px solid var(--line);border-radius:999px;padding:7px 10px;color:var(--muted);font-size:12px}.notice{margin:12px 0;padding:10px 12px;border:1px solid var(--line);background:var(--panel2);border-radius:12px;color:var(--muted);font-size:12px}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:14px 0}.stat{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:13px}.stat b{display:block;font-size:22px;margin-top:4px}.toolbar{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.toolbar button,.action{background:#17243a;color:white;border:1px solid #34435c;border-radius:10px;padding:9px 11px;font-weight:800}.toolbar button.active{background:#264e82;border-color:#6da7ff}.scan{background:#173d2c!important}.token{display:flex;gap:7px;margin:10px 0}.token input{min-width:0;flex:1;background:#0d1624;color:white;border:1px solid var(--line);border-radius:10px;padding:10px}.token button{background:#17243a;color:white;border:1px solid var(--line);border-radius:10px;padding:9px 11px}.filters{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.filters select{background:#0d1624;color:white;border:1px solid var(--line);border-radius:10px;padding:9px 10px}.card{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:14px;margin:10px 0}.head{display:flex;gap:10px;justify-content:space-between}.title{font-size:16px;font-weight:900;line-height:1.35}.score{min-width:54px;text-align:center;border-radius:12px;padding:8px 7px;font-size:20px;font-weight:950;background:#0b1422;border:1px solid var(--line)}.score small{display:block;font-size:9px;color:var(--muted);font-weight:700}.meta,.reason{color:var(--muted);font-size:12px;margin-top:7px;line-height:1.5}.metrics{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.metric{font-size:11px;padding:5px 7px;border-radius:8px;background:#0b1422;border:1px solid var(--line);color:#cbd6e5}.desc{font-size:13px;line-height:1.55;margin-top:9px;color:#d9e1ed;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.pill{display:inline-block;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:900}.hot{background:#123d2a;color:#6bf0aa}.watch{background:#493914;color:#ffdc7f}.cold{background:#252d3a;color:#b0bbca}.paycheck{background:#273657;color:#aecdff}.decisions{display:flex;gap:6px;flex-wrap:wrap;margin-top:11px}.decisions button{border:1px solid var(--line);background:#0e1828;color:white;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:850}.decisions button.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}.link{color:#9fc5ff;text-decoration:none}.empty{text-align:center;color:var(--muted);padding:42px 5px}.runinfo{color:var(--muted);font-size:11px;margin:10px 0}.runerrors{display:none;margin:8px 0 12px;padding:10px 12px;border:1px solid #633845;background:#24131a;border-radius:10px;color:#ffb4bd;font-size:11px;line-height:1.55;white-space:pre-wrap}.footer{color:var(--muted);font-size:11px;text-align:center;margin-top:28px}.error{color:#ffabb3}
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
  <div class="footer">v0.8.0 · Paid Discovery Diagnostics · 수집량/페이지 진단 · 수집→검증→후보 자동화</div>
</div>
<script>
let grade='all';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tokenEl=document.getElementById('token');
tokenEl.value=localStorage.getItem('af_admin_token')||'';
function headers(){const h={'content-type':'application/json'};const t=localStorage.getItem('af_admin_token')||'';if(t)h['x-admin-token']=t;return h;}
async function api(url,opt={}){const r=await fetch(url,{...opt,headers:{...headers(),...(opt.headers||{})}});const j=await r.json().catch(()=>({error:'응답 해석 실패'}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j;}
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
 el.innerHTML='<div class="sub" style="margin:14px 0 8px">💵 지금 지원 가능한 유료 일감 '+rows.length+'개</div>'+rows.map(j=>'<div class="card"><div class="title">'+esc(j.title)+'</div><div class="meta">'+esc([j.source,j.type,money(j),j.deadline?('마감 '+j.deadline):''].filter(Boolean).join(' · '))+'</div><div class="desc">'+esc(j.description||'')+'</div><div class="reason">'+esc(j.judge_reason||'')+'</div><div class="decisions"><a class="link" target="_blank" rel="noopener" href="'+esc(j.url)+'">원문/지원 페이지</a></div></div>').join('');
}
document.addEventListener('click',async e=>{
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
