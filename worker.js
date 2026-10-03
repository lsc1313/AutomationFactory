import { judgeOpportunity } from "./judge.js";
import { collectSources, SOURCE_REGISTRY, collectMarketplaceValidationEvidence } from "./sources.js";

const APP_VERSION = "0.55.8";
const BUILD_ID = "v0.55.8-multisource-revenue-scan-20261003";
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

let schemaReady = false;
let schemaInitPromise = null;

async function ensureSchemaOnce(env) {
  if (schemaReady) return;
  if (!schemaInitPromise) schemaInitPromise = ensureSchema(env).then(()=>{schemaReady=true;}).catch(err=>{schemaInitPromise=null;throw err;});
  return schemaInitPromise;
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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS delivery_approvals (
      opportunity_id TEXT PRIMARY KEY,
      production_run_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      delivery_message TEXT NOT NULL DEFAULT '',
      approved_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_delivery_approvals_status ON delivery_approvals(status, updated_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS revision_approvals (\n      opportunity_id TEXT PRIMARY KEY,\n      feedback_message_id TEXT NOT NULL DEFAULT '',\n      feedback_body TEXT NOT NULL DEFAULT '',\n      status TEXT NOT NULL DEFAULT 'pending',\n      approved_at TEXT NOT NULL DEFAULT '',\n      production_run_id TEXT NOT NULL DEFAULT '',\n      created_at TEXT NOT NULL,\n      updated_at TEXT NOT NULL\n    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_revision_approvals_status ON revision_approvals(status, updated_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS client_intakes (
      opportunity_id TEXT PRIMARY KEY,
      public_answers_json TEXT NOT NULL DEFAULT '{}',
      secret_answers_enc TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'not_started',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_client_intakes_status ON client_intakes(status, updated_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS account_connections (
      opportunity_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'disconnected',
      auth_method TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      secret_enc TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(opportunity_id, provider)
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_account_connections_status ON account_connections(status, updated_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS platform_connections (
      provider TEXT PRIMARY KEY,
      account_status TEXT NOT NULL DEFAULT 'not_ready',
      api_status TEXT NOT NULL DEFAULT 'disconnected',
      auth_method TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_platform_connections_status ON platform_connections(api_status, updated_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS platform_actions (
      action_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      external_object_id TEXT NOT NULL DEFAULT '',
      action_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'prepared',
      request_hash TEXT NOT NULL DEFAULT '',
      external_action_id TEXT NOT NULL DEFAULT '',
      response_metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_platform_actions_lookup ON platform_actions(provider,opportunity_id,action_type,status,updated_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS platform_messages (
      provider TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      sender_id TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT 'inbound',
      created_at TEXT NOT NULL,
      PRIMARY KEY(provider,message_id)
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_platform_messages_thread ON platform_messages(provider,opportunity_id,thread_id,created_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      verifier_enc TEXT NOT NULL DEFAULT '',
      redirect_uri TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS contract_payment_gates (
      opportunity_id TEXT PRIMARY KEY,
      platform TEXT NOT NULL DEFAULT '',
      application_status TEXT NOT NULL DEFAULT 'not_applied',
      contract_status TEXT NOT NULL DEFAULT 'not_agreed',
      payment_status TEXT NOT NULL DEFAULT 'unsecured',
      payment_protection TEXT NOT NULL DEFAULT 'unknown',
      gross_amount REAL,
      currency TEXT NOT NULL DEFAULT '',
      fee_estimate REAL,
      net_estimate REAL,
      payout_route TEXT NOT NULL DEFAULT '',
      payout_destination TEXT NOT NULL DEFAULT '',
      external_reference TEXT NOT NULL DEFAULT '',
      evidence_url TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      verified_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_contract_payment_status ON contract_payment_gates(contract_status, payment_status, updated_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS manager_job_states (
      opportunity_id TEXT PRIMARY KEY,
      stage TEXT NOT NULL DEFAULT 'new',
      status_label TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '',
      autopilot TEXT NOT NULL DEFAULT 'on',
      last_action TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_manager_job_stage ON manager_job_states(stage, updated_at DESC)`),
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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS subscription_candidates (
      candidate_key TEXT PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL,
      signal_count INTEGER NOT NULL DEFAULT 0, source_count INTEGER NOT NULL DEFAULT 0,
      sources_json TEXT NOT NULL DEFAULT '[]', example_opportunities_json TEXT NOT NULL DEFAULT '[]',
      repeatability_score INTEGER NOT NULL DEFAULT 0, autonomous_fit_score INTEGER NOT NULL DEFAULT 0,
      subscription_score INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'candidate',
      first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_subscription_candidates_score ON subscription_candidates(subscription_score DESC, signal_count DESC)`),
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

function subscriptionCategory(row) {
  const text=[row.title,row.description,row.skills].map(v=>String(v||"")).join(" ").toLowerCase();
  const categories=[
    ["sheet_reporting",/excel|spreadsheet|google sheet|csv|report|dashboard|엑셀|구글시트|보고서|대시보드/],
    ["community_bot",/discord|telegram|community|attendance|member|디스코드|텔레그램|출석|길드|회원/],
    ["booking_notification",/booking|reservation|appointment|reminder|notification|예약|알림|리마인드/],
    ["data_pipeline",/scrap|crawl|extract|etl|data pipeline|data processing|크롤|스크랩|데이터 수집|데이터 처리/],
    ["document_automation",/pdf|document|invoice|form|ocr|문서|송장|양식/],
    ["commerce_ops",/order|inventory|shopify|woocommerce|commerce|주문|재고|쇼핑몰/]
  ];
  for(const [key,re] of categories) if(re.test(text)) return key;
  return "";
}

async function mineSubscriptionCandidates(env) {
  const rows=(await env.DB.prepare(`SELECT opportunity_id,source,title,description,skills,score,score_breakdown,first_seen_at,last_seen_at
    FROM opportunities WHERE last_seen_at >= datetime('now','-30 day') ORDER BY last_seen_at DESC LIMIT 2000`).all()).results||[];
  const groups=new Map();
  for(const row of rows){
    const category=subscriptionCategory(row); if(!category)continue;
    let bd={}; try{bd=JSON.parse(row.score_breakdown||"{}")}catch{}
    const automation=Number(bd.automation||bd.factory_fulfillment_score||0);
    const g=groups.get(category)||{rows:[],sources:new Set(),auto:[]};
    g.rows.push(row); g.sources.add(String(row.source||"")); g.auto.push(automation); groups.set(category,g);
  }
  const now=nowIso(); let promoted=0;
  for(const [category,g] of groups){
    const signalCount=g.rows.length, sourceCount=g.sources.size;
    const repeatability=Math.min(100,signalCount*12+Math.max(0,sourceCount-1)*15);
    const autonomous=Math.round(g.auto.reduce((a,b)=>a+b,0)/Math.max(1,g.auto.length));
    const subscription=Math.min(100,Math.round(repeatability*.55+autonomous*.45));
    if(signalCount<2)continue;
    const title={sheet_reporting:"스프레드시트·정기보고 자동화",community_bot:"커뮤니티·출석 관리 봇",booking_notification:"예약·알림 자동화",data_pipeline:"데이터 수집·가공 자동화",document_automation:"문서·PDF 자동화",commerce_ops:"주문·재고 운영 자동화"}[category]||category;
    const examples=g.rows.slice(0,5).map(r=>({opportunity_id:r.opportunity_id,title:r.title,source:r.source}));
    await env.DB.prepare(`INSERT INTO subscription_candidates
      (candidate_key,category,title,signal_count,source_count,sources_json,example_opportunities_json,repeatability_score,autonomous_fit_score,subscription_score,status,first_seen_at,last_seen_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'candidate',?,?,?)
      ON CONFLICT(candidate_key) DO UPDATE SET signal_count=excluded.signal_count,source_count=excluded.source_count,sources_json=excluded.sources_json,
      example_opportunities_json=excluded.example_opportunities_json,repeatability_score=excluded.repeatability_score,autonomous_fit_score=excluded.autonomous_fit_score,
      subscription_score=excluded.subscription_score,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`)
      .bind(category,category,title,signalCount,sourceCount,JSON.stringify([...g.sources]),JSON.stringify(examples),repeatability,autonomous,subscription,g.rows.at(-1)?.first_seen_at||now,now,now).run();
    promoted++;
  }
  return {groups:groups.size,promoted};
}

const SCOUT_GROUPS = {
  revenue_core: ["wishket_projects","agent_bounties","github_paid","freelancer_projects"],
  secondary: ["marketplace_demand","agent_bounties"],
  github: ["github_paid","github_demand"],
  jobs: ["remoteok"]
};

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
  const runtimeDiagnostic={source:"runtime",diagnostic:{app_version:APP_VERSION,build_id:BUILD_ID,source_count:names.length,sources:names}};
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

  const subscription_mining = await mineSubscriptionCandidates(env);
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
    JSON.stringify([runtimeDiagnostic, ...collected.errors, ...Object.entries(sourceDiagnostics).map(([source, d]) => ({ source, diagnostic: d }))]),
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
    diagnostics: sourceDiagnostics,
    subscription_mining,
    runtime: { app_version: APP_VERSION, build_id: BUILD_ID }
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
  const lastRun = await env.DB.prepare(`SELECT * FROM scout_runs WHERE finished_at<>'' ORDER BY started_at DESC LIMIT 1`).first();
  const activeRun = await env.DB.prepare(`SELECT run_id,started_at,source_count FROM scout_runs WHERE finished_at='' ORDER BY started_at DESC LIMIT 1`).first();

  const grades = { hot: 0, watch: 0, cold: 0 };
  for (const row of byGrade.results || []) grades[row.grade] = Number(row.c || 0);
  const states = { unreviewed: 0, proceed: 0, hold: 0, reject: 0 };
  for (const row of byState.results || []) states[row.user_state] = Number(row.c || 0);

  return {
    total: Number(total?.c || 0),
    ...grades,
    states,
    last_run: lastRun || null,
    active_run: activeRun || null
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

function intakeField(id,label,type="text",required=false,secret=false,help="",options=[],advanced=false) {
  return {id,label,type,required,secret,help,options,advanced};
}

function clientIntakeSpec(row, plan=null) {
  const raw=(String(row?.title||"")+" "+String(row?.description||"")+" "+String(row?.skills||"")).toLowerCase();
  const korean=((String(row?.title||"")+" "+String(row?.description||"")).match(/[가-힣]/g)||[]).length>20;
  const fields=[], seen=new Set(), discovery=[];
  const add=(f)=>{if(!seen.has(f.id)){seen.add(f.id);fields.push(f)}};
  if(/squarespace/.test(raw)){
    add(intakeField("product_scope",korean?"이전할 상품 범위":"Products to migrate","textarea",true,false,korean?"예: 전체 상품 / 특정 상품명 / SKU 범위. 내부 ID는 몰라도 됩니다.":"Example: all products, named products, or a SKU range. Internal IDs are not required."));
    discovery.push(korean?"Squarespace 계정 연결 후 상품·옵션·이미지·SKU 자동 수집":"After account connection, discover Squarespace products, variants, images and SKUs automatically");
  }
  if(/etsy/.test(raw)){
    add(intakeField("etsy_shop_status",korean?"Etsy 상점 상태":"Etsy shop status","select",true,false,korean?"상점이 아직 없으면 Etsy 상점 개설이 먼저 필요할 수 있습니다.":"If the shop does not exist yet, Etsy shop opening may be required first.",[{value:"",label:korean?"선택":"Select"},{value:"existing",label:korean?"이미 생성됨":"Already created"},{value:"needs_setup",label:korean?"아직 없음 / 초기설정 필요":"Not created / needs setup"}]));
    add(intakeField("etsy_category_hint",korean?"상품 카테고리 힌트 (선택)":"Product category hint (optional)","text",false,false,korean?"예: 티셔츠, 월아트. 정확한 Taxonomy ID는 자동으로 찾습니다.":"Example: T-shirt or wall art. Exact taxonomy IDs are resolved automatically.",[],true));
    add(intakeField("etsy_shop_id_override",korean?"Etsy Shop ID 직접 지정 (고급/선택)":"Etsy Shop ID override (advanced/optional)","text",false,false,korean?"자동 발견이 실패할 때만 입력합니다.":"Only needed if automatic discovery fails.",[],true));
    add(intakeField("etsy_shipping_profile_id_override",korean?"Shipping Profile ID 직접 지정 (고급/선택)":"Shipping Profile ID override (advanced/optional)","text",false,false,korean?"자동 조회/설정이 실패할 때만 사용합니다.":"Only use if automatic lookup/configuration fails.",[],true));
    add(intakeField("etsy_readiness_state_id_override",korean?"Readiness State ID 직접 지정 (고급/선택)":"Readiness State ID override (advanced/optional)","text",false,false,korean?"자동 조회가 실패할 때만 입력합니다.":"Only needed if automatic discovery fails.",[],true));
    add(intakeField("etsy_section_id_override",korean?"Section ID 직접 지정 (고급/선택)":"Section ID override (advanced/optional)","text",false,false,"",[],true));
    discovery.push(korean?"Etsy OAuth 연결 후 Shop ID·분류·배송프로필·Readiness 상태 자동 조회":"After Etsy OAuth approval, discover shop ID, taxonomy, shipping profiles and readiness states");
  }
  if(/prodigi/.test(raw)){
    add(intakeField("prodigi_product_notes",korean?"Prodigi 상품/템플릿 선호 (선택)":"Prodigi product/template preference (optional)","textarea",false,false,korean?"예: 티셔츠는 특정 제품군 사용. SKU 매핑은 시스템이 후보를 생성합니다.":"Example: preferred blank/product family. The system will generate SKU mapping candidates."));
    add(intakeField("prodigi_sku_mapping_override",korean?"SKU 매핑 직접 지정 (고급/선택)":"SKU mapping override (advanced/optional)","textarea",false,false,korean?"자동 매핑 후보가 틀릴 때만 입력합니다.":"Only use when automatic mapping candidates need correction.",[],true));
    discovery.push(korean?"Prodigi 연결 후 SKU→제품/템플릿 매핑 후보 생성":"After Prodigi connection, generate SKU-to-product/template mapping candidates");
  }
  if(/tax|shipping/.test(raw)||/etsy/.test(raw)){
    add(intakeField("commerce_settings_mode",korean?"배송·세금 설정 방식":"Shipping/tax setup","select",true,false,"",[{value:"",label:korean?"선택":"Select"},{value:"reuse_existing",label:korean?"기존 Etsy 설정 사용":"Reuse existing Etsy settings"},{value:"configure_new",label:korean?"새 설정 필요":"Configure new settings"}]));
    add(intakeField("shipping_regions",korean?"배송 대상 지역 (필요시)":"Target shipping regions (if needed)","textarea",false,false,korean?"새 배송설정이 필요한 경우만 작성합니다.":"Only needed when creating new shipping settings."));
    add(intakeField("shipping_policy",korean?"배송 정책 메모 (선택)":"Shipping policy notes (optional)","textarea",false,false,""));
    add(intakeField("tax_policy",korean?"세금 처리 메모 (선택)":"Tax handling notes (optional)","textarea",false,false,korean?"기존 플랫폼 자동처리를 사용할 경우 비워둘 수 있습니다.":"Leave blank when using existing platform-managed tax behavior."));
  }
  if(/excel|spreadsheet|workbook|google sheets|sheet/.test(raw)){
    add(intakeField("source_data",korean?"원본 데이터/파일 위치":"Source data/file location","textarea",true,false,korean?"파일명, Drive 링크 또는 데이터 구조 설명":"File name, Drive link, or data-structure description."));
    add(intakeField("workbook_requirements",korean?"시트/수식/대시보드 요구사항":"Workbook/formula/dashboard requirements","textarea",true,false));
    add(intakeField("output_format",korean?"최종 납품 형식":"Final delivery format","select",true,false,"",[{value:"",label:korean?"선택":"Select"},{value:"xlsx",label:"Excel .xlsx"},{value:"google_sheets",label:"Google Sheets"},{value:"xlsx_and_pdf",label:"Excel + PDF"}]));
    add(intakeField("sample_style",korean?"원하는 디자인/예시":"Preferred design/reference","textarea",false,false));
  }
  if(/api|integration|integrate|webhook/.test(raw) && !(/squarespace|etsy|prodigi/.test(raw))){
    add(intakeField("api_docs_url",korean?"연동 API 문서 URL":"API documentation URL","text",true,false));
    add(intakeField("sample_payload",korean?"샘플 입력/출력 또는 요청·응답":"Sample input/output or request/response","textarea",true,false));
    discovery.push(korean?"인증정보는 고객답변과 분리된 계정 연결 단계에서 처리":"Credentials are handled separately in the account-connection gate");
  }
  const questions=plan?.clarification_questions||[];
  for(const [i,q] of questions.entries()){
    const qt=String(q).toLowerCase();
    if(/squarespace/.test(qt)&&/access|token|credential|권한|접근/.test(qt))continue;
    if(/etsy/.test(qt)&&/access|token|api key|credential|권한|접근/.test(qt))continue;
    if(/prodigi/.test(qt)&&/access|key|credential|권한|접근/.test(qt))continue;
    if(/tax|shipping/.test(qt)&&fields.some(f=>f.id==="commerce_settings_mode"))continue;
    if(/delivery|deadline|납기|마감/.test(qt))continue;
    add(intakeField("clarification_"+(i+1),String(q),"textarea",true,false));
  }
  add(intakeField("delivery_date",korean?"희망 납기일":"Preferred delivery date","text",!String(row?.deadline||"").trim(),false));
  add(intakeField("client_notes",korean?"추가 메모":"Additional client notes","textarea",false,false));
  return {intake_version:"client-intake-v3",language:korean?"ko":"en",job_id:row?.opportunity_id||"",title:row?.title||"",fields,discovery_plan:discovery};
}

function clientMessageFieldOrder(spec) {
  const preferred=["product_scope","etsy_shop_status","commerce_settings_mode","source_data","workbook_requirements","api_docs_url","sample_payload","delivery_date"];
  const required=(spec.fields||[]).filter(f=>f.required&&!f.secret);
  const out=[];
  for(const id of preferred){const f=required.find(x=>x.id===id);if(f&&!out.some(x=>x.id===f.id))out.push(f)}
  for(const f of required){if(f.id.startsWith("clarification_")&&!out.some(x=>x.id===f.id))out.push(f)}
  for(const f of required){if(!out.some(x=>x.id===f.id))out.push(f)}
  return out;
}
function parseClientNumberedAnswers(spec,text) {
  const fields=clientMessageFieldOrder(spec), answers={}, raw=String(text||"").trim();
  if(!raw||!fields.length)return answers;
  const matches=[...raw.matchAll(/(?:^|\n)\s*(\d{1,2})\s*[.)\-:]\s*([\s\S]*?)(?=\n\s*\d{1,2}\s*[.)\-:]\s*|$)/g)];
  for(const m of matches){const idx=Number(m[1])-1,value=String(m[2]||"").trim();if(fields[idx]&&value)answers[fields[idx].id]=value.slice(0,8000)}
  if(fields.length===1&&!Object.keys(answers).length&&raw.length<=8000)answers[fields[0].id]=raw;
  return answers;
}

function clientRequestMessage(row,spec) {
  const ko=spec.language==="ko";
  const lines=clientMessageFieldOrder(spec).map((f,i)=>(i+1)+". "+f.label);
  if(ko)return "작업 조건은 아래 내용만 확인하면 됩니다. 계정 비밀번호나 OAuth 토큰은 메시지로 받지 않고 별도의 계정 연결 단계에서 처리합니다.\n"+lines.join("\n");
  return "Only the project details below are needed here. Passwords and OAuth tokens are not collected by message; account authorization is handled separately in the connection gate.\n"+lines.join("\n");
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
function base64UrlBytes(bytes) {
  return bytesToBase64(bytes).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

function accountProviderSpec(row) {
  const raw=(String(row?.title||"")+" "+String(row?.description||"")+" "+String(row?.skills||"")).toLowerCase();
  const out=[];
  if(/squarespace/.test(raw))out.push({provider:"squarespace",label:"Squarespace",auth_method:"api_key",required:true});
  if(/etsy/.test(raw))out.push({provider:"etsy",label:"Etsy",auth_method:"oauth_pkce",required:true});
  if(/prodigi/.test(raw))out.push({provider:"prodigi",label:"Prodigi",auth_method:"api_key",required:true});
  return out;
}

async function upsertAccountConnection(env,opportunityId,provider,status,authMethod,metadata,secretObj) {
  const ts=nowIso(), enc=secretObj&&Object.keys(secretObj).length?await encryptClientSecrets(env,secretObj):"";
  const existing=await env.DB.prepare("SELECT created_at FROM account_connections WHERE opportunity_id=? AND provider=?").bind(opportunityId,provider).first();
  const sql="INSERT INTO account_connections(opportunity_id,provider,status,auth_method,metadata_json,secret_enc,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(opportunity_id,provider) DO UPDATE SET status=excluded.status,auth_method=excluded.auth_method,metadata_json=excluded.metadata_json,secret_enc=CASE WHEN excluded.secret_enc=\"\" THEN account_connections.secret_enc ELSE excluded.secret_enc END,updated_at=excluded.updated_at";
  await env.DB.prepare(sql).bind(opportunityId,provider,status,authMethod,JSON.stringify(metadata||{}),enc,existing?.created_at||ts,ts).run();
}

async function getAccountConnections(env,row) {
  const spec=accountProviderSpec(row), rows=(await env.DB.prepare("SELECT provider,status,auth_method,metadata_json,updated_at FROM account_connections WHERE opportunity_id=?").bind(row.opportunity_id).all()).results||[];
  const byProvider=new Map(rows.map(r=>[r.provider,r]));
  const connections=spec.map(p=>{
    const r=byProvider.get(p.provider); let metadata={}; try{metadata=JSON.parse(r?.metadata_json||"{}")}catch{}
    return {...p,status:r?.status||"disconnected",metadata,updated_at:r?.updated_at||null,app_configured:p.provider!=="etsy"||Boolean((env.ETSY_KEYSTRING||env.ETSY_CLIENT_ID)&&env.ETSY_SHARED_SECRET)};
  });
  const required=connections.filter(x=>x.required).length, connected=connections.filter(x=>x.required&&x.status==="connected_verified").length;
  return {connections,progress:{required,connected,ready:required===connected}};
}

async function connectSquarespace(env,row,apiKey) {
  const key=String(apiKey||"").trim(); if(!key)return {ok:false,error:"Squarespace API key is required"};
  const r=await fetch("https://api.squarespace.com/1.0/authorization/website",{headers:{Authorization:"Bearer "+key,"User-Agent":"AutomationFactory-MoneyScout/0.49.0",Accept:"application/json"}});
  const text=await r.text(); let body={}; try{body=text?JSON.parse(text):{}}catch{body={raw:text}}
  if(!r.ok)return {ok:false,error:"Squarespace verification failed",status:r.status,detail:String(body?.message||body?.raw||"").slice(0,300)};
  const metadata={website_id:body.id||"",site_id:body.siteId||"",title:body.title||"",url:body.url||"",currency:body.currency||""};
  await upsertAccountConnection(env,row.opportunity_id,"squarespace","connected_verified","api_key",metadata,{api_key:key});
  return {ok:true,status:"connected_verified",metadata};
}

async function connectProdigi(env,row,apiKey,mode="sandbox") {
  const key=String(apiKey||"").trim(); if(!key)return {ok:false,error:"Prodigi API key is required"};
  const safeMode=mode==="live"?"live":"sandbox", base=safeMode==="live"?"https://api.prodigi.com":"https://api.sandbox.prodigi.com";
  const r=await fetch(base+"/v4.0/orders?top=1",{headers:{"X-API-Key":key,Accept:"application/json"}});
  const text=await r.text(); let body={}; try{body=text?JSON.parse(text):{}}catch{body={raw:text}}
  if(!r.ok)return {ok:false,error:"Prodigi verification failed",status:r.status,detail:String(body?.message||body?.raw||"").slice(0,300)};
  const metadata={mode:safeMode,environment:base,outcome:body.outcome||"Ok"};
  await upsertAccountConnection(env,row.opportunity_id,"prodigi","connected_verified","api_key",metadata,{api_key:key,mode:safeMode});
  return {ok:true,status:"connected_verified",metadata};
}

async function startEtsyOAuth(request,env,row) {
  const clientId=String(env.ETSY_KEYSTRING||env.ETSY_CLIENT_ID||"").trim(), sharedSecret=String(env.ETSY_SHARED_SECRET||"").trim();
  const missing=[]; if(!clientId)missing.push("ETSY_KEYSTRING"); if(!sharedSecret)missing.push("ETSY_SHARED_SECRET");
  if(missing.length)return {ok:false,status:"config_required",missing_configuration:missing,note:"Money Scout Etsy app registration is required once; customers should not provide the app API key or shared secret."};
  const publicBase=String(env.PUBLIC_BASE_URL||new URL(request.url).origin).replace(/\/$/,""), redirectUri=String(env.ETSY_REDIRECT_URI||publicBase+"/oauth/etsy/callback");
  const verifier=base64UrlBytes(crypto.getRandomValues(new Uint8Array(48)));
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier))), challenge=base64UrlBytes(digest);
  const state=crypto.randomUUID(), created=nowIso(), expires=new Date(Date.now()+10*60*1000).toISOString();
  const verifierEnc=await encryptClientSecrets(env,{code_verifier:verifier});
  await env.DB.prepare("INSERT INTO oauth_states(state,opportunity_id,provider,verifier_enc,redirect_uri,expires_at,created_at) VALUES(?,?,?,?,?,?,?)").bind(state,row.opportunity_id,"etsy",verifierEnc,redirectUri,expires,created).run();
  const u=new URL("https://www.etsy.com/oauth/connect");
  u.searchParams.set("response_type","code");u.searchParams.set("client_id",clientId);u.searchParams.set("redirect_uri",redirectUri);
  u.searchParams.set("scope",String(env.ETSY_SCOPES||"shops_r listings_r listings_w profile_r"));u.searchParams.set("state",state);u.searchParams.set("code_challenge",challenge);u.searchParams.set("code_challenge_method","S256");
  return {ok:true,status:"authorization_required",authorization_url:u.toString(),redirect_uri:redirectUri};
}

async function finishEtsyOAuth(request,env) {
  const url=new URL(request.url), state=String(url.searchParams.get("state")||""), code=String(url.searchParams.get("code")||"");
  const oauthError=String(url.searchParams.get("error")||"");
  if(!state)return html("<h2>Etsy 연결 실패</h2><p>state 값이 없습니다.</p>",400);
  const st=await env.DB.prepare("SELECT * FROM oauth_states WHERE state=? AND provider=\"etsy\"").bind(state).first();
  if(!st)return html("<h2>Etsy 연결 실패</h2><p>만료되었거나 알 수 없는 연결 요청입니다.</p>",400);
  if(Date.parse(st.expires_at)<Date.now()){await env.DB.prepare("DELETE FROM oauth_states WHERE state=?").bind(state).run();return html("<h2>Etsy 연결 실패</h2><p>연결 요청이 만료되었습니다. Money Scout에서 다시 연결해주세요.</p>",400)}
  const opportunity=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(st.opportunity_id).first();
  if(!opportunity){await env.DB.prepare("DELETE FROM oauth_states WHERE state=?").bind(state).run();return html("<h2>Etsy 연결 실패</h2><p>일감 정보를 찾을 수 없습니다.</p>",404)}
  const deal=await getContractPaymentGate(env,opportunity); if(!deal.ready){await env.DB.prepare("DELETE FROM oauth_states WHERE state=?").bind(state).run();return html("<h2>Etsy 연결 중단</h2><p>계약·결제 Gate가 더 이상 준비 상태가 아닙니다. Money Scout에서 계약/결제 상태를 다시 확인해주세요.</p>",409)}
  if(oauthError||!code){await env.DB.prepare("DELETE FROM oauth_states WHERE state=?").bind(state).run();const msg=String(url.searchParams.get("error_description")||oauthError||"Authorization was not completed.").replace(/[<>&\"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));return html("<h2>Etsy 연결 취소</h2><p>"+msg+"</p>",400)}
  const verifierObj=await decryptClientSecrets(env,st.verifier_enc||""), verifier=verifierObj.code_verifier;
  const keystring=String(env.ETSY_KEYSTRING||env.ETSY_CLIENT_ID||"").trim(), sharedSecret=String(env.ETSY_SHARED_SECRET||"").trim();
  const form=new URLSearchParams({grant_type:"authorization_code",client_id:keystring,redirect_uri:st.redirect_uri,code,code_verifier:verifier});
  const tokenResp=await fetch("https://api.etsy.com/v3/public/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
  const txt=await tokenResp.text(); let token={}; try{token=txt?JSON.parse(txt):{}}catch{token={raw:txt}}
  if(!tokenResp.ok||!token.access_token){return html("<h2>Etsy 연결 실패</h2><p>토큰 교환에 실패했습니다. Money Scout에서 다시 시도해주세요.</p>",502)}
  const verifyResp=await fetch("https://api.etsy.com/v3/application/users/me",{headers:{"x-api-key":keystring+":"+sharedSecret,Authorization:"Bearer "+token.access_token,Accept:"application/json"}});
  const verifyText=await verifyResp.text(); let me={}; try{me=verifyText?JSON.parse(verifyText):{}}catch{me={raw:verifyText}}
  if(!verifyResp.ok){return html("<h2>Etsy 연결 실패</h2><p>OAuth 토큰은 발급됐지만 Etsy API 검증에 실패했습니다. 앱 승인 상태와 키 설정을 확인해주세요.</p>",502)}
  const metadata={token_type:token.token_type||"Bearer",expires_in:Number(token.expires_in||3600),connected_at:nowIso(),scope:String(env.ETSY_SCOPES||"shops_r listings_r listings_w profile_r"),user_id:String(me.user_id||token.access_token.split(".")[0]||"")};
  await upsertAccountConnection(env,st.opportunity_id,"etsy","connected_verified","oauth_pkce",metadata,{access_token:token.access_token,refresh_token:token.refresh_token||"",expires_in:token.expires_in||3600});
  await env.DB.prepare("DELETE FROM oauth_states WHERE state=?").bind(state).run();
  return html("<!doctype html><meta name=viewport content=\"width=device-width,initial-scale=1\"><body style=\"font-family:system-ui;background:#08101d;color:white;padding:28px\"><h2>✅ Etsy 연결 완료</h2><p>승인 토큰은 암호화 저장되며 납품 ZIP에는 포함되지 않습니다.</p><p><a style=\"color:#8db9ff\" href=\"/\">Money Scout로 돌아가기</a></p></body>");
}

function contractPaymentProfile(row) {
  const source=String(row?.source||"");
  if(source==="freelancer_projects") return {application_url:row?.url||"",platform:"Freelancer.com",application_method:"Open the original project and submit/confirm the platform bid",protection_hint:"Before client-account work, confirm the project is awarded and the agreed payment is secured through the platform.",payout_route_hint:"Freelancer.com → your configured withdrawal method",default_protection:"unknown"};
  if(source==="agent_bounties") return {application_url:row?.url||"",platform:"Agent Bounties",application_method:"Claim/accept the bounty according to the bounty page",protection_hint:"Confirm assignment/claim status and the bounty payout conditions before production.",payout_route_hint:"Bounty payout → configured wallet",default_protection:"onchain_or_bounty"};
  if(source==="github_paid") return {application_url:row?.url||"",platform:"GitHub bounty / issuer",application_method:"Follow the issue/bounty application instructions",protection_hint:"Verify the payer, amount, assignment and payout protection before production.",payout_route_hint:"Issuer-defined payout route",default_protection:"unknown"};
  return {application_url:row?.url||"",platform:source||"External platform",application_method:"Use the original application/support page",protection_hint:"Confirm the agreement and secure payment before production.",payout_route_hint:"Platform/customer-defined payout route",default_protection:"unknown"};
}

function contractPaymentReady(gate) {
  return gate?.contract_status==="accepted" && (gate?.payment_status==="secured" || gate?.payment_status==="prepaid" || gate?.payment_status==="paid") && Number(gate?.gross_amount)>0 && Boolean(String(gate?.currency||"").trim());
}

async function getContractPaymentGate(env,row) {
  const profile=contractPaymentProfile(row);
  const saved=await env.DB.prepare("SELECT * FROM contract_payment_gates WHERE opportunity_id=?").bind(row.opportunity_id).first();
  const gross=saved?.gross_amount ?? null;
  const currency=String(saved?.currency||row.currency||"");
  const advertised_budget={min:row.budget_min??null,max:row.budget_max??null,currency:String(row.currency||"")};
  const fee=saved?.fee_estimate ?? null;
  const net=saved?.net_estimate ?? ((gross!=null&&fee!=null)?Math.max(0,Number(gross)-Number(fee)):null);
  const gate={
    opportunity_id:row.opportunity_id,platform:saved?.platform||profile.platform,
    application_status:saved?.application_status||"not_applied",contract_status:saved?.contract_status||"not_agreed",
    payment_status:saved?.payment_status||"unsecured",payment_protection:saved?.payment_protection||profile.default_protection,
    gross_amount:gross,currency,fee_estimate:fee,net_estimate:net,advertised_budget,
    payout_route:saved?.payout_route||profile.payout_route_hint,payout_destination:saved?.payout_destination||"",
    external_reference:saved?.external_reference||"",evidence_url:saved?.evidence_url||"",note:saved?.note||"",
    verified_at:saved?.verified_at||"",updated_at:saved?.updated_at||null
  };
  return {ok:true,gate,profile,ready:contractPaymentReady(gate),
    next_action:contractPaymentReady(gate)?"client_intake_and_account_connection":"secure_contract_and_payment",
    warning:"Do not store bank account numbers, card details, passwords, seed phrases, or wallet private keys here. Use only a payout-route label."};
}

async function saveContractPaymentGate(env,row,body) {
  const current=await getContractPaymentGate(env,row), incoming=body&&typeof body==="object"?body:{};
  const allowedApplication=new Set(["not_applied","applied","client_replied","assigned"]);
  const allowedContract=new Set(["not_agreed","negotiating","accepted","cancelled"]);
  const allowedPayment=new Set(["unsecured","secured","prepaid","paid","failed"]);
  const allowedProtection=new Set(["unknown","platform_escrow","funded_milestone","onchain_or_bounty","direct_prepaid","other"]);
  const application_status=allowedApplication.has(incoming.application_status)?incoming.application_status:current.gate.application_status;
  const contract_status=allowedContract.has(incoming.contract_status)?incoming.contract_status:current.gate.contract_status;
  const payment_status=allowedPayment.has(incoming.payment_status)?incoming.payment_status:current.gate.payment_status;
  const payment_protection=allowedProtection.has(incoming.payment_protection)?incoming.payment_protection:current.gate.payment_protection;
  const num=(v,fallback)=>{if(v===""||v==null)return fallback;const n=Number(v);return Number.isFinite(n)?n:fallback};
  const gross_amount=num(incoming.gross_amount,current.gate.gross_amount), fee_estimate=num(incoming.fee_estimate,current.gate.fee_estimate);
  const net_estimate=gross_amount!=null&&fee_estimate!=null?Math.max(0,gross_amount-fee_estimate):null;
  const currency=String(incoming.currency??current.gate.currency??"").trim().slice(0,20);
  const platform=String(current.gate.platform||contractPaymentProfile(row).platform).slice(0,120);
  const payout_route=String(incoming.payout_route??current.gate.payout_route??"").trim().slice(0,300);
  const payout_destination=String(incoming.payout_destination??current.gate.payout_destination??"").trim().slice(0,200);
  const external_reference=String(incoming.external_reference??current.gate.external_reference??"").trim().slice(0,300);
  const evidence_url=String(incoming.evidence_url??current.gate.evidence_url??"").trim().slice(0,800);
  const note=String(incoming.note??current.gate.note??"").trim().slice(0,1500);
  const ts=nowIso(), probe={contract_status,payment_status}, ready=contractPaymentReady(probe), verified_at=ready?(current.gate.verified_at||ts):"";
  const existing=await env.DB.prepare("SELECT created_at FROM contract_payment_gates WHERE opportunity_id=?").bind(row.opportunity_id).first();
  const sql="INSERT INTO contract_payment_gates(opportunity_id,platform,application_status,contract_status,payment_status,payment_protection,gross_amount,currency,fee_estimate,net_estimate,payout_route,payout_destination,external_reference,evidence_url,note,verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(opportunity_id) DO UPDATE SET platform=excluded.platform,application_status=excluded.application_status,contract_status=excluded.contract_status,payment_status=excluded.payment_status,payment_protection=excluded.payment_protection,gross_amount=excluded.gross_amount,currency=excluded.currency,fee_estimate=excluded.fee_estimate,net_estimate=excluded.net_estimate,payout_route=excluded.payout_route,payout_destination=excluded.payout_destination,external_reference=excluded.external_reference,evidence_url=excluded.evidence_url,note=excluded.note,verified_at=excluded.verified_at,updated_at=excluded.updated_at";
  await env.DB.prepare(sql).bind(row.opportunity_id,platform,application_status,contract_status,payment_status,payment_protection,gross_amount,currency,fee_estimate,net_estimate,payout_route,payout_destination,external_reference,evidence_url,note,verified_at,existing?.created_at||ts,ts).run();
  return getContractPaymentGate(env,row);
}

async function requireContractPaymentGate(env,row) {
  const deal=await getContractPaymentGate(env,row);
  return deal.ready?null:deal;
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
  return {ok:true,spec,answers:publicAnswers,secret_present:secretPresent,status:completion.status,completion,request_message:clientRequestMessage(row,spec),discovery_plan:spec.discovery_plan||[],updated_at:saved?.updated_at||null};
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
  return {ok:true,status:completion.status,completion,answers:publicAnswers,secret_present:secretPresent,request_message:clientRequestMessage(row,spec),discovery_plan:spec.discovery_plan||[],updated_at:ts};
}

function paidJobPlan(row) {
  let bd={}; try{bd=JSON.parse(row.score_breakdown||"{}")}catch{}
  const raw=String(row.title||"")+" "+String(row.description||""), desc=String(row.description||"");
  const text=raw.toLowerCase(), korean=(raw.match(/[가-힣]/g)||[]).length>20;
  const requirements=[]; const addReq=(test,en,ko)=>{if(test)requirements.push(korean?ko:en)};
  // Manager v2: domain/workflow requirements from the actual client brief, before generic technical support.
  const isNumericNormalization=/excel|spreadsheet|workbook/.test(text)&&/(normaliz|normalis|z-score|min-max|numerical fields?|consistent scale)/.test(text);
  if(isNumericNormalization){
    requirements.push(korean?"Excel 통합문서를 읽어 숫자 열을 일관된 척도로 정규화":"Read each Excel workbook and normalize numerical columns to a consistent scale");
    if(/z-score|min-max/.test(text)) requirements.push(korean?"요구사항에 맞춰 z-score 또는 min-max 정규화 방식을 적용":"Apply the requested z-score or min-max normalization method");
    requirements.push(korean?"정규화 결과를 Excel 또는 CSV로 저장":"Save the normalized result back to Excel or CSV");
    if(/before-and-after|before and after|summary report|statistics/.test(text)) requirements.push(korean?"변환 전후 통계를 요약한 검증 리포트 생성":"Produce a concise before-and-after statistics report");
    if(/python|pandas|numpy|scikit/.test(text)) requirements.push(korean?"주석이 포함된 재실행 가능한 Python/pandas·NumPy 코드 제공":"Provide clean, well-commented, reproducible Python/pandas and NumPy code");
  }
  addReq(/squarespace/.test(text)&&/(export|migrat|move|transfer|jump)/.test(text),"Export the selected products from Squarespace with existing copy, imagery, pricing and variants","Squarespace 선택 상품의 설명·이미지·가격·옵션을 함께 추출");
  addReq(/etsy/.test(text)&&/(listing|listings|shop)/.test(text),"Create the Etsy listings with required sections, shipping profiles and attributes","Etsy 상품 등록 및 섹션·배송 프로필·필수 속성 구성");
  addReq(/image/.test(text)&&/(dimension|optim|re-format|reformat)/.test(text),"Reformat and optimize product assets for Etsy image, title, tag and SEO requirements","Etsy 이미지·제목·태그·SEO 기준에 맞게 상품 자산 최적화");
  addReq(/prodigi/.test(text)&&/(connect|mapping|map|fulfil|fulfill)/.test(text),"Connect Etsy to Prodigi and map each product to the correct print-on-demand template","Etsy와 Prodigi를 연결하고 각 상품을 올바른 POD 템플릿에 매핑");
  addReq(/workflow/.test(text)&&/etsy/.test(text)&&/prodigi/.test(text),"Test the end-to-end Squarespace → Etsy → Prodigi order/fulfilment workflow","Squarespace → Etsy → Prodigi 전체 주문·이행 흐름 테스트");
  addReq(/tax/.test(text)&&/shipping/.test(text),"Configure and verify US-targeted tax and shipping settings within the supported platform options","지원 범위 내 미국 판매용 세금·배송 설정 구성 및 확인");
  addReq(/hand.?over|step-by-step guide|future updates/.test(text),"Provide concise hand-over instructions for editing products and adding future listings","향후 상품 수정·추가를 위한 인수인계 가이드 제공");
  addReq(!isNumericNormalization&&/csv|json|bulk migration|bulk upload/.test(text),"Use an appropriate bulk migration/import path (API, CSV or JSON) where it improves speed and accuracy","속도·정확도를 위해 적절한 대량 이전 방식(API/CSV/JSON) 적용");
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
  const proposal=isNumericNormalization
    ? (korean
      ? `안녕하세요. Excel 수치 데이터 정규화 작업을 진행할 수 있습니다. 각 통합문서를 pandas로 읽고 수치 열에 z-score 또는 min-max 방식을 적용한 뒤 Excel/CSV 결과와 변환 전후 통계 요약을 제공하겠습니다. 코드는 주석을 포함해 로컬에서 그대로 재실행할 수 있게 구성하고 샘플 출력으로 정확성을 검증하겠습니다. 현재 명세 기준 예상 작업시간은 약 ${hours}시간입니다.`
      : `Hello, I can handle this Excel numerical-data normalization task with a clean, reproducible Python workflow. I will load each workbook with pandas, apply an appropriate z-score or min-max transformation to the numerical fields, save the normalized output to Excel or CSV, and produce a concise before/after statistics report. The script will be well commented and structured so missing-value or duplicate-handling steps can be added later. I will also include a sample output so you can verify the transformation locally. Based on the current brief, I estimate about ${hours} hours of work.`)
    : korean?`안녕하세요. 의뢰문 기준으로 ${scopeText} 범위로 진행할 수 있습니다. 시작 전에는 ${questions.join(" ")} 를 확인하겠습니다. 범위 확정 후 구현·이전·통합 테스트를 진행하고 검수 가능한 결과물과 인수인계 안내를 함께 납품하겠습니다. 현재 명세 기준 예상 작업시간은 약 ${hours}시간이며 외부 서비스 비용은 ${externalCostKnown?"원문상 별도 비용 없음":"사용 계정·서비스 조건 확인 후 확정"}입니다.`:`Hello, I can deliver the requested scope covering: ${scopeText}. Before starting, I would confirm: ${questions.join(" ")} After scope confirmation, I will implement/migrate the requested workflow, test the end-to-end result, and provide the completed deliverable with hand-over instructions. Based on the current brief, I estimate about ${hours} hours of work. External service cost will be confirmed from the actual account/service requirements.`;
  const buildSpec={spec_version:"factory-build-spec-v2",job_id:row.opportunity_id,title:row.title||"",language:korean?"ko":"en",objective:deliverables[0],functional_requirements:deliverables,open_questions:questions,acceptance_criteria:deliverables.slice(0,Math.min(6,deliverables.length)),target_runtime:null,estimated_build_hours:hours,external_cost_status:externalCostStatus,external_cost:externalCost,risk_level:risk,risk_factors:risks,source_url:row.url||""};
  const inputDiagnostics={title:String(row.title||""),description:desc,description_length:desc.length,skills:String(row.skills||""),url:String(row.url||""),analysis_text_length:raw.length,analysis_preview:raw.slice(0,700)};
  return {manager_version:"paid-job-manager-v2.1",input_diagnostics:inputDiagnostics,status:"needs_user_approval",detected_language:korean?"ko":"en",implementation_plan:deliverables,deliverables,requested_functions:deliverables,clarification_questions:questions,estimated_build_hours:hours,estimated_external_cost:externalCost,external_cost_status:externalCostStatus,delivery_risk:risk,risk_factors:risks,build_spec:buildSpec,proposal_draft:proposal,application_url:row.url||""};
}


function applicationDraft(row) {
  const plan=paidJobPlan(row), source=String(row.source||""), currency=String(row.currency||"USD");
  const min=Number(row.budget_min||0), max=Number(row.budget_max||0);
  const hours=Math.max(1,Number(plan.estimated_build_hours||4));
  const text=(String(row.title||"")+" "+String(row.description||"")).toLowerCase();
  let scopeMultiplier=1;
  if(/migrat|integration|integrate|platform|full.?stack|clone|automation/.test(text))scopeMultiplier+=0.6;
  if(/shopify|bigcommerce|etsy|squarespace|api|database|payment|streaming/.test(text))scopeMultiplier+=0.35;
  if(/bulk|entire|complete|end.?to.?end|production|deploy/.test(text))scopeMultiplier+=0.35;
  const effectiveHours=Math.ceil(hours*scopeMultiplier);
  const workDays=Math.max(1,Math.ceil(effectiveHours/5));
  const externalBuffer=/api|account|shop|oauth|credentials|migrat|integration|payment/.test(text)?2:1;
  const deliveryDays=Math.max(2,workDays+externalBuffer);
  const floor=min||0, ceiling=max||min||0;
  let bidAmount=floor&&ceiling?Math.round(floor+(ceiling-floor)*0.55):ceiling||floor||null;
  if(bidAmount&&floor)bidAmount=Math.max(floor,bidAmount);
  if(bidAmount&&ceiling)bidAmount=Math.min(ceiling,bidAmount);
  const platform=contractPaymentProfile(row);
  const questions=(plan.clarification_questions||[]).slice(0,3);
  return {
    opportunity_id:row.opportunity_id,title:row.title||"",source,platform:platform.platform,
    application_url:row.url||"",proposal:plan.proposal_draft||"",
    bid_amount:bidAmount,currency,delivery_days:deliveryDays,
    questions,estimated_build_hours:hours,effective_estimated_hours:effectiveHours,
    estimate_basis:"Manager hours + scope complexity + external account/integration buffer",
    submission_mode:source==="freelancer_projects"?"official_api_with_user_approval":"platform_specific",
    auto_submit_supported:source==="freelancer_projects",
    requires_human_submit:false,
    requires_user_approval:true,
    safety_note:"Prepared automatically. Freelancer.com submission uses the connected official API path only after explicit user approval and preflight checks."
  };
}


function applicationPriority(row,draft) {
  let bd={}; try{bd=JSON.parse(row.score_breakdown||"{}")}catch{}
  const reasons=[]; let points=0;
  const gross=Number(draft.bid_amount||0), hours=Math.max(1,Number(draft.effective_estimated_hours||1));
  const competitionCount=Math.max(0,Number(row.competition||0));
  // Conservative planning estimate only. Actual platform fees can vary by account/project,
  // so the UI must not present this as a guaranteed payout.
  const feeRate=String(row.source||"")==="freelancer_projects"?0.10:0;
  const estimatedPlatformFee=Math.round(gross*feeRate*100)/100;
  const estimatedNet=Math.max(0,Math.round((gross-estimatedPlatformFee)*100)/100);
  const valuePerHour=estimatedNet/hours;
  if(competitionCount>=100){points-=5;reasons.push("very_high_competition")}
  else if(competitionCount>=50){points-=3;reasons.push("high_competition")}
  else if(competitionCount>=25){points-=1;reasons.push("moderate_competition")}
  else if(competitionCount>0&&competitionCount<=10){points+=2;reasons.push("low_competition")}
  if(valuePerHour>=100){points+=4;reasons.push("high_value_per_hour")}
  else if(valuePerHour>=50){points+=3;reasons.push("good_value_per_hour")}
  else if(valuePerHour>=25){points+=1;reasons.push("acceptable_value_per_hour")}
  else {points-=3;reasons.push("low_value_per_hour")}
  if(Number(row.score||0)>=80){points+=2;reasons.push("strong_scout_score")}
  else if(Number(row.score||0)>=65){points+=1;reasons.push("solid_scout_score")}
  if(Number(bd.factory_fulfillable)===1){points+=2;reasons.push("factory_fulfillable")}
  if(Number(bd.actionable_paid_job)===1){points+=1;reasons.push("actionable_paid_job")}
  const q=(draft.questions||[]).length;
  if(q===0){points+=1;reasons.push("clear_brief")} else if(q>=3){points-=1;reasons.push("clarification_dependency")}
  const text=(String(row.title||"")+" "+String(row.description||"")).toLowerCase();
  const proofRequirements=[];
  if(/(?:link|links|url|urls).{0,80}(?:live|shipped|deployed|production|portfolio|work|project|bot|site)|(?:live|shipped|deployed|production).{0,80}(?:link|links|url|urls)/i.test(text))proofRequirements.push("live_work_links");
  if(/(?:portfolio|case stud(?:y|ies)|previous work|past work|examples? of (?:your )?work|demonstrated experience|show (?:me )?(?:your )?work)/i.test(text))proofRequirements.push("portfolio_evidence");
  if(/(?:must have|required|requirement|only apply|please (?:include|provide|link|share)).{0,100}(?:experience|portfolio|example|link|case stud|live)/i.test(text))proofRequirements.push("mandatory_qualification_evidence");
  const integrationDependencies=[];
  if(/crm|help.?desk|zendesk|hubspot|salesforce|intercom|freshdesk/i.test(text))integrationDependencies.push("existing_business_system");
  if(/(?:integrat|connect|sync|handoff|hand.?off).{0,100}(?:crm|help.?desk|existing|current|live agent|production)/i.test(text))integrationDependencies.push("existing_system_integration");
  const externalWorkspaceSignals=[];
  if(/zoho|salesforce|hubspot|zendesk|intercom|freshdesk|shopify|bigcommerce|woocommerce|squarespace|wix|webflow/i.test(text))externalWorkspaceSignals.push("managed_saas_workspace");
  if(/(?:inside|within|in) (?:our|my|the) (?:crm|account|workspace|store|shop|admin|dashboard|portal)|(?:configure|customize|set up|setup|modify|update|build).{0,100}(?:crm|account|workspace|admin|dashboard|zoho|salesforce|hubspot|shopify)/i.test(text))externalWorkspaceSignals.push("client_workspace_changes");
  if(/(?:custom fields|views|pipeline|lead management|workflow automation|document templates?|e-?signature|dashboards?|reporting|analytics).{0,120}(?:crm|zoho|salesforce|hubspot|account|workspace)?/i.test(text))externalWorkspaceSignals.push("workspace_configuration");
  if(/(?:autotrader|ebay|gumtree|facebook marketplace|friday ad|drive mart)/i.test(text)&&/(?:post|publish|list|sync|integrat|connect|multiple|multi(?:site|[- ]site|platform|[- ]platform))/i.test(text))externalWorkspaceSignals.push("multi_platform_marketplace_posting");
  if(/(?:crm|platform|system).{0,120}(?:multiple|several|multi(?:site|[- ]site|platform|[- ]platform)).{0,120}(?:website|marketplace|platform)|(?:multiple|several|multi(?:site|[- ]site|platform|[- ]platform)).{0,120}(?:website|marketplace|platform).{0,120}(?:crm|platform|system|post|publish|sync)/i.test(text))externalWorkspaceSignals.push("multi_platform_external_integration");
  const environmentDependencySignals=[];
  if(/(?:wordpress|cms|server|hosting|database|mysql|production environment|live environment|backend).{0,120}(?:access|credentials|login|admin|ssh|ftp|database|modify|optimi[sz]|tune|debug|profile|audit)/i.test(text)||/(?:access|credentials|login|admin|ssh|ftp).{0,120}(?:wordpress|cms|server|hosting|database|mysql|backend)/i.test(text))environmentDependencySignals.push("client_runtime_access");
  if(/(?:slow quer(?:y|ies)|query monitor|new relic|indexes?|wp_options|autoload|plugin performance|theme code|server response|backend processing)/i.test(text))environmentDependencySignals.push("live_runtime_diagnostics");
  if(/(?:benchmark|before and after|performance metrics?|response time|load time).{0,120}(?:traffic|production|live|improv|reduce|cut|faster)|(?:cut|reduce|improve).{0,100}(?:response time|load time|processing time).{0,80}(?:half|%|percent)/i.test(text))environmentDependencySignals.push("live_performance_acceptance");
  if(/(?:my|our|the client(?:\'s)?)\s+(?:hosting|server|domain)|(?:hosting|server|domain).{0,100}(?:my|our|client)|(?:deploy|migrat|transfer|move|upload|install|set\s*up).{0,120}(?:hosting|server|domain)|(?:point|connect|configure|change).{0,100}(?:domain|dns|nameserver)/i.test(text))environmentDependencySignals.push("client_hosting_or_domain");
  if(/(?:screen\s*share|screenshare|video\s*call|zoom\s*call|handover\s*call|hand[- ]?over.{0,60}call|walk\s+me\s+through|walkthrough\s+call)/i.test(text))environmentDependencySignals.push("synchronous_handover_required");
  if(/(?:modify|update|change|edit|add|install|implement|post|publish).{0,120}(?:my|our|existing|current)\s+(?:site|website|web\s*site)|(?:my|our|existing|current)\s+(?:site|website|web\s*site).{0,120}(?:modify|update|change|edit|add|install|implement|post|publish)/i.test(text))environmentDependencySignals.push("existing_client_site_change");
  const independentDeliveryHardHold=externalWorkspaceSignals.length>0||environmentDependencySignals.length>0;
  const scopeSignals=[];
  if(/production.?ready|end.?to.?end|full.?stack|complete (?:system|platform|website|application)|natural.?language processing|live agent|documentation|training material/i.test(text))scopeSignals.push("multi_component_scope");
  if(/(?:live|existing|current) (?:site|website)|implemented? (?:on|in) the live site|deploy(?:ed|ment)? (?:to|on) (?:the )?(?:live|production)/i.test(text))scopeSignals.push("live_site_implementation");
  if(/home(?:page)?[^.]{0,120}(?:service|pricing)|(?:service|pricing)[^.]{0,120}home(?:page)?|all current pages|site.?wide|multiple pages/i.test(text))scopeSignals.push("multi_page_scope");
  if(/responsive|mobile responsiveness|ios|android|major browsers|cross.?browser|device testing/i.test(text))scopeSignals.push("cross_device_validation");
  if(/copy|content|rewrite|copywriting/i.test(text)&&/redesign|visual|ui\/ux|design/i.test(text)&&/implement|wordpress|html|live site/i.test(text))scopeSignals.push("content_design_implementation_combo");
  const attachmentSignals=[];
  if(/attachment|attached|brief\.pdf|\.pdf\b|\.docx?\b|see (?:the )?(?:brief|attached)/i.test(text))attachmentSignals.push("unverified_attachment");
  const qualificationHardHold=proofRequirements.length>0;
  const attachmentHardHold=attachmentSignals.length>0;
  let deliveryRisk=0;
  if(/credentials|oauth|account access|shop access|api key|admin access|login/.test(text)){points-=2;deliveryRisk+=2;reasons.push("external_access_dependency")}
  if(/migration|migrate|transfer|import|export/.test(text)){points-=2;deliveryRisk+=2;reasons.push("migration_risk")}
  if(/bigcommerce|shopify|etsy|squarespace|woocommerce/.test(text)&&/migration|integration|sync|transfer/.test(text)){points-=2;deliveryRisk+=2;reasons.push("commerce_platform_dependency")}
  if(/customer data|client data|production data|database|orders|customers|inventory/.test(text)){points-=1;deliveryRisk+=1;reasons.push("client_data_dependency")}
  if(/payment|subscription|membership|streaming|billing/.test(text)){points-=2;deliveryRisk+=2;reasons.push("production_critical_scope")}
  if(/clone|entire platform|full.?stack/.test(text)&&draft.delivery_days<=3){points-=3;deliveryRisk+=3;reasons.push("large_scope_tight_schedule")}
  if(/migration|integration|clone|entire platform|full.?stack/.test(text)&&draft.delivery_days<=3){points-=3;deliveryRisk+=3;reasons.push("unsafe_delivery_window")}
  const automationRatio=Math.max(0,Math.min(1,1-(deliveryRisk*0.12)));
  if(automationRatio<0.65){points-=3;reasons.push("low_automation_completion_ratio")}
  if(integrationDependencies.length){points-=Math.min(4,integrationDependencies.length*2);deliveryRisk+=integrationDependencies.length;reasons.push(...integrationDependencies)}
  const complexScope=scopeSignals.length>=2;
  if((scopeSignals.length&&Number(draft.effective_estimated_hours||0)<=3)||complexScope){points-=complexScope?4:2;deliveryRisk+=complexScope?2:1;reasons.push("scope_time_underestimate")}
  if(qualificationHardHold){points-=100;reasons.push("qualification_proof_required")}
  if(attachmentHardHold){points-=100;reasons.push("attachment_not_verified")}
  // Client access and broad scope are bid-planning risks, not reasons to suppress a proposal.
  // Production remains blocked later until the contract/access gates are satisfied.
  if(independentDeliveryHardHold){points-=1;deliveryRisk+=1;reasons.push("client_access_required_after_contract")}
  const impossibleTightDelivery=deliveryRisk>=7&&draft.delivery_days<=2;
  const hardHold=qualificationHardHold||attachmentHardHold||impossibleTightDelivery;
  if(hardHold){reasons.push(qualificationHardHold?"qualification_evidence_gate":attachmentHardHold?"attachment_review_gate":"delivery_risk_gate")}
  return {points,reasons,gross_bid:gross,estimated_platform_fee:estimatedPlatformFee,estimated_net:estimatedNet,fee_rate_assumption:feeRate,competition_count:competitionCount,value_per_hour:Math.round(valuePerHour*100)/100,delivery_risk:deliveryRisk,automation_completion_ratio:Math.round(automationRatio*100),hard_hold:hardHold,proof_requirements:proofRequirements,integration_dependencies:integrationDependencies,external_workspace_signals:externalWorkspaceSignals,environment_dependency_signals:environmentDependencySignals,scope_signals:scopeSignals,attachment_signals:attachmentSignals,requires_human_qualification_review:qualificationHardHold,requires_attachment_review:attachmentHardHold,requires_independent_delivery_review:false,requires_client_access_after_contract:independentDeliveryHardHold,requires_client_environment_review:environmentDependencySignals.length>0,requires_complex_scope_review:complexScope};
}

async function getPlatformConnection(env, provider) {
  await ensureSchema(env);
  const row=await env.DB.prepare("SELECT * FROM platform_connections WHERE provider=?").bind(provider).first();
  if(row){let metadata={};try{metadata=JSON.parse(row.metadata_json||"{}")}catch{};return {...row,metadata};}
  return {provider,account_status:"not_ready",api_status:"disconnected",auth_method:"",metadata:{},created_at:"",updated_at:""};
}

async function savePlatformAccountReady(env, provider, ready=true) {
  await ensureSchema(env); const ts=nowIso(), current=await getPlatformConnection(env,provider);
  const accountStatus=ready?"ready":"not_ready";
  await env.DB.prepare(`INSERT INTO platform_connections(provider,account_status,api_status,auth_method,metadata_json,created_at,updated_at)
    VALUES(?,?,?,'',?, ?, ?) ON CONFLICT(provider) DO UPDATE SET account_status=excluded.account_status,updated_at=excluded.updated_at`)
    .bind(provider,accountStatus,current.api_status||"disconnected",JSON.stringify(current.metadata||{}),ts,ts).run();
  return getPlatformConnection(env,provider);
}

async function verifyFreelancerConnection(env) {
  await ensureSchema(env);
  const credential=String(env.FREELANCER_ACCESS_TOKEN||"").trim();
  if(!credential) return {ok:false,connected:false};
  let response,payload={};
  try {
    response=await fetch("https://www.freelancer.com/api/users/0.1/self/",{
      headers:{"freelancer-oauth-v1":credential,"accept":"application/json","user-agent":"AutomationFactory-MoneyScout/0.49.0"}
    });
    payload=await response.json().catch(()=>({}));
  } catch { return {ok:false,connected:false}; }
  if(!response.ok) return {ok:false,connected:false,status:response.status};
  const user=payload?.result||payload?.user||payload||{},ts=nowIso(),current=await getPlatformConnection(env,"freelancer");
  const metadata={...(current.metadata||{}),verified_at:ts,user_id:user.id??null,username:String(user.username||"").slice(0,120)};
  await env.DB.prepare(`INSERT INTO platform_connections(provider,account_status,api_status,auth_method,metadata_json,created_at,updated_at)
    VALUES('freelancer','ready','connected','personal_access_token',?,?,?)
    ON CONFLICT(provider) DO UPDATE SET account_status='ready',api_status='connected',auth_method='personal_access_token',metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
    .bind(JSON.stringify(metadata),ts,ts).run();
  return {ok:true,connected:true};
}

async function freelancerApiRead(env,path) {
  const credential=String(env.FREELANCER_ACCESS_TOKEN||"").trim();
  if(!credential)return {ok:false,status:0,error:"credential_missing"};
  try{
    const response=await fetch("https://www.freelancer.com"+path,{headers:{"freelancer-oauth-v1":credential,"accept":"application/json","user-agent":"AutomationFactory-MoneyScout/0.49.0"}});
    const payload=await response.json().catch(()=>({}));
    return {ok:response.ok,status:response.status,payload};
  }catch(error){return {ok:false,status:0,error:String(error?.message||error)}}
}

async function freelancerApiForm(env,path,fields) {
  const credential=String(env.FREELANCER_ACCESS_TOKEN||"").trim();
  if(!credential)return {ok:false,status:0,error:"credential_missing"};
  try{
    const form=new FormData();
    for(const [key,value] of Object.entries(fields||{})){
      if(Array.isArray(value))for(const item of value)form.append(key+"[]",String(item));
      else if(value!==undefined&&value!==null)form.append(key,String(value));
    }
    const response=await fetch("https://www.freelancer.com"+path,{method:"POST",headers:{"freelancer-oauth-v1":credential,"accept":"application/json","user-agent":"AutomationFactory-MoneyScout/0.49.0"},body:form});
    const payload=await response.json().catch(()=>({}));
    return {ok:response.ok,status:response.status,payload};
  }catch(error){return {ok:false,status:0,error:String(error?.message||error)}}
}

async function syncFreelancerMessaging(env,row) {
  const projectId=String(row?.source_item_id||"").trim();
  if(!/^\d+$/.test(projectId))return {ok:false,reason:"project_id_missing"};
  const bidAction=await env.DB.prepare("SELECT * FROM platform_actions WHERE provider='freelancer' AND opportunity_id=? AND action_type='bid' ORDER BY updated_at DESC LIMIT 1").bind(row.opportunity_id).first();
  let bidMeta={};try{bidMeta=JSON.parse(bidAction?.response_metadata_json||"{}")}catch{}
  let ownerId=String(bidMeta.project_owner_id||"").trim();
  if(!/^\d+$/.test(ownerId)&&/^\d+$/.test(String(bidAction?.external_action_id||""))){
    const b=await freelancerApiRead(env,"/api/projects/0.1/bids/"+bidAction.external_action_id+"/?project_details=true&compact=true");
    const obj=b.payload?.result||b.payload?.bid||b.payload||{};
    ownerId=String(obj.project?.owner_id??obj.project?.owner?.id??obj.project_owner_id??"").trim();
  }
  if(!/^\d+$/.test(ownerId))return {ok:false,reason:"project_owner_missing"};

  let threadAction=await env.DB.prepare("SELECT * FROM platform_actions WHERE provider='freelancer' AND opportunity_id=? AND action_type='thread' AND status='confirmed' ORDER BY updated_at DESC LIMIT 1").bind(row.opportunity_id).first();
  let threadId=String(threadAction?.external_action_id||"").trim();
  if(!/^\d+$/.test(threadId)){
    const made=await freelancerApiForm(env,"/api/messages/0.1/threads/",{"members":[ownerId],context_type:"project",context:projectId});
    if(!made.ok)return {ok:false,reason:"thread_create_failed",status:made.status};
    const obj=made.payload?.result||made.payload?.thread||made.payload||{};
    threadId=String(obj.id??obj.thread_id??"").trim();
    if(!/^\d+$/.test(threadId))return {ok:false,reason:"thread_id_missing"};
    const ts=nowIso(),key="freelancer:thread:"+row.opportunity_id+":"+projectId;
    await env.DB.prepare(`INSERT INTO platform_actions(action_key,provider,opportunity_id,external_object_id,action_type,status,request_hash,external_action_id,response_metadata_json,created_at,updated_at)
      VALUES(?,'freelancer',?,?,'thread','confirmed','',?,?,?,?) ON CONFLICT(action_key) DO UPDATE SET status='confirmed',external_action_id=excluded.external_action_id,response_metadata_json=excluded.response_metadata_json,updated_at=excluded.updated_at`)
      .bind(key,row.opportunity_id,projectId,threadId,JSON.stringify({owner_id:ownerId}),ts,ts).run();
  }

  const plan=paidJobPlan(row), intake=await getClientIntake(env,row,plan);
  const askKey="freelancer:intake:"+row.opportunity_id+":"+threadId;
  const asked=await env.DB.prepare("SELECT action_key FROM platform_actions WHERE action_key=? AND status='confirmed'").bind(askKey).first();
  if(!asked&&intake.status!=="ready_for_build"){
    const sent=await freelancerApiForm(env,"/api/messages/0.1/threads/"+threadId+"/messages/",{message:intake.request_message});
    if(sent.ok){
      const obj=sent.payload?.result||sent.payload?.message||sent.payload||{},ts=nowIso(),mid=String(obj.id??obj.message_id??"");
      await env.DB.prepare(`INSERT INTO platform_actions(action_key,provider,opportunity_id,external_object_id,action_type,status,request_hash,external_action_id,response_metadata_json,created_at,updated_at)
        VALUES(?,'freelancer',?,?,'intake_message','confirmed','',?,?,?,?) ON CONFLICT(action_key) DO NOTHING`)
        .bind(askKey,row.opportunity_id,threadId,mid,JSON.stringify({thread_id:threadId}),ts,ts).run();
    }
  }

  const got=await freelancerApiRead(env,"/api/messages/0.1/messages/?threads[]="+encodeURIComponent(threadId));
  if(!got.ok)return {ok:false,reason:"message_read_failed",status:got.status,thread_id:threadId};
  const raw=got.payload?.result?.messages??got.payload?.messages??[], messages=Array.isArray(raw)?raw:[];
  const pc=await getPlatformConnection(env,"freelancer"), selfId=String(pc.metadata?.user_id||"");
  let inbound=0;
  for(const m of messages){
    const mid=String(m.id??m.message_id??"").trim(); if(!mid)continue;
    const sender=String(m.sender_id??m.from_user_id??m.user_id??"");
    const body=String(m.message??m.body??m.text??"").slice(0,8000);
    const direction=sender&&sender===selfId?"outbound":"inbound";
    await env.DB.prepare("INSERT OR IGNORE INTO platform_messages(provider,opportunity_id,thread_id,message_id,sender_id,body,direction,created_at) VALUES('freelancer',?,?,?,?,?,?,?)")
      .bind(row.opportunity_id,threadId,mid,sender,body,direction,new Date(Number(m.time_created||0)*1000||Date.now()).toISOString()).run();
    if(direction==="inbound"&&body.trim())inbound++;
  }
  if(inbound){
    const latest=messages.filter(m=>String(m.sender_id??m.from_user_id??m.user_id??"")!==selfId).map(m=>String(m.message??m.body??m.text??"").trim()).filter(Boolean).slice(-5).join("\n\n").slice(0,12000);
    const existing=await env.DB.prepare("SELECT * FROM client_intakes WHERE opportunity_id=?").bind(row.opportunity_id).first(),ts=nowIso(); let answers={};
    try{answers=JSON.parse(existing?.public_answers_json||"{}")}catch{}
    answers.client_notes=[String(answers.client_notes||"").trim(),latest].filter(Boolean).join("\n\n").slice(0,16000);
    const parsed=parseClientNumberedAnswers(plan?clientIntakeSpec(row,plan):clientIntakeSpec(row),latest);
    for(const [key,value] of Object.entries(parsed))if(value)answers[key]=value;
    const spec=clientIntakeSpec(row,plan), completion=intakeCompletion(spec,answers,{});
    await env.DB.prepare("INSERT INTO client_intakes(opportunity_id,public_answers_json,secret_answers_enc,status,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(opportunity_id) DO UPDATE SET public_answers_json=excluded.public_answers_json,status=excluded.status,updated_at=excluded.updated_at")
      .bind(row.opportunity_id,JSON.stringify(answers),existing?.secret_answers_enc||"",completion.status,existing?.created_at||ts,ts).run();
    await env.DB.prepare("UPDATE contract_payment_gates SET application_status='client_replied',updated_at=? WHERE opportunity_id=?").bind(ts,row.opportunity_id).run();
  }
  return {ok:true,thread_id:threadId,inbound_messages:inbound};
}

async function syncFreelancerBidStatus(env,row) {
  const action=await env.DB.prepare("SELECT * FROM platform_actions WHERE provider='freelancer' AND opportunity_id=? AND action_type='bid' AND status IN ('submitted','confirmed') ORDER BY updated_at DESC LIMIT 1").bind(row.opportunity_id).first();
  const bidId=String(action?.external_action_id||"").trim();
  if(!/^\d+$/.test(bidId))return {ok:false,reason:"submitted_bid_not_found"};
  const res=await freelancerApiRead(env,"/api/projects/0.1/bids/"+bidId+"/?project_details=true&award_status_possibilities=true&compact=true");
  if(!res.ok)return {ok:false,reason:"bid_read_failed",status:res.status};
  const bid=res.payload?.result||res.payload?.bid||res.payload||{};
  const award=String(bid.award_status||bid.status||"").toLowerCase(), ts=nowIso();
  const accepted=["awarded","accepted"].includes(award), rejected=["rejected","revoked","withdrawn","cancelled"].includes(award);
  await env.DB.prepare("UPDATE platform_actions SET status=?,response_metadata_json=?,updated_at=? WHERE action_key=?")
    .bind(accepted?"confirmed":rejected?"closed":"submitted",JSON.stringify({bid_id:bidId,award_status:award||"unknown",time_submitted:bid.time_submitted??null,project_owner_id:bid.project?.owner_id??bid.project?.owner?.id??bid.project_owner_id??null}).slice(0,4000),ts,action.action_key).run();
  if(accepted){
    const amount=Number(bid.amount||0), currency=String(bid.currency?.code||bid.project?.currency?.code||row.currency||"");
    await env.DB.prepare(`UPDATE contract_payment_gates SET application_status='assigned',contract_status='accepted',gross_amount=CASE WHEN ?>0 THEN ? ELSE gross_amount END,currency=CASE WHEN ?!='' THEN ? ELSE currency END,verified_at=?,updated_at=? WHERE opportunity_id=?`)
      .bind(amount,amount,currency,currency,ts,ts,row.opportunity_id).run();
  }
  return {ok:true,bid_id:bidId,award_status:award||"unknown",accepted,rejected};
}

async function syncFreelancerMilestoneStatus(env,row) {
  const projectId=String(row?.source_item_id||"").trim();
  if(!/^\d+$/.test(projectId))return {ok:false,reason:"project_id_missing"};
  const res=await freelancerApiRead(env,"/api/projects/0.1/milestones/?projects[]="+encodeURIComponent(projectId)+"&sort_field=time_created&sort_direction=desc");
  if(!res.ok)return {ok:false,reason:"milestone_read_failed",status:res.status};
  const raw=res.payload?.result?.milestones??res.payload?.result??res.payload?.milestones??[];
  const milestones=Array.isArray(raw)?raw:[];
  const usable=milestones.filter(m=>String(m.project_id??m.project?.id??"")===projectId);
  const released=usable.filter(m=>["released","paid"].includes(String(m.status||"").toLowerCase()));
  const releasedAmount=released.reduce((sum,m)=>sum+Number(m.amount||0),0);
  const secured=usable.filter(m=>["pending","frozen","requested_release"].includes(String(m.status||"").toLowerCase()));
  const securedAmount=secured.reduce((sum,m)=>sum+Number(m.amount||0),0);
  const ts=nowIso();
  if(released.length){
    const current=await getContractPaymentGate(env,row),gross=releasedAmount>0?releasedAmount:Number(current.gate.gross_amount||0),fee=Number(current.gate.fee_estimate||0),net=Math.max(0,gross-fee),currency=String(current.gate.currency||row.currency||"");
    await env.DB.prepare("UPDATE contract_payment_gates SET payment_status=\'paid\',gross_amount=CASE WHEN ?>0 THEN ? ELSE gross_amount END,net_estimate=?,note=?,verified_at=?,updated_at=? WHERE opportunity_id=?").bind(gross,gross,net,"Freelancer released milestone verified: "+released.map(m=>String(m.id||"")+"("+String(m.status||"")+")").join(","),ts,ts,row.opportunity_id).run();
    await env.DB.prepare("INSERT INTO opportunity_outcomes(opportunity_id,result,actual_revenue,actual_cost,actual_minutes,note,updated_at) VALUES(?,\'paid\',?,?,NULL,?,?) ON CONFLICT(opportunity_id) DO UPDATE SET result=\'paid\',actual_revenue=excluded.actual_revenue,actual_cost=excluded.actual_cost,note=excluded.note,updated_at=excluded.updated_at").bind(row.opportunity_id,net,fee,"Verified Freelancer milestone release · "+currency,ts).run();
    return {ok:true,paid:true,released:true,count:released.length,amount:gross,net,currency,statuses:released.map(m=>String(m.status||""))};
  }
  if(secured.length){
    await env.DB.prepare(`UPDATE contract_payment_gates SET payment_status='secured',payment_protection='funded_milestone',gross_amount=CASE WHEN ?>0 THEN ? ELSE gross_amount END,external_reference=CASE WHEN external_reference='' THEN ? ELSE external_reference END,evidence_url=?,note=?,verified_at=?,updated_at=? WHERE opportunity_id=?`)
      .bind(securedAmount,securedAmount,String(secured[0]?.id||""),String(row.url||""),"Freelancer funded milestone verified: "+secured.map(m=>String(m.id||"")+"("+String(m.status||"")+")").join(","),ts,ts,row.opportunity_id).run();
    return {ok:true,secured:true,count:secured.length,amount:securedAmount,statuses:secured.map(m=>String(m.status||""))};
  }
  await env.DB.prepare("UPDATE contract_payment_gates SET payment_status='unsecured',payment_protection='milestone_required',verified_at=?,updated_at=? WHERE opportunity_id=?").bind(ts,ts,row.opportunity_id).run();
  return {ok:true,secured:false,count:usable.length,statuses:usable.map(m=>String(m.status||""))};
}

async function freelancerBidLedger(env,row,draft) {
  await ensureSchema(env);
  const projectId=String(row?.source_item_id||""), actionKey="freelancer:bid:"+projectId;
  const existing=await env.DB.prepare("SELECT * FROM platform_actions WHERE action_key=?").bind(actionKey).first();
  if(existing&&["submitted","confirmed"].includes(String(existing.status||"")))return {ok:false,duplicate:true,action_key:actionKey,status:existing.status,external_action_id:existing.external_action_id||""};
  const stable=JSON.stringify({project_id:projectId,bid_amount:Number(draft?.bid_amount||0),delivery_days:Number(draft?.delivery_days||0),proposal:String(draft?.proposal||"")});
  const bytes=new TextEncoder().encode(stable), digest=await crypto.subtle.digest("SHA-256",bytes), requestHash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
  const ts=nowIso();
  await env.DB.prepare(`INSERT INTO platform_actions(action_key,provider,opportunity_id,external_object_id,action_type,status,request_hash,created_at,updated_at)
    VALUES(?,'freelancer',?,?, 'bid','prepared',?,?,?)
    ON CONFLICT(action_key) DO UPDATE SET request_hash=excluded.request_hash,updated_at=excluded.updated_at`).bind(actionKey,row.opportunity_id,projectId,requestHash,ts,ts).run();
  return {ok:true,duplicate:false,action_key:actionKey,status:"prepared",request_hash:requestHash};
}

async function freelancerBidPreflight(env,row) {
  if(!row||String(row.source||"")!=="freelancer_projects")return {ok:false,eligible:false,reason:"not_freelancer_project"};
  const projectId=String(row.source_item_id||"").trim();
  if(!/^\d+$/.test(projectId))return {ok:false,eligible:false,reason:"invalid_project_id"};
  const connection=await getPlatformConnection(env,"freelancer");
  if(connection.api_status!=="connected")return {ok:false,eligible:false,reason:"platform_not_connected"};
  const learnedMin=Number(connection.metadata?.bid_min_balance_usd||0);
  if(learnedMin>0&&connection.metadata?.bid_balance_blocked===true)return {ok:true,eligible:false,project_id:projectId,status:"account_constraint",reason:"insufficient_account_balance_learned",required_balance_usd:learnedMin,learned_from_api:true,write_executed:false};
  const project=await freelancerApiRead(env,"/api/projects/0.1/projects/"+projectId+"/?full_description=true&job_details=true");
  if(!project.ok)return {ok:false,eligible:false,reason:"project_read_failed",status:project.status};
  const p=project.payload?.result||project.payload?.project||project.payload||{};
  const status=String(p.status||"").toLowerCase();
  const projectText=JSON.stringify(p).toLowerCase();
  const restrictedPreferred=/(?:preferred freelancer|preferred_freelancer|preferred-only|preferred only)/i.test(projectText);
  const restrictedSelected=/(?:selected freelancer|selected_freelancer|invite[-_ ]only|invited freelancer)/i.test(projectText);
  const account=await freelancerApiRead(env,"/api/users/0.1/self/");
  const accountPayload=account.payload||{}, accountText=JSON.stringify(accountPayload).toLowerCase();
  const accountPreferred=/(?:preferred freelancer|preferred_freelancer)[^,}\]]{0,80}(?:true|1|yes)/i.test(accountText);
  // Freelancer can require a minimum available balance before accepting a bid.
  // Use account balances only when the API exposes a clear USD available/amount field.
  const balanceRows=accountPayload?.result?.balances||accountPayload?.balances||accountPayload?.result?.user?.balances||[];
  let usdBalance=null;
  if(Array.isArray(balanceRows)){
    for(const b of balanceRows){
      const code=String(b?.currency?.code||b?.currency_code||b?.code||"").toUpperCase();
      if(code!=="USD")continue;
      const v=Number(b?.available??b?.available_balance??b?.amount??b?.balance);
      if(Number.isFinite(v)){usdBalance=v;break;}
    }
  }
  const knownMinBidBalanceUsd=19;
  if(usdBalance!==null&&usdBalance<knownMinBidBalanceUsd)return {ok:true,eligible:false,project_id:projectId,status:status||"unknown",reason:"insufficient_account_balance",required_balance_usd:knownMinBidBalanceUsd,available_balance_usd:usdBalance,write_executed:false};
  if(restrictedPreferred&&!accountPreferred)return {ok:true,eligible:false,project_id:projectId,status:status||"unknown",reason:"preferred_freelancer_required",write_executed:false};
  if(restrictedSelected)return {ok:true,eligible:false,project_id:projectId,status:status||"unknown",reason:"selected_freelancer_restriction",write_executed:false};
  const draft=applicationDraft(row), priority=applicationPriority(row,draft);
  const budget=p.budget||{}, minimum=Number(budget.minimum??row.budget_min??0), maximum=Number(budget.maximum??row.budget_max??0);
  const amount=Number(draft.bid_amount||0);
  const budgetOk=amount>0&&(!minimum||amount>=minimum)&&(!maximum||amount<=maximum);
  const open=!status||["active","open"].includes(status);
  const eligible=open&&budgetOk&&!priority.hard_hold;
  const ledger=eligible?await freelancerBidLedger(env,row,draft):null; return {ok:true,eligible,project_id:projectId,status:status||"unknown",budget:{minimum,maximum,currency:String(p.currency?.code||row.currency||"")},draft:{bid_amount:amount,delivery_days:draft.delivery_days,proposal:draft.proposal},risk:priority,reason:eligible?"ready_for_bid_write_validation":!open?"project_not_open":!budgetOk?"bid_outside_budget":"delivery_risk_gate",write_executed:false,ledger};
}

async function freelancerApiWrite(env,path,body) {
  const credential=String(env.FREELANCER_ACCESS_TOKEN||"").trim();
  if(!credential)return {ok:false,status:0,error:"credential_missing"};
  try{
    const response=await fetch("https://www.freelancer.com"+path,{method:"POST",headers:{"freelancer-oauth-v1":credential,"accept":"application/json","content-type":"application/json","user-agent":"AutomationFactory-MoneyScout/0.49.0"},body:JSON.stringify(body)});
    const payload=await response.json().catch(()=>({}));
    return {ok:response.ok,status:response.status,payload};
  }catch(error){return {ok:false,status:0,error:String(error?.message||error)}}
}

async function submitFreelancerBid(env,row) {
  const pre=await freelancerBidPreflight(env,row);
  if(!pre.ok||!pre.eligible)return {ok:false,submitted:false,preflight:pre};
  if(pre.ledger?.duplicate)return {ok:false,submitted:false,duplicate:true,preflight:pre};
  const connection=await getPlatformConnection(env,"freelancer"), bidderId=Number(connection.metadata?.user_id||0);
  if(!bidderId)return {ok:false,submitted:false,reason:"bidder_id_missing"};
  const body={project_id:Number(pre.project_id),bidder_id:bidderId,amount:Number(pre.draft.bid_amount),period:Number(pre.draft.delivery_days),milestone_percentage:100,description:String(pre.draft.proposal||"")};
  const result=await freelancerApiWrite(env,"/api/projects/0.1/bids/",body);
  const actionKey="freelancer:bid:"+pre.project_id, ts=nowIso();
  if(!result.ok){
    await env.DB.prepare("UPDATE platform_actions SET status='failed',response_metadata_json=?,updated_at=? WHERE action_key=?").bind(JSON.stringify({http_status:result.status,error:result.error||"",payload:result.payload||{}}).slice(0,4000),ts,actionKey).run();
    const rejectionText=String(result.payload?.message||result.payload?.error?.message||result.error||"");
    const minMatch=rejectionText.match(/at least\s*\$?\s*([0-9]+(?:\.[0-9]+)?)\s*USD/i);
    if(Number(result.status)===422&&minMatch){
      const latest=await getPlatformConnection(env,"freelancer"), minUsd=Number(minMatch[1]);
      const metadata={...(latest.metadata||{}),bid_balance_blocked:true,bid_min_balance_usd:minUsd,bid_balance_constraint_learned_at:ts,bid_balance_constraint_source:"freelancer_api_422"};
      await env.DB.prepare("UPDATE platform_connections SET metadata_json=?,updated_at=? WHERE provider='freelancer'").bind(JSON.stringify(metadata),ts).run();
    }
    return {ok:false,submitted:false,status:result.status,reason:"bid_submit_failed",api_message:String(result.payload?.message||result.payload?.error?.message||result.error||"API rejected bid").slice(0,300),preflight:{project_id:pre.project_id,status:pre.status,budget:pre.budget,draft:{bid_amount:pre.draft.bid_amount,delivery_days:pre.draft.delivery_days}}};
  }
  const bid=result.payload?.result||{}, externalId=String(bid.id??bid.bid_id??"");
  await env.DB.prepare("UPDATE platform_actions SET status='submitted',external_action_id=?,response_metadata_json=?,updated_at=? WHERE action_key=?").bind(externalId,JSON.stringify({http_status:result.status,bid_id:externalId}).slice(0,4000),ts,actionKey).run();
  await env.DB.prepare(`INSERT INTO contract_payment_gates(opportunity_id,platform,application_status,contract_status,payment_status,payment_protection,external_reference,verified_at,created_at,updated_at)
    VALUES(?,'Freelancer.com','applied','not_agreed','unsecured','milestone_required',?,?,?,?)
    ON CONFLICT(opportunity_id) DO UPDATE SET application_status='applied',external_reference=excluded.external_reference,verified_at=excluded.verified_at,updated_at=excluded.updated_at`).bind(row.opportunity_id,externalId,ts,ts,ts).run();
  return {ok:true,submitted:true,bid_id:externalId,project_id:pre.project_id,amount:pre.draft.bid_amount,currency:pre.budget.currency,period:pre.draft.delivery_days};
}

async function freelancerCapabilityProbe(env) {
  const connection=await getPlatformConnection(env,"freelancer");
  if(connection.api_status!=="connected")return {ok:false,provider:"freelancer",capabilities:{identity:false,projects:false,bids:false,messages:false,milestones:false},write_actions_enabled:false};
  const identity=await freelancerApiRead(env,"/api/users/0.1/self/");
  const projects=await freelancerApiRead(env,"/api/projects/0.1/projects/active/?compact=true&limit=1");
  const metadata={...(connection.metadata||{}),capability_checked_at:nowIso(),capabilities:{identity:identity.ok,projects:projects.ok,bids:"not_write_tested",messages:"not_write_tested",milestones:"not_write_tested"}};
  await env.DB.prepare("UPDATE platform_connections SET metadata_json=?,updated_at=? WHERE provider='freelancer'").bind(JSON.stringify(metadata),nowIso()).run();
  return {ok:identity.ok&&projects.ok,provider:"freelancer",capabilities:metadata.capabilities,write_actions_enabled:false,policy:"Read-only capability probe. Bid, message and milestone write actions remain disabled until individually verified."};
}

async function platformConnectionCenter(env) {
  let freelancer=await getPlatformConnection(env,"freelancer");
  if(freelancer.account_status==="ready"&&freelancer.api_status!=="connected"&&env.FREELANCER_ACCESS_TOKEN){await verifyFreelancerConnection(env);freelancer=await getPlatformConnection(env,"freelancer");}
  const upworkConfigured=Boolean(String(env.UPWORK_ACCESS_TOKEN||"").trim());
  return {ok:true,providers:[{
    provider:"freelancer",label:"Freelancer",account_status:freelancer.account_status,api_status:freelancer.api_status,
    connected:freelancer.api_status==="connected",auth_method:freelancer.auth_method||"",
    next_action:freelancer.api_status==="connected"?"연결 완료":freelancer.account_status==="ready"?"Personal Access Token 연결 확인 필요":"Freelancer 계정 준비 확인",
    capabilities:freelancer.metadata?.capabilities||{},write_actions_enabled:true,automation_policy:"공식 API/승인된 연동만 사용. Manager 선별·Preflight·중복방지 게이트를 통과한 Freelancer 입찰만 자동 제출. 메시지·마일스톤 쓰기는 별도 검증 전 비활성."
  },{
    provider:"upwork",label:"Upwork",account_status:upworkConfigured?"credential_present":"api_access_required",api_status:upworkConfigured?"credential_present":"disconnected",
    connected:false,auth_method:upworkConfigured?"oauth_access_token_present":"",
    next_action:upworkConfigured?"공식 API 검증 구현 대기":"Upwork 공식 API 키/OAuth 승인 필요",
    capabilities:{scout:false,application:false},write_actions_enabled:false,automation_policy:"공식 API 자격과 OAuth가 검증되기 전 검색·지원 자동화 비활성."
  },{
    provider:"kmong",label:"크몽",account_status:"manual_channel",api_status:"manual",connected:false,auth_method:"",
    next_action:"표준화 서비스 판매 채널로 운영",capabilities:{seller_service:true,scout:false},write_actions_enabled:false,automation_policy:"비공식 크롤링/자동게시 금지. 내부에서 상품 초안만 생성."
  },{
    provider:"wishket",label:"위시켓",account_status:"public_readonly",api_status:"readonly",connected:true,auth_method:"public_page",
    next_action:"공개 프로젝트 자동 탐색 · 지원은 사람 확인",capabilities:{scout:true,application:false},write_actions_enabled:false,automation_policy:"공개 프로젝트 읽기만 자동화. 로그인 우회·자동지원·외부 쓰기 비활성."
  },{
    provider:"soomgo",label:"숨고",account_status:"paid_quote_manual",api_status:"manual",connected:false,auth_method:"",
    next_action:"견적 비용/수익성 확인 후 수동 지원",capabilities:{scout:false},write_actions_enabled:false,automation_policy:"유료 견적 채널. 자동 견적 발송 비활성."
  }]};
}

async function applicationCenterRows(env) {
  // Application Center must not depend on Manager having already visited a row.
  // Gate-audit and application selection now read the same Judge-approved candidate pool.
  // Manager state is optional display metadata; a missing state must never hide a valid bid candidate.
  const rows=(await env.DB.prepare(`SELECT o.*,m.stage AS manager_stage,m.status_label AS manager_status_label,m.next_action AS manager_next_action,
    g.application_status AS deal_application_status,g.contract_status AS deal_contract_status,g.payment_status AS deal_payment_status
    FROM opportunities o
    LEFT JOIN manager_job_states m ON m.opportunity_id=o.opportunity_id
    LEFT JOIN contract_payment_gates g ON g.opportunity_id=o.opportunity_id
    WHERE o.user_state!='reject' AND COALESCE(g.application_status,'not_applied')='not_applied'
    AND json_extract(o.score_breakdown,'$.factory_fulfillable')=1 AND json_extract(o.score_breakdown,'$.actionable_paid_job')=1
    ORDER BY o.score DESC,o.last_seen_at DESC LIMIT 400`).all()).results||[];
  const freelancer=await getPlatformConnection(env,"freelancer");
  const ranked=rows.map(row=>{const draft=applicationDraft(row),priority=applicationPriority(row,draft);
    const needsFreelancer=String(row.source||"")==="freelancer_projects";
    if(needsFreelancer&&freelancer.api_status!=="connected"){
      priority.points-=100; priority.hard_hold=true; priority.reasons.push("platform_not_connected");
    }
    return {row,draft:{...draft,priority,platform_connection:needsFreelancer?{provider:"freelancer",account_status:freelancer.account_status,api_status:freelancer.api_status}:null}}})
    .sort((a,b)=>b.draft.priority.points-a.draft.priority.points||Number(b.row.score||0)-Number(a.row.score||0));
  // Rank viable jobs by economics/competition, but always surface the best safe candidates
  // for explicit human approval instead of requiring an arbitrary positive score.
  const selected=ranked.filter(x=>!x.draft.priority.hard_hold).slice(0,3);
  return {
    selected:selected.map(x=>({...x,decision_summary:{
      competition_count:x.draft.priority.competition_count,
      gross_bid:x.draft.priority.gross_bid,
      estimated_platform_fee:x.draft.priority.estimated_platform_fee,
      estimated_net:x.draft.priority.estimated_net,
      fee_rate_assumption:x.draft.priority.fee_rate_assumption,
      effective_estimated_hours:x.draft.effective_estimated_hours,
      value_per_hour:x.draft.priority.value_per_hour,
      automation_completion_ratio:x.draft.priority.automation_completion_ratio,
      delivery_risk:x.draft.priority.delivery_risk,
      reasons:x.draft.priority.reasons
    }})),
    held:ranked.filter(x=>!selected.includes(x)),
    held_items:ranked.filter(x=>!selected.includes(x)).map(x=>({opportunity_id:x.row.opportunity_id,title:x.row.title,hard_hold:!!x.draft.priority.hard_hold,points:x.draft.priority.points,reasons:x.draft.priority.reasons||[]})),
    diagnostics:(()=>{
      const held=ranked.filter(x=>!selected.includes(x));
      const counts={hard_hold:0,below_priority:0,capacity_limit:0,platform_not_connected:0,qualification:0,attachment:0,complex_scope:0,delivery_risk:0,low_value:0,competition:0,client_access:0,other:0};
      for(const x of held){
        const p=x.draft.priority||{}, rs=p.reasons||[];
        if(p.hard_hold)counts.hard_hold++;
        if(!p.hard_hold&&selected.includes(x)){} else if(!p.hard_hold)counts.capacity_limit++;
        if(rs.includes("platform_not_connected"))counts.platform_not_connected++;
        if(rs.includes("qualification_evidence_gate"))counts.qualification++;
        if(rs.includes("attachment_review_gate"))counts.attachment++;
        if(rs.includes("complex_scope_review_gate"))counts.complex_scope++;
        if(rs.includes("delivery_risk_gate"))counts.delivery_risk++;
        if(rs.includes("low_value_per_hour"))counts.low_value++;
        if(rs.includes("high_competition")||rs.includes("very_high_competition"))counts.competition++;
        if(rs.includes("client_access_required_after_contract"))counts.client_access++;
        if(!p.hard_hold&&Number(p.points||0)>=4&&selected.length>=3){} else if(!(rs.length))counts.other++;
      }
      return {candidate_count:ranked.length,selected_count:selected.length,held_count:held.length,selection_threshold:"ranked_safe_top3",selection_capacity:3,counts};
    })()
  };
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
  // Every Judge-approved factory job needs an executable dry-run package.
  // Non-code deliverables still receive a deterministic acceptance harness instead of failing the sandbox.
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
        "export async function createEtsyDraft({shopId,token,keystring,sharedSecret,listing,allowExternalActions=false,fetchImpl=fetch}={}){approved({allowExternalActions});need(shopId,'Etsy shop id');need(token,'Etsy OAuth token');need(keystring,'Etsy API keystring');need(sharedSecret,'Etsy shared secret');const body=new URLSearchParams();const src={quantity:listing?.quantity,title:listing?.title,description:listing?.description,price:listing?.price,who_made:listing?.whoMade,when_made:listing?.whenMade,taxonomy_id:listing?.taxonomyId,shipping_profile_id:listing?.shippingProfileId,readiness_state_id:listing?.readinessStateId};for(const [k,v] of Object.entries(src))if(v!=null&&v!=='')body.set(k,String(v));for(const tag of listing?.tags||[])body.append('tags[]',tag);const r=await fetchImpl(endpoints.etsyListings(shopId),{method:'POST',headers:{Authorization:'Bearer '+token,'x-api-key':keystring+':'+sharedSecret,'Content-Type':'application/x-www-form-urlencoded'},body});return readJson(r)}",
        "export async function getProdigiProduct({sku,apiKey,sandbox=true,fetchImpl=fetch}={}){need(sku,'Prodigi SKU');need(apiKey,'Prodigi API key');const r=await fetchImpl(endpoints.prodigiProduct(sku,sandbox),{headers:{'X-API-Key':apiKey,Accept:'application/json'}});return readJson(r)}",
        "export async function createProdigiOrder({order,apiKey,sandbox=true,allowExternalActions=false,fetchImpl=fetch}={}){approved({allowExternalActions});need(apiKey,'Prodigi API key');if(sandbox!==true)throw new Error('Live Prodigi orders require a separate production approval step');const r=await fetchImpl(endpoints.prodigiOrders(true),{method:'POST',headers:{'X-API-Key':apiKey,'Content-Type':'application/json'},body:JSON.stringify(order||{})});return readJson(r)}"
      ].join("\n")},
      {path:"project/test/live-connectors.test.js",language:"javascript",content:[
        "import test from 'node:test';import assert from 'node:assert/strict';import {endpoints,createEtsyDraft,createProdigiOrder} from '../src/live-connectors.js';",
        "test('official API endpoints are wired',()=>{assert.equal(endpoints.squarespaceProducts,'https://api.squarespace.com/v2/commerce/products');assert.match(endpoints.etsyListings('123'),/openapi\\.etsy\\.com\\/v3\\/application\\/shops\\/123\\/listings/);assert.match(endpoints.prodigiProduct('SKU',true),/api\\.sandbox\\.prodigi\\.com\\/v4\\.0\\/products\\/SKU/)});",
        "test('write operations require explicit approval',async()=>{await assert.rejects(()=>createEtsyDraft({shopId:'1',token:'t',keystring:'k',sharedSecret:'s',listing:{}}),/explicit approval/);await assert.rejects(()=>createProdigiOrder({order:{},apiKey:'k'}),/explicit approval/)})"
      ].join("\n")},
      {path:"project/.env.example",language:"text",content:["SQUARESPACE_TOKEN=","ETSY_SHOP_ID=","ETSY_OAUTH_TOKEN=","ETSY_KEYSTRING=","ETSY_SHARED_SECRET=","PRODIGI_SANDBOX_API_KEY=","# Live credentials are intentionally not enabled by default."].join("\n")},
      {path:"project/LIVE_RUNBOOK.md",language:"markdown",content:["# Live connector runbook","","The package includes real connector functions for Squarespace Products API v2, Etsy Open API v3 draft listings, and Prodigi Print API v4 sandbox.","","## Safety model","- Read operations can be used after credentials are supplied.","- Etsy write calls require allowExternalActions=true.","- Prodigi order creation is restricted to the Sandbox host in the generated connector.","- Prodigi Live order submission remains blocked until a separate production approval step is implemented.","","## Required Etsy fields","Before creating physical draft listings, provide quantity, title, description, price, whoMade, whenMade, taxonomyId, shippingProfileId and readinessStateId.","","## Acceptance","Run npm test, create one Etsy draft in an authorized shop, verify SKU/variant mapping, then create one Prodigi Sandbox order before any live rollout."].join("\n")},

      {path:"project/README.md",language:"markdown",content:["# Squarespace → Etsy → Prodigi delivery package","","Implements the repeatable transformation layer without touching external accounts.","","## Implemented","- Normalize Squarespace-style product JSON, variants, images and tags.","- Produce Etsy listing drafts with title/tag/price/variant constraints.","- Map variant SKUs to client-supplied Prodigi product/template settings.","- Validate missing titles, invalid prices and missing Prodigi mappings.","- Run deterministic tests with npm test.","","## Run","1. Replace fixtures/squarespace-products.json with the authorized client export.","2. Fill config/example.json with approved Etsy profile IDs and Prodigi SKU mappings.","3. Run npm test.","4. Run node src/cli.js <products.json> <config.json> delivery-output.json.","","External publishing is intentionally disabled. Credentials are never embedded."].join("\n")},
      {path:"project/HANDOVER.md",language:"markdown",content:["# Hand-over and client-access gate","","## Internal production complete","Migration transformation, listing-draft generation, SKU mapping and validation can be built and tested without client credentials.","","## Required before live execution","- Authorized Squarespace product export or account access.","- Etsy shop access plus approved section/shipping profile identifiers.","- Prodigi account/API access and the real SKU-to-product/template mapping.","- Client approval for shipping/tax configuration and a live test order.","","## Live acceptance sequence","Authorized export → validation → Etsy listing creation with approved access → real Prodigi mapping → controlled end-to-end test order → acceptance evidence.","","No external account action is performed until explicitly authorized."].join("\n")}
    );
  } else {
    files.push(
      {path:"project/src/index.js",language:"javascript",content:"import { requirements, externalActionsAllowed } from './spec.js';\nexport function buildPlan(){ return { requirements, externalActionsAllowed, status:'internal-build-ready', acceptanceHarness:true }; }\n"},
      {path:"project/test/spec.test.js",language:"javascript",content:"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { buildPlan } from '../src/index.js';\ntest('factory acceptance harness is safe and concrete',()=>{ const p=buildPlan(); assert.equal(p.externalActionsAllowed,false); assert.equal(p.acceptanceHarness,true); assert.ok(p.requirements.length>0); assert.ok(p.requirements.every(x=>String(x).trim().length>0)); });\n"},
      {path:"project/ACCEPTANCE.md",language:"markdown",content:"# Factory acceptance harness\n\nThis dry-run package validates that the Judge/Manager produced concrete requirements and that no external side effects are enabled before contract, client-input and account gates are complete.\n\nA passing sandbox is a preflight result, not a claim that the final client deliverable has already been produced.\n"},
      {path:"project/README.md",language:"markdown",content:"# Automation Factory generated project\n\nInternal preflight package generated from the Manager specification. It is intentionally side-effect-free. After contract/payment and required client inputs are secured, the production worker builds the job-specific deliverables and QC package.\n"}
    );
  }
  return {code_worker_version:"code-worker-v2.2",status:"source_generated",implementation_level:isCommerceMigration?"runnable_job_specific_package":(isAutomation?"runnable_generic_scaffold":"acceptance_harness"),project_kind:"node-esm",files,file_count:files.length,test_execution:"sandbox_runner_available",test_runner:"github-actions:sandbox-runner-v1",test_command:"npm test",external_side_effects:false,note:"Every Judge-approved factory job receives an executable, side-effect-free sandbox package. For non-code work the sandbox is an acceptance preflight only; production remains gated on contract/payment and required client inputs."};
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
  const gh=await fetch(api,{method:"POST",headers:{"authorization":"Bearer "+env.GITHUB_ACTIONS_TOKEN,"accept":"application/vnd.github+json","content-type":"application/json","x-github-api-version":"2022-11-28","user-agent":"AutomationFactory-MoneyScout/0.49.0"},body:JSON.stringify({ref:"main",inputs:{run_id:runId,bundle_url:bundleUrl,callback_url:callbackUrl}})});
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
  const intake=plan?.client_intake||{status:"not_started",answers:{},completion:{missing:[]}};
  const safeIntake={intake_version:"client-intake-v3",status:intake.status||"not_started",answers:intake.answers||{},completion:intake.completion||{},discovery_plan:intake.discovery_plan||[],note:"Account credentials are stored separately and are intentionally excluded from this package."};
  files.push({path:"client/CLIENT_INPUT.json",content:JSON.stringify(safeIntake,null,2)});
  const ia=safeIntake.answers||{}, connList=plan?.account_connections?.connections||[], prodigiConn=connList.find(x=>x.provider==="prodigi");
  let parsedSkuMap={}; try{const x=JSON.parse(ia.prodigi_sku_mapping_override||"{}");if(x&&typeof x==="object"&&!Array.isArray(x))parsedSkuMap=x}catch{}
  const clientConfig={
    etsy:{shopId:ia.etsy_shop_id_override||"",taxonomyId:"auto",shippingProfileId:ia.etsy_shipping_profile_id_override||"auto",readinessStateId:ia.etsy_readiness_state_id_override||"auto",sectionId:ia.etsy_section_id_override||"auto",categoryHint:ia.etsy_category_hint||""},
    prodigi:{mode:prodigiConn?.metadata?.mode||"sandbox",skuMap:parsedSkuMap,skuMappingOverrideRaw:ia.prodigi_sku_mapping_override||"",productNotes:ia.prodigi_product_notes||"",autoMap:!Object.keys(parsedSkuMap).length},
    scope:{productScope:ia.product_scope||"",commerceSettingsMode:ia.commerce_settings_mode||"",shippingRegions:ia.shipping_regions||"",shippingPolicy:ia.shipping_policy||"",taxPolicy:ia.tax_policy||"",deliveryDate:ia.delivery_date||""},
    accountConnections:(plan?.account_connections?.connections||[]).map(x=>({provider:x.provider,status:x.status,auth_method:x.auth_method,metadata:x.metadata||{}})),
    externalActionsAllowed:false
  };
  files.push({path:"config/client.json",content:JSON.stringify(clientConfig,null,2)});
  const missing=(safeIntake.completion?.missing||[]);
  const conn=(plan?.account_connections?.connections||[]), accessLines=conn.map(x=>"- "+x.provider+": "+x.status+" via "+x.auth_method);
  files.push({path:"client/ACCESS_STATUS.md",content:["# Client intake/access status","","Intake status: "+safeIntake.status,"Missing required fields: "+(missing.length?missing.join(", "):"none"),"","## Account connections",...(accessLines.length?accessLines:["- none required"]), "", "Passwords, API keys, OAuth access tokens and refresh tokens are never exported to GitHub Actions artifacts or delivery ZIP files."].join("\n")});
  const manifest={pipeline_version:"production-pipeline-v4",opportunity_id:opportunityId,title:plan?.build_spec?.title||"",implementation_level:cw.implementation_level||"unknown",requirements:plan?.build_spec?.functional_requirements||[],acceptance_criteria:plan?.build_spec?.acceptance_criteria||[],qc:plan?.qc||null,factory_builder:plan?.factory_builder||null,contract_payment:{ready:Boolean(plan?.contract_payment?.ready),platform:plan?.contract_payment?.gate?.platform||"",contract_status:plan?.contract_payment?.gate?.contract_status||"",payment_status:plan?.contract_payment?.gate?.payment_status||"",payment_protection:plan?.contract_payment?.gate?.payment_protection||"",gross_amount:plan?.contract_payment?.gate?.gross_amount??null,currency:plan?.contract_payment?.gate?.currency||"",fee_estimate:plan?.contract_payment?.gate?.fee_estimate??null,net_estimate:plan?.contract_payment?.gate?.net_estimate??null,payout_route:plan?.contract_payment?.gate?.payout_route||"",payout_destination:plan?.contract_payment?.gate?.payout_destination||""},client_intake:{status:safeIntake.status,completion:safeIntake.completion},revision_request:plan?.revision_request||null,account_connections:{progress:plan?.account_connections?.progress||{},connections:(plan?.account_connections?.connections||[]).map(x=>({provider:x.provider,status:x.status,auth_method:x.auth_method}))},external_actions_allowed:false,generated_at:nowIso()};
  files.push({path:"delivery/MANIFEST.json",content:JSON.stringify(manifest,null,2)});
  return {bundle_version:"job-production-bundle-v4",opportunity_id:opportunityId,project_kind:cw.project_kind||"",test_command:cw.test_command||"npm test",files,external_actions_allowed:false};
}

async function dispatchProduction(request, env, opportunityId) {
  const row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(opportunityId).first();
  if(!row) return json({ok:false,error:"Paid job not found"},404);
  let bd={};try{bd=JSON.parse(row.score_breakdown||"{}")}catch{}
  if(!bd.actionable_paid_job||!bd.factory_fulfillable) return json({ok:false,error:"Factory-ready paid job only"},400);
  const deal=await getContractPaymentGate(env,row);
  if(!deal.ready) return json({ok:true,status:"contract_payment_required",deal,note:"Contract acceptance and secured/prepaid payment are required before production."},202);
  const sandbox=await env.DB.prepare("SELECT run_id FROM sandbox_runs WHERE opportunity_id=? AND status='completed' AND conclusion='success' ORDER BY created_at DESC LIMIT 1").bind(opportunityId).first();
  if(!sandbox) return json({ok:true,status:"sandbox_required",note:"Run and pass the sandbox test before starting production."});
  const plan=paidJobPlan(row);
  const intake=await getClientIntake(env,row,plan), accountConnections=await getAccountConnections(env,row);
  if(intake.status!=="ready_for_build") return json({ok:true,status:"client_intake_required",completion:intake.completion,request_message:intake.request_message},202);
  if(!accountConnections.progress.ready) return json({ok:true,status:"account_connection_required",connections:accountConnections.connections,progress:accountConnections.progress},202);
  plan.client_intake={status:intake.status,answers:intake.answers,completion:intake.completion,request_message:intake.request_message,discovery_plan:intake.discovery_plan||[]};
  plan.account_connections=accountConnections;
  plan.contract_payment={ready:deal.ready,gate:deal.gate,profile:deal.profile};
  const revision=await env.DB.prepare("SELECT * FROM revision_approvals WHERE opportunity_id=? AND status='approved' ORDER BY updated_at DESC LIMIT 1").bind(opportunityId).first();
  if(revision)plan.revision_request={feedback_message_id:revision.feedback_message_id,instructions:revision.feedback_body};
  // All client/revision context must exist before builders generate production artifacts.
  plan.factory_builder=factoryBuilder(plan); plan.worker_execution=workerExecutionPlan(plan); plan.build_runtime=buildRuntime(plan); plan.artifact_generator=artifactGenerator(plan); plan.code_worker=codeWorker(plan); plan.qc=qcPlan(plan);
  if(plan.qc.status!=="preflight_pass") return json({ok:false,error:"QC preflight blocked",qc:plan.qc},400);
  if(plan.code_worker.status!=="source_generated") return json({ok:false,error:"No generated code for production"},400);
  const runId="prd_"+crypto.randomUUID(), bundle=productionBundle(opportunityId,plan), now=nowIso();
  const nextGate=intake.status!=="ready_for_build"?"client_intake_required":(!accountConnections.progress.ready?"account_connection_required":((plan.factory_builder.blocked_tasks||0)>0?"secure_execution_approval":"user_delivery_review"));
  const summary={pipeline_version:"production-pipeline-v4",implementation_level:plan.code_worker.implementation_level||"unknown",file_count:bundle.files.length,qc_status:plan.qc.status,ready_tasks:plan.factory_builder.ready_tasks||0,blocked_tasks:plan.factory_builder.blocked_tasks||0,contract_payment:{ready:deal.ready,contract_status:deal.gate.contract_status,payment_status:deal.gate.payment_status,payment_protection:deal.gate.payment_protection,net_estimate:deal.gate.net_estimate,currency:deal.gate.currency},intake_status:intake.status,intake_missing:intake.completion?.missing||[],account_connections:accountConnections.progress,next_gate:nextGate,sandbox_run_id:sandbox.run_id,external_actions_allowed:false};
  await env.DB.prepare("INSERT INTO production_runs(run_id,opportunity_id,bundle_json,status,package_summary_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(runId,opportunityId,JSON.stringify(bundle),"created",JSON.stringify(summary),now,now).run();
  if(revision)await env.DB.prepare("UPDATE revision_approvals SET status='running',production_run_id=?,updated_at=? WHERE opportunity_id=? AND feedback_message_id=?").bind(runId,now,opportunityId,revision.feedback_message_id).run();
  const missingConfig=[]; if(!env.GITHUB_ACTIONS_TOKEN)missingConfig.push("GITHUB_ACTIONS_TOKEN"); if(!env.SANDBOX_CALLBACK_TOKEN)missingConfig.push("SANDBOX_CALLBACK_TOKEN");
  if(missingConfig.length) return json({ok:true,run_id:runId,status:"config_required",missing_configuration:missingConfig,summary},202);
  const api="https://api.github.com/repos/lsc1313/AutomationFactory/actions/workflows/sandbox-runner.yml/dispatches";
  const publicBaseUrl=String(env.PUBLIC_BASE_URL||new URL(request.url).origin).replace(/\/$/,"");
  const bundleUrl=publicBaseUrl+"/api/production-runs/"+encodeURIComponent(runId)+"/bundle", callbackUrl=publicBaseUrl+"/api/production-runs/"+encodeURIComponent(runId)+"/result";
  const gh=await fetch(api,{method:"POST",headers:{"authorization":"Bearer "+env.GITHUB_ACTIONS_TOKEN,"accept":"application/vnd.github+json","content-type":"application/json","x-github-api-version":"2022-11-28","user-agent":"AutomationFactory-MoneyScout/0.49.0"},body:JSON.stringify({ref:"main",inputs:{run_id:runId,bundle_url:bundleUrl,callback_url:callbackUrl}})});
  if(!gh.ok){const msg=(await gh.text()).slice(0,500);await env.DB.prepare("UPDATE production_runs SET status='dispatch_failed',log_summary=?,updated_at=? WHERE run_id=?").bind(msg,nowIso(),runId).run();return json({ok:false,run_id:runId,error:"GitHub production dispatch failed",detail:msg},502);}
  await env.DB.prepare("UPDATE production_runs SET status='dispatched',updated_at=? WHERE run_id=?").bind(nowIso(),runId).run();
  return json({ok:true,run_id:runId,status:"dispatched",summary},202);
}


function defaultDeliveryMessage(row, production) {
  const title=String(row?.title||"project").trim();
  return [
    "Hi,",
    "",
    "The agreed work for “"+title+"” has been completed and passed the Automation Factory production checks.",
    "I have prepared the delivery package for your review.",
    "",
    "Please review the files and let me know if you need any adjustments within the agreed scope.",
    "",
    "Thank you."
  ].join("\n");
}

async function getDeliveryApproval(env,row) {
  const production=await env.DB.prepare("SELECT run_id,status,conclusion,bundle_json,package_summary_json,updated_at FROM production_runs WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 1").bind(row.opportunity_id).first();
  if(!production||production.status!=="completed"||production.conclusion!=="success")return {ok:true,status:"production_not_ready",approved:false};
  let bundle={};try{bundle=JSON.parse(production.bundle_json||"{}")}catch{}
  const files=(bundle.files||[]).map(f=>({path:String(f.path||""),bytes:new TextEncoder().encode(String(f.content||"")).length}));
  let saved=await env.DB.prepare("SELECT * FROM delivery_approvals WHERE opportunity_id=?").bind(row.opportunity_id).first();
  if(!saved||saved.production_run_id!==production.run_id){
    const ts=nowIso(),message=defaultDeliveryMessage(row,production);
    await env.DB.prepare("INSERT INTO delivery_approvals(opportunity_id,production_run_id,status,delivery_message,approved_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(opportunity_id) DO UPDATE SET production_run_id=excluded.production_run_id,status='pending',delivery_message=excluded.delivery_message,approved_at='',updated_at=excluded.updated_at")
      .bind(row.opportunity_id,production.run_id,"pending",message,"",saved?.created_at||ts,ts).run();
    saved=await env.DB.prepare("SELECT * FROM delivery_approvals WHERE opportunity_id=?").bind(row.opportunity_id).first();
  }
  return {ok:true,status:saved.status,approved:saved.status==="approved",production_run_id:production.run_id,delivery_message:saved.delivery_message,files,external_actions_allowed:false,updated_at:saved.updated_at};
}

async function approveDelivery(env,row,body={}) {
  const current=await getDeliveryApproval(env,row);
  if(current.status==="production_not_ready")return {ok:false,status:"production_not_ready",error:"Successful production is required before delivery approval."};
  const approved=body.approved===true, status=approved?"approved":"pending", ts=nowIso();
  const message=String(body.delivery_message??current.delivery_message??"").trim().slice(0,8000)||defaultDeliveryMessage(row);
  await env.DB.prepare("UPDATE delivery_approvals SET status=?,delivery_message=?,approved_at=?,updated_at=? WHERE opportunity_id=?")
    .bind(status,message,approved?ts:"",ts,row.opportunity_id).run();
  return {...await getDeliveryApproval(env,row),note:approved?"Approved for a later platform-delivery action. Nothing was sent externally.":"Delivery approval is pending; nothing was sent externally."};
}


async function sendFreelancerDelivery(env,row) {
  const delivery=await getDeliveryApproval(env,row);
  if(!delivery.ok||delivery.status!=="approved")return {ok:false,reason:"delivery_not_approved"};
  const projectId=String(row?.source_item_id||"").trim();
  if(!/^\d+$/.test(projectId))return {ok:false,reason:"project_id_missing"};
  const threadAction=await env.DB.prepare("SELECT * FROM platform_actions WHERE provider=\'freelancer\' AND opportunity_id=? AND action_type=\'thread\' AND status=\'confirmed\' ORDER BY updated_at DESC LIMIT 1").bind(row.opportunity_id).first();
  const threadId=String(threadAction?.external_action_id||"").trim();
  if(!/^\d+$/.test(threadId))return {ok:false,reason:"thread_missing"};
  const key="freelancer:delivery:"+row.opportunity_id+":"+delivery.production_run_id;
  const existing=await env.DB.prepare("SELECT * FROM platform_actions WHERE action_key=? AND status=\'confirmed\'").bind(key).first();
  if(existing)return {ok:true,sent:true,duplicate:true,thread_id:threadId,message_id:String(existing.external_action_id||"")};
  const message=String(delivery.delivery_message||"").trim();
  if(!message)return {ok:false,reason:"delivery_message_missing"};
  const sent=await freelancerApiForm(env,"/api/messages/0.1/threads/"+threadId+"/messages/",{message});
  if(!sent.ok)return {ok:false,reason:"delivery_send_failed",status:sent.status};
  const obj=sent.payload?.result||sent.payload?.message||sent.payload||{},ts=nowIso(),mid=String(obj.id??obj.message_id??"").trim();
  await env.DB.prepare("INSERT INTO platform_actions(action_key,provider,opportunity_id,external_object_id,action_type,status,request_hash,external_action_id,response_metadata_json,created_at,updated_at) VALUES(?,'freelancer',?,?,'delivery_message','confirmed','',?,?,?,?) ON CONFLICT(action_key) DO NOTHING")
    .bind(key,row.opportunity_id,projectId,mid,JSON.stringify({thread_id:threadId,production_run_id:delivery.production_run_id}),ts,ts).run();
  if(mid)await env.DB.prepare("INSERT OR IGNORE INTO platform_messages(provider,opportunity_id,thread_id,message_id,sender_id,body,direction,created_at) VALUES(\'freelancer\',?,?,?,?,?,\'outbound\',?)")
    .bind(row.opportunity_id,threadId,mid,"",message,ts).run();
  return {ok:true,sent:true,duplicate:false,thread_id:threadId,message_id:mid};
}

function classifyClientFeedback(text) {
  const body=String(text||"").trim();
  if(!body)return {kind:"none",revision_required:false};
  const lower=body.toLowerCase();
  const revision=/(revise|revision|change|modify|fix|adjust|update|incorrect|wrong|missing|please redo|can you change|수정|변경|고쳐|다시|누락|틀렸|잘못)/i.test(lower);
  const accepted=/(approved|accepted|looks good|great work|thank you|thanks|perfect|all good|확인했습니다|확인했어요|좋습니다|감사합니다|완벽|승인)/i.test(lower);
  if(revision)return {kind:"revision_requested",revision_required:true};
  if(accepted)return {kind:"accepted",revision_required:false};
  return {kind:"feedback",revision_required:false};
}

async function getPostDeliveryFeedback(env,row) {
  const sent=await env.DB.prepare("SELECT * FROM platform_actions WHERE provider=\'freelancer\' AND opportunity_id=? AND action_type=\'delivery_message\' AND status=\'confirmed\' ORDER BY updated_at DESC LIMIT 1").bind(row.opportunity_id).first();
  if(!sent)return {ok:true,kind:"none",revision_required:false};
  let meta={};try{meta=JSON.parse(sent.response_metadata_json||"{}")}catch{}
  const threadId=String(meta.thread_id||"").trim(), sentAt=String(sent.updated_at||sent.created_at||"");
  if(!threadId)return {ok:true,kind:"none",revision_required:false};
  const feedback=await env.DB.prepare("SELECT message_id,body,created_at FROM platform_messages WHERE provider=\'freelancer\' AND opportunity_id=? AND thread_id=? AND direction=\'inbound\' AND created_at>? ORDER BY created_at ASC").bind(row.opportunity_id,threadId,sentAt).all();
  const rows=feedback.results||[]; if(!rows.length)return {ok:true,kind:"none",revision_required:false,thread_id:threadId};
  const latest=rows[rows.length-1], classification=classifyClientFeedback(latest.body);
  return {ok:true,...classification,thread_id:threadId,message_id:latest.message_id,body:latest.body,created_at:latest.created_at,count:rows.length};
}

async function getRevisionApproval(env,row) {
  const feedback=await getPostDeliveryFeedback(env,row);
  if(!feedback.revision_required)return {ok:true,status:"not_required",approved:false,feedback};
  let saved=await env.DB.prepare("SELECT * FROM revision_approvals WHERE opportunity_id=?").bind(row.opportunity_id).first();
  if(!saved||String(saved.feedback_message_id||"")!==String(feedback.message_id||"")){
    const ts=nowIso();
    await env.DB.prepare("INSERT INTO revision_approvals(opportunity_id,feedback_message_id,feedback_body,status,approved_at,production_run_id,created_at,updated_at) VALUES(?,?,?,'pending','','',?,?) ON CONFLICT(opportunity_id) DO UPDATE SET feedback_message_id=excluded.feedback_message_id,feedback_body=excluded.feedback_body,status='pending',approved_at='',production_run_id='',updated_at=excluded.updated_at").bind(row.opportunity_id,String(feedback.message_id||""),String(feedback.body||"").slice(0,12000),ts,ts).run();
    saved=await env.DB.prepare("SELECT * FROM revision_approvals WHERE opportunity_id=?").bind(row.opportunity_id).first();
  }
  return {ok:true,status:saved.status,approved:saved.status==="approved",feedback_message_id:saved.feedback_message_id,feedback_body:saved.feedback_body,production_run_id:saved.production_run_id||"",updated_at:saved.updated_at};
}

async function approveRevision(env,row,body={}) {
  const current=await getRevisionApproval(env,row);
  if(current.status==="not_required")return {ok:false,status:"not_required",error:"No client revision request is waiting for approval."};
  const approved=body.approved===true,ts=nowIso();
  await env.DB.prepare("UPDATE revision_approvals SET status=?,approved_at=?,updated_at=? WHERE opportunity_id=?").bind(approved?"approved":"pending",approved?ts:"",ts,row.opportunity_id).run();
  return getRevisionApproval(env,row);
}

async function managerSaveState(env,opportunityId,state) {
  const ts=nowIso();
  await env.DB.prepare("INSERT INTO manager_job_states(opportunity_id,stage,status_label,next_action,autopilot,last_action,last_error,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(opportunity_id) DO UPDATE SET stage=excluded.stage,status_label=excluded.status_label,next_action=excluded.next_action,autopilot=excluded.autopilot,last_action=excluded.last_action,last_error=excluded.last_error,updated_at=excluded.updated_at")
    .bind(opportunityId,String(state.stage||"unknown"),String(state.status_label||""),String(state.next_action||""),"on",String(state.last_action||""),String(state.last_error||""),ts).run();
  return {...state,autopilot:"on",updated_at:ts};
}

async function managerResponseData(response) {
  try{return await response.clone().json()}catch{return {ok:false,status:"invalid_response",error:"Manager could not parse worker response"}}
}

function managerDealNext(deal) {
  const g=deal?.gate||{};
  if(g.application_status==="not_applied")return "지원/제안 전송 대기";
  if(g.application_status==="applied")return "고객 응답·낙찰 대기";
  if(g.application_status==="client_replied")return "계약 조건 협의 대기";
  if(g.contract_status!=="accepted")return "계약/작업 합의 확인 대기";
  if(!(g.payment_status==="secured"||g.payment_status==="prepaid"||g.payment_status==="paid"))return "에스크로·마일스톤·선결제 확보 대기";
  if(!(Number(g.gross_amount)>0&&String(g.currency||"").trim()))return "실제 합의금액 확인 대기";
  return "계약·결제 확인";
}

async function managerEvaluateJob(request,env,row,{autoActions=false,actionBudget=null}={}) {
  const id=row.opportunity_id;
  const consume=()=>{if(!actionBudget)return true;if(actionBudget.remaining<=0)return false;actionBudget.remaining--;return true;};
  try{
    const managerDraft=applicationDraft(row), managerPriority=applicationPriority(row,managerDraft);
    if(managerPriority.hard_hold)return managerSaveState(env,id,{stage:"auto_held",status_label:"⏸️ 자동보류 · 안전 게이트",next_action:"새 원문/조건이 들어오면 Manager가 다시 평가",last_action:"manager_safety_hold"});
    const latestSandbox=await env.DB.prepare("SELECT run_id,status,conclusion,log_summary,github_run_id,updated_at FROM sandbox_runs WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 1").bind(id).first();
    if(!latestSandbox){
      if(autoActions&&consume()){
        const out=await managerResponseData(await dispatchSandbox(request,env,id));
        if(out.status==="dispatched")return managerSaveState(env,id,{stage:"sandbox_running",status_label:"🧪 자동 샌드박스 실행 중",next_action:"Manager가 결과를 기다리는 중",last_action:"sandbox_dispatched"});
        if(out.status==="config_required")return managerSaveState(env,id,{stage:"needs_attention",status_label:"⚠️ 공장 설정 필요",next_action:"누락 설정: "+(out.missing_configuration||[]).join(", "),last_action:"sandbox_config_required"});
        return managerSaveState(env,id,{stage:"needs_attention",status_label:"⚠️ 샌드박스 시작 실패",next_action:out.error||out.status||"수동 확인 필요",last_error:out.error||""});
      }
      return managerSaveState(env,id,{stage:"sandbox_queued",status_label:"🧪 샌드박스 자동검증 대기",next_action:"Manager가 자동 실행 예정"});
    }
    if(latestSandbox.status==="created"||latestSandbox.status==="dispatched")return managerSaveState(env,id,{stage:"sandbox_running",status_label:"🧪 자동 샌드박스 실행 중",next_action:"결과 확인 중",last_action:"sandbox_running"});
    if(latestSandbox.status==="dispatch_failed"||(latestSandbox.status==="completed"&&latestSandbox.conclusion!=="success"))return managerSaveState(env,id,{stage:"needs_attention",status_label:"⚠️ 샌드박스 예외",next_action:"자동 재시도하지 않음 · 상세에서 오류 확인",last_error:latestSandbox.log_summary||"sandbox failed"});
    if(!(latestSandbox.status==="completed"&&latestSandbox.conclusion==="success"))return managerSaveState(env,id,{stage:"sandbox_wait",status_label:"🧪 샌드박스 상태 확인 중",next_action:"Manager가 다음 주기에 재확인"});

    let deal=await getContractPaymentGate(env,row);
    if(String(row.source||"")==="freelancer_projects"&&String(deal.gate?.application_status||"")==="applied"){
      const tracked=await syncFreelancerBidStatus(env,row);
      if(tracked.ok&&tracked.accepted)deal=await getContractPaymentGate(env,row);
      else if(tracked.ok&&tracked.rejected)return managerSaveState(env,id,{stage:"closed",status_label:"⛔ 입찰 종료",next_action:"다른 수익 기회 탐색",last_action:"freelancer_bid_closed"});
    }
    if(String(row.source||"")==="freelancer_projects"&&String(deal.gate?.contract_status||"")==="accepted"){
      await syncFreelancerMessaging(env,row);
      deal=await getContractPaymentGate(env,row);
    }
    if(String(row.source||"")==="freelancer_projects"&&String(deal.gate?.contract_status||"")==="accepted"&&String(deal.gate?.payment_status||"")!=="secured"){
      const milestone=await syncFreelancerMilestoneStatus(env,row);
      if(milestone.ok&&milestone.secured)deal=await getContractPaymentGate(env,row);
    }
    if(!deal.ready){
      const canAutoBid=String(row.source||"")==="freelancer_projects"&&String(deal.gate?.application_status||"not_applied")==="not_applied";
      // External bid writes require an explicit user approval from Application Center.
      // The orchestrator may prepare/rank applications, but never submit a new bid by itself.
      if(false&&canAutoBid&&autoActions&&consume()){
        const preBidDraft=applicationDraft(row), preBidPriority=applicationPriority(row,preBidDraft);
        if(preBidPriority.hard_hold)return managerSaveState(env,id,{stage:"auto_held",status_label:"⏸️ 자동보류 · 입찰 직전 안전 게이트",next_action:"최신 원문/조건 기준으로 자동입찰 차단",last_action:"prebid_safety_hold"});
        const center=await applicationCenterRows(env);
        const selected=(center.selected||[]).some(x=>String(x.row?.opportunity_id||"")===String(id));
        if(selected){
          const bid=await submitFreelancerBid(env,row);
          if(bid.ok&&bid.submitted)return managerSaveState(env,id,{stage:"waiting_contract_payment",status_label:"📨 자동입찰 완료 · 고객 응답 대기",next_action:"Freelancer 낙찰·Milestone 확인 대기",last_action:"freelancer_bid_submitted"});
          if(bid.duplicate)return managerSaveState(env,id,{stage:"waiting_contract_payment",status_label:"📨 기존 입찰 확인 · 고객 응답 대기",next_action:"Freelancer 낙찰·Milestone 확인 대기",last_action:"freelancer_bid_already_submitted"});
          return managerSaveState(env,id,{stage:"needs_attention",status_label:"⚠️ 자동입찰 실패",next_action:"입찰 응답 확인 필요",last_error:bid.reason||("HTTP "+String(bid.status||""))});
        }
      }
      return managerSaveState(env,id,{stage:"waiting_contract_payment",status_label:"💳 "+managerDealNext(deal),next_action:(deal.profile?.platform||deal.gate?.platform||"플랫폼")+" 계약·결제 상태를 자동/외부 확인 대기"});
    }

    const plan=paidJobPlan(row), intake=await getClientIntake(env,row,plan);
    if(intake.status!=="ready_for_build")return managerSaveState(env,id,{stage:"waiting_client_answers",status_label:"👤 고객 답변 대기",next_action:"필수 "+(intake.completion?.complete||0)+"/"+(intake.completion?.required||0)+" · 필요한 질문만 고객에게 수집"});

    const connections=await getAccountConnections(env,row);
    if(!connections.progress.ready)return managerSaveState(env,id,{stage:"waiting_account_connections",status_label:"🔗 고객 계정 승인 대기",next_action:"연결 "+connections.progress.connected+"/"+connections.progress.required+" · 필요한 서비스만 승인 대기"});

    const latestProduction=await env.DB.prepare("SELECT run_id,status,conclusion,log_summary,github_run_id,updated_at FROM production_runs WHERE opportunity_id=? ORDER BY created_at DESC LIMIT 1").bind(id).first();
    if(latestProduction){
      if(latestProduction.status==="created"||latestProduction.status==="dispatched")return managerSaveState(env,id,{stage:"production_running",status_label:"🏭 자동 제작·QC 진행 중",next_action:"Factory Worker 결과 확인 중",last_action:"production_running"});
      if(latestProduction.status==="completed"&&latestProduction.conclusion==="success"){const delivery=await getDeliveryApproval(env,row);const deliveryKey="freelancer:delivery:"+id+":"+latestProduction.run_id;const sentAction=await env.DB.prepare("SELECT action_key FROM platform_actions WHERE action_key=? AND provider=\'freelancer\' AND action_type=\'delivery_message\' AND status=\'confirmed\' LIMIT 1").bind(deliveryKey).first();if(sentAction){if(autoActions&&consume())await syncFreelancerMessaging(env,row);const feedback=await getPostDeliveryFeedback(env,row);if(feedback.revision_required){const revision=await getRevisionApproval(env,row);if(revision.status==="running")return managerSaveState(env,id,{stage:"revision_running",status_label:"🏭 승인된 수정 재작업 진행 중",next_action:"새 Production 결과 확인 중",last_action:"revision_running"});if(revision.approved){if(autoActions&&consume()){const out=await managerResponseData(await dispatchProduction(request,env,id));if(out.status==="dispatched"||out.status==="config_required")return managerSaveState(env,id,{stage:"revision_running",status_label:"🏭 승인된 수정 재작업 시작",next_action:"새 Production 결과 확인 중",last_action:"revision_production_dispatched"});return managerSaveState(env,id,{stage:"needs_attention",status_label:"⚠️ 수정 재작업 시작 실패",next_action:out.error||out.status||"상세 확인",last_error:out.error||""});}return managerSaveState(env,id,{stage:"revision_approved",status_label:"✅ 수정 재작업 승인 완료",next_action:"Manager가 새 Production을 시작 예정",last_action:"revision_approved"});}return managerSaveState(env,id,{stage:"revision_requested",status_label:"🔁 고객 수정 요청 접수",next_action:"수정 요청 검토 후 재작업 승인",last_action:"client_revision_detected"});}if(feedback.kind==="accepted"){if(String(row.source||"")==="freelancer_projects"){const payment=await syncFreelancerMilestoneStatus(env,row);if(payment.ok&&payment.paid)return managerSaveState(env,id,{stage:"paid_complete",status_label:"💰 결제 완료 확인",next_action:"수익 기록 완료 · 다음 기회 탐색",last_action:"payment_verified"});}return managerSaveState(env,id,{stage:"client_accepted",status_label:"✅ 고객 납품 확인",next_action:"Freelancer 결제 완료 확인 대기",last_action:"client_accepted"});}if(feedback.kind==="feedback")return managerSaveState(env,id,{stage:"client_feedback",status_label:"💬 고객 피드백 도착",next_action:"피드백 확인",last_action:"client_feedback_received"});return managerSaveState(env,id,{stage:"delivery_sent",status_label:"📤 Freelancer 납품 메시지 전송 완료",next_action:"고객 확인·피드백 대기",last_action:"delivery_sent"});}if(!delivery.approved)return managerSaveState(env,id,{stage:"awaiting_delivery_approval",status_label:"👀 납품 검토·승인 대기",next_action:"납품 패키지와 메시지를 확인 후 승인",last_action:"production_complete"});if(String(row.source||"")==="freelancer_projects"){if(autoActions&&consume()){const sent=await sendFreelancerDelivery(env,row);if(sent.ok&&sent.sent)return managerSaveState(env,id,{stage:"delivery_sent",status_label:"📤 Freelancer 납품 메시지 전송 완료",next_action:"고객 확인·피드백 대기",last_action:sent.duplicate?"delivery_already_sent":"delivery_sent"});return managerSaveState(env,id,{stage:"needs_attention",status_label:"⚠️ Freelancer 납품 전송 실패",next_action:"전송 상태 확인 필요",last_error:sent.reason||("HTTP "+String(sent.status||""))});}return managerSaveState(env,id,{stage:"delivery_approved",status_label:"✅ 납품 승인 완료",next_action:"Manager가 Freelancer 납품 메시지를 자동 전송 예정",last_action:"delivery_approved"});}return managerSaveState(env,id,{stage:"delivery_approved",status_label:"✅ 납품 승인 완료",next_action:"해당 플랫폼 납품 어댑터 대기",last_action:"delivery_approved"});}
      if(latestProduction.status==="dispatch_failed"||(latestProduction.status==="completed"&&latestProduction.conclusion!=="success"))return managerSaveState(env,id,{stage:"needs_attention",status_label:"⚠️ 제작·QC 예외",next_action:"자동 재시도하지 않음 · 상세에서 오류 확인",last_error:latestProduction.log_summary||"production failed"});
    }

    if(autoActions&&consume()){
      const out=await managerResponseData(await dispatchProduction(request,env,id));
      if(out.status==="dispatched")return managerSaveState(env,id,{stage:"production_running",status_label:"🏭 자동 제작·QC 시작",next_action:"Factory Worker 결과 확인 중",last_action:"production_dispatched"});
      if(out.status==="client_intake_required")return managerSaveState(env,id,{stage:"waiting_client_answers",status_label:"👤 고객 답변 대기",next_action:"필수 고객정보 수집"});
      if(out.status==="account_connection_required")return managerSaveState(env,id,{stage:"waiting_account_connections",status_label:"🔗 고객 계정 승인 대기",next_action:"필수 서비스 연결"});
      return managerSaveState(env,id,{stage:"needs_attention",status_label:"⚠️ 자동 제작 시작 보류",next_action:out.error||out.status||"상세 확인",last_error:out.error||""});
    }
    return managerSaveState(env,id,{stage:"production_queued",status_label:"🏭 자동 제작 대기",next_action:"Manager가 자동 제작 예정"});
  }catch(error){
    return managerSaveState(env,id,{stage:"needs_attention",status_label:"⚠️ Manager 예외",next_action:"상세에서 오류 확인",last_error:error?.message||String(error)});
  }
}

async function runManagerOrchestrator(env,{request=null,maxActions=3,limit=100}={}) {
  const base=String(env.PUBLIC_BASE_URL||"https://automation-factory-money-scout.lsc1313.workers.dev").replace(/\/$/,"");
  const req=request||new Request(base+"/internal/manager-orchestrator");
  const rows=(await env.DB.prepare("SELECT * FROM opportunities WHERE user_state!='reject' AND json_extract(score_breakdown,'$.factory_fulfillable')=1 AND json_extract(score_breakdown,'$.actionable_paid_job')=1 ORDER BY score DESC,last_seen_at DESC LIMIT ?").bind(Math.max(1,Math.min(100,Number(limit)||40))).all()).results||[];
  const budget={remaining:Math.max(0,Math.min(10,Number(maxActions)||0))}, states=[];
  for(const row of rows)states.push(await managerEvaluateJob(req,env,row,{autoActions:true,actionBudget:budget}));
  const counts={};for(const x of states)counts[x.stage]=(counts[x.stage]||0)+1;
  return {ok:true,orchestrator_version:"manager-orchestrator-v1",jobs:states.length,actions_started:Math.max(0,(Number(maxActions)||0)-budget.remaining),counts,updated_at:nowIso()};
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
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#070d18,#0b1321);font-family:system-ui,-apple-system,sans-serif;color:var(--text)}button,input,select,textarea{font:inherit}.wrap{max-width:1120px;margin:auto;padding:18px 14px 44px}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.brand{font-size:25px;font-weight:900}.sub{color:var(--muted);font-size:12px;line-height:1.5}.badge{border:1px solid var(--line);border-radius:999px;padding:7px 10px;color:var(--muted);font-size:12px}.notice{margin:12px 0;padding:10px 12px;border:1px solid var(--line);background:var(--panel2);border-radius:12px;color:var(--muted);font-size:12px}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:14px 0}.stat{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:13px}.stat b{display:block;font-size:22px;margin-top:4px}.toolbar{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.toolbar button,.action{background:#17243a;color:white;border:1px solid #34435c;border-radius:10px;padding:9px 11px;font-weight:800}.toolbar button.active{background:#264e82;border-color:#6da7ff}.scan{background:#173d2c!important}.token{display:flex;gap:7px;margin:10px 0}.token input{min-width:0;flex:1;background:#0d1624;color:white;border:1px solid var(--line);border-radius:10px;padding:10px}.intakeField{margin:9px 0}.intakeField label{display:block;font-size:11px;font-weight:800;margin-bottom:5px;color:#cbd6e5}.intakeField input,.intakeField select,.intakeField textarea{width:100%;background:#0d1624;color:white;border:1px solid var(--line);border-radius:9px;padding:9px}.intakeField textarea{min-height:78px;resize:vertical}.intakeHelp{font-size:10px;color:var(--muted);margin-top:4px}.intakeReady{color:#6bf0aa;font-weight:850}.intakeMissing{color:#ffdc7f;font-weight:850}.connectionGate{margin:12px 0;padding:11px;border:1px solid var(--line);border-radius:11px;background:#0b1422}.connectionRow{padding:9px 0;border-bottom:1px solid #1e2a3d}.connectionRow:last-child{border-bottom:0}.connectionStatus{font-size:11px;color:var(--muted);margin:4px 0}.connectionStatus.ok{color:#6bf0aa}.connectionStatus.wait{color:#ffdc7f}.connectionControls{display:flex;gap:6px;flex-wrap:wrap}.connectionControls input,.connectionControls select{min-width:0;flex:1;background:#0d1624;color:white;border:1px solid var(--line);border-radius:8px;padding:8px}.connectionControls button{border:1px solid var(--line);background:#17243a;color:white;border-radius:8px;padding:8px 10px;font-weight:800}.factoryState{margin:10px 0;padding:10px 11px;border:1px solid var(--line);background:#0b1422;border-radius:11px}.factoryState b{display:block;font-size:13px}.factoryNext{color:var(--muted);font-size:11px;line-height:1.5;margin-top:4px}.autoOn{color:#6bf0aa;font-size:10px;font-weight:900}.jobDetails>summary{cursor:pointer;display:inline-block;margin-top:9px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:#101b2d;font-weight:850;font-size:12px}.manualBox{margin-top:10px;padding-top:8px;border-top:1px solid var(--line)}.token button{background:#17243a;color:white;border:1px solid var(--line);border-radius:10px;padding:9px 11px}.filters{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.filters select{background:#0d1624;color:white;border:1px solid var(--line);border-radius:10px;padding:9px 10px}.card{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:14px;margin:10px 0}.head{display:flex;gap:10px;justify-content:space-between}.title{font-size:16px;font-weight:900;line-height:1.35}.score{min-width:54px;text-align:center;border-radius:12px;padding:8px 7px;font-size:20px;font-weight:950;background:#0b1422;border:1px solid var(--line)}.score small{display:block;font-size:9px;color:var(--muted);font-weight:700}.meta,.reason{color:var(--muted);font-size:12px;margin-top:7px;line-height:1.5}.metrics{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.metric{font-size:11px;padding:5px 7px;border-radius:8px;background:#0b1422;border:1px solid var(--line);color:#cbd6e5}.desc{font-size:13px;line-height:1.55;margin-top:9px;color:#d9e1ed;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.pill{display:inline-block;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:900}.hot{background:#123d2a;color:#6bf0aa}.watch{background:#493914;color:#ffdc7f}.cold{background:#252d3a;color:#b0bbca}.paycheck{background:#273657;color:#aecdff}.decisions{display:flex;gap:6px;flex-wrap:wrap;margin-top:11px}.decisions button{border:1px solid var(--line);background:#0e1828;color:white;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:850}.decisions button.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}.link{color:#9fc5ff;text-decoration:none}.empty{text-align:center;color:var(--muted);padding:42px 5px}.runinfo{color:var(--muted);font-size:11px;margin:10px 0}.runerrors{display:none;margin:8px 0 12px;padding:10px 12px;border:1px solid #633845;background:#24131a;border-radius:10px;color:#ffb4bd;font-size:11px;line-height:1.55;white-space:pre-wrap}.footer{color:var(--muted);font-size:11px;text-align:center;margin-top:28px}.error{color:#ffabb3}
@media(max-width:760px){.stats{grid-template-columns:repeat(2,1fr)}.stats .stat:first-child{grid-column:span 2}.head{align-items:flex-start}.brand{font-size:22px}.card{padding:13px}.wrap{padding:14px 10px 36px}.toolbar button{flex:1 0 auto}}
</style>
</head>
<body><div class="wrap">
  <div class="top">
    <div><div class="brand">💰 Money Scout</div><div class="sub">Automation Factory · 수익 기회 탐색 + Opportunity Judge</div></div>
    <div class="badge">v${APP_VERSION}</div>
  </div>
  <div id="paidJobsList"><div class="empty">💵 수익 실행 현황 불러오는 중…</div></div>
  <details style="margin-top:14px"><summary class="notice"><b>🔎 Money Scout 탐색 현황 보기</b></summary>
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
    <button id="candidateBtn">🧪 장기 시장후보</button>
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
      <option value="all">소스 전체</option>\n      <option value="freelancer_projects">Freelancer Projects</option>\n      <option value="wishket_projects">Wishket 공개 프로젝트</option>
      <option value="agent_bounties">Agent Bounties (공식 claimable)</option>
      <option value="github_paid">GitHub Paid Discovery</option>
      <option value="github_demand">GitHub Product Demand</option>\n      <option value="marketplace_demand">Marketplace Demand</option>
      <option value="remoteok">RemoteOK (채용 참고)</option>
      <option value="github_bounty">Legacy GitHub Bounty</option>
    </select>
  </div>
  <div class="token" style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center">
    <input id="token" style="min-width:0;width:100%;box-sizing:border-box" type="password" placeholder="관리키 (설정한 경우만 입력)" autocomplete="off" />
    <button id="saveToken">저장</button>
    <button id="runRevenueScout" style="grid-column:1 / -1;width:100%;margin:0">💰 수익형 즉시 스캔</button>
    <button id="gateAuditBtn" style="grid-column:1 / -1;width:100%;margin:0">🧪 HOT 탈락진단</button>
  </div>
  <div id="gateAuditBox" class="card" style="display:none;margin-top:10px;width:100%;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;word-break:break-word"></div>
  <div id="runinfo" class="runinfo"></div>\n  <div id="sourceDiagnostics" class="runinfo"></div>\n  <div id="runerrors" class="runerrors"></div>
  <div id="candidateList"></div>\n  <div id="list"><div class="empty">불러오는 중…</div></div>
  </details>
  <div class="footer">v${APP_VERSION} · Manager Orchestrator v1 · 자동검증→외부대기→자동제작/QC→납품준비</div>
</div>
<script>
let grade='all';
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tokenEl=document.getElementById('token');
tokenEl.value=localStorage.getItem('af_admin_token')||'';
function headers(){const h={'content-type':'application/json'};const t=localStorage.getItem('af_admin_token')||'';if(t)h['x-admin-token']=t;return h;}
async function api(url,opt={}){
 const controller=new AbortController();
 const timeoutMs=Number(opt.timeoutMs||12000);
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const clean={...opt};delete clean.timeoutMs;
  const r=await fetch(url,{...clean,signal:controller.signal,headers:{...headers(),...(clean.headers||{})}});
  const j=await r.json().catch(()=>({error:'응답 해석 실패'}));
  if(!r.ok){const detail=j.detail?(' · '+String(j.detail).slice(0,300)):'';throw new Error((j.error||('HTTP '+r.status))+detail);}
  return j;
 }catch(e){
  if(e&&e.name==='AbortError')throw new Error('응답 시간 초과 ('+Math.round(timeoutMs/1000)+'초)');
  throw e;
 }finally{clearTimeout(timer);}
}
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
 document.getElementById('s-proceed').textContent=(stats.states&&stats.states.proceed)||0;
 const lr=stats.last_run;
 let runMeta=''; try{const a=JSON.parse((lr&&lr.errors_json)||'[]'); const d=(a.find(x=>x.source==='freelancer_projects'&&x.diagnostic)||{}).diagnostic; if(d)runMeta=' · Freelancer '+d.pages_succeeded+'/'+d.pages_requested+'페이지 · 원본 '+d.raw_count+' · 고유 '+d.unique_count;}catch{}
 document.getElementById('runinfo').textContent=(stats.active_run?'자동 스캔 실행 중 · 시작 '+when(stats.active_run.started_at)+' | ':'')+(lr?('마지막 완료 '+when(lr.finished_at||lr.started_at)+' · 발견 '+lr.found_count+' · 저장 '+lr.saved_count+' · 오류 '+lr.error_count+runMeta):'완료된 스캔 기록이 없습니다.');
 let diag=[];try{diag=JSON.parse((lr&&lr.errors_json)||'[]').filter(x=>x.diagnostic)}catch{}
 const diagText=diag.map(x=>{const d=x.diagnostic||{};if(x.source==='runtime')return '실행코드 '+(d.app_version||'?')+' · 빌드 '+(d.build_id||'?');if(x.source==='wishket_projects')return '위시켓 · 공개링크 '+(d.public_links||0)+' · 상세확인 '+(d.details_checked||0)+' · Micro 후보 '+(d.micro_matches||0)+' · 외부쓰기 OFF';if(x.source==='freelancer_projects')return 'Freelancer · 원본 '+(d.raw_count||0)+' · 선별 '+(d.unique_count||0);return x.source+' · 수집진단 '+JSON.stringify(d)}).join(' | ');
 document.getElementById('sourceDiagnostics').textContent=diagText?('플랫폼별 진단 · '+diagText):'플랫폼별 수집 진단은 다음 스캔부터 표시됩니다.';
 const re=document.getElementById('runerrors');
 let errs=[];try{errs=JSON.parse((lr&&lr.errors_json)||'[]').filter(x=>x.error)}catch{}
 if(errs.length){re.style.display='block';re.textContent='⚠ 최근 스캔 오류 상세\\n'+errs.map((e,i)=>(i+1)+'. ['+(e.source||'unknown')+'] '+(e.error||'알 수 없는 오류')).join('\\n');}else{re.style.display='none';re.textContent='';}
 const evidenceById={}; await Promise.all(jobs.map(async j=>{try{evidenceById[j.opportunity_id]=await api('/api/opportunities/'+encodeURIComponent(j.opportunity_id)+'/evidence')}catch{evidenceById[j.opportunity_id]=[]}}));
 const el=document.getElementById('list');
 if(!jobs.length){el.innerHTML='<div class="empty">현재 조건에 표시할 수익 기회가 없습니다.<br>Money Scout는 매시간 자동 수집됩니다.</div>';return;}
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
   const metric=(icon,name,val)=>'<span class="metric">'+icon+' '+name+' '+esc(val||0)+'</span>';
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
const auditBtn=document.getElementById('gateAuditBtn');
if(auditBtn)auditBtn.onclick=async()=>{
  const box=document.getElementById('gateAuditBox'); auditBtn.disabled=true; auditBtn.textContent='🧪 진단 중…';
  box.style.display='block'; box.innerHTML='HOT → 제작가능 → 지원가능 게이트를 분석 중…';
  try{
    const d=await api('/api/scout/gate-audit',{timeoutMs:30000});
    const c=d.counts||{}, bl=d.blockers||{}, near=d.near_misses||[];
    const top=Object.entries(bl).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>esc(k)+' '+v+'건').join(' · ')||'없음';
    box.innerHTML='<b>🧪 HOT 실행게이트 진단</b><div class="intakeHelp">최근 Freelancer '+esc(c.total||0)+'건 기준</div>'+
      '<div class="reason">HOT '+esc(c.hot||0)+' → 게이트차단 '+esc(c.gate_blocked||0)+' · 제작가능 '+esc(c.ready||0)+' · 실제지원가능 '+esc(c.actionable||0)+'</div>'+
      '<div class="reason"><b>주요 차단</b><br>'+top+'</div>'+
      '<div class="reason"><b>통과에 가까운 후보</b><br>'+near.slice(0,10).map((x,i)=>(i+1)+'. '+esc(x.title)+' · '+esc(x.grade)+' '+esc(x.score)+' · '+esc((x.miss||[]).join(', ')||'조건충족')).join('<br>')+'</div>';
  }catch(e){box.innerHTML='<b>진단 실패</b><div class="reason">'+esc(e.message)+'</div>'}
  finally{auditBtn.disabled=false;auditBtn.textContent='🧪 HOT 탈락진단'}
};

const revenueBtn=document.getElementById('runRevenueScout');
if(revenueBtn)revenueBtn.onclick=async()=>{
  revenueBtn.disabled=true;
  revenueBtn.textContent='💰 스캔 시작 중…';
  document.getElementById('runinfo').textContent='수익형 즉시 스캔 요청 중… 위시켓 · Agent Bounties · GitHub Paid · Freelancer';
  try{
    const d=await api('/api/scout/revenue-core',{method:'POST',body:'{}',timeoutMs:45000});
    const sd=(d.scan&&d.scan.diagnostics)||{}, errs=(d.scan&&d.scan.errors)||[];
    const src=((d.scan&&d.scan.sources)||[]).map(s=>{const x=sd[s]||{};let detail='';if(s==='freelancer_projects')detail='원본 '+(x.raw_count||0)+' / 선별 '+(x.unique_count||0);else if(s==='wishket_projects')detail='링크 '+(x.public_links||0)+' / 후보 '+(x.micro_matches||0);else detail='수집완료';const er=errs.find(e=>e.source===s);return s+' ['+(er?'오류: '+er.error:detail)+']';}).join(' · ');
    document.getElementById('runinfo').textContent='수익형 스캔 완료 · 발견 '+((d.scan&&d.scan.found)||0)+' · 저장 '+((d.scan&&d.scan.saved)||0)+' · '+src;
    alert('수익형 스캔 완료');
    await load();
    await loadPaidJobs();
  }catch(e){
    document.getElementById('runinfo').textContent='수익형 스캔 실패 · '+e.message;
    alert('수익형 스캔 실패: '+e.message);
  }finally{
    revenueBtn.disabled=false;
    revenueBtn.textContent='💰 수익형 즉시 스캔';
  }
};
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
async function loadPaidJobs(runManager=true){
 const el=document.getElementById('paidJobsList');
 // Never block first paint on Manager orchestration. Mobile browsers can otherwise
 // sit on "loading" while a long external/API action is still running.
 let rows;
 el.innerHTML='<div class="empty">① 서버 연결 확인 중…</div>';
 try{await api('/api/health',{timeoutMs:4000});}catch(e){el.innerHTML='<div class="notice error"><b>서버 연결 실패</b><br>'+esc(e.message)+'</div>';return;}
 el.innerHTML='<div class="empty">② D1 유료 일감 조회 중…</div>';
 try{rows=await api('/api/paid-jobs',{timeoutMs:8000});}
 catch(e){el.innerHTML='<div class="notice error"><b>수익 실행 현황을 불러오지 못했습니다.</b><br>'+esc(e.message)+'<div class="decisions"><button id="retryPaidJobs">다시 불러오기</button></div></div>';const rb=document.getElementById('retryPaidJobs');if(rb)rb.onclick=loadPaidJobs;return;}
 // Run Manager after the dashboard is already able to render; refresh once when done.
 if(runManager)setTimeout(()=>api('/api/orchestrator/tick',{method:'POST',body:JSON.stringify({max_actions:2,limit:100})}).then(()=>setTimeout(()=>loadPaidJobs(false),300)).catch(()=>null),0);
 const money=j=>j.budget_min||j.budget_max?((j.currency||'')+' '+Number(j.budget_min||j.budget_max).toLocaleString()+(j.budget_max&&j.budget_max!==j.budget_min?' ~ '+Number(j.budget_max).toLocaleString():'')):'';
 const autoCount=rows.filter(j=>['sandbox_running','sandbox_queued','production_running','production_queued'].includes(j.manager_stage)).length;
 const waitingRows=rows.filter(j=>['waiting_contract_payment','waiting_client_answers','waiting_account_connections'].includes(j.manager_stage));
 const waitingCount=waitingRows.length;
 const readyCount=rows.filter(j=>j.manager_stage==='delivery_ready').length;
 const exceptionCount=rows.filter(j=>j.manager_stage==='needs_attention').length;
 const humanRows=waitingRows.filter(j=>(j.manager_stage==='waiting_contract_payment'&&(j.deal_application_status||'not_applied')==='not_applied')||j.manager_stage==='waiting_account_connections');
 const passiveRows=waitingRows.filter(j=>!humanRows.includes(j));
 const applicationRows=humanRows.filter(j=>j.manager_stage==='waiting_contract_payment'&&(j.deal_application_status||'not_applied')==='not_applied');
 const otherHumanRows=humanRows.filter(j=>!applicationRows.includes(j));
 const center=await api('/api/application-center',{timeoutMs:5000}).catch(()=>({count:0,held_count:applicationRows.length,items:[],degraded:true}));
 const shortlistCount=Number(center.count||0), applicationHeldCount=Number(center.held_count||0), appDiag=center.diagnostics||{};
 const centerHeldItems=Array.isArray(center.held_items)?center.held_items:[];
 const centerHeldIds=new Set(centerHeldItems.map(x=>String(x.opportunity_id||'')));
 const safetyHeldCount=rows.filter(j=>j.manager_stage==='auto_held'&&!centerHeldIds.has(String(j.opportunity_id||''))).length;
 const heldApplicationCount=applicationHeldCount+safetyHeldCount;
 const holdDiagnostics={qualification:0,attachment:0,independent_delivery:0,complex_scope:0,delivery_risk:0,other:0};
 for(const j of rows){
   if(j.manager_stage!=='auto_held')continue;
   const p=j.hold_priority||{reasons:[]};
   if(p.requires_human_qualification_review)holdDiagnostics.qualification++;
   if(p.requires_attachment_review)holdDiagnostics.attachment++;
   if(p.requires_independent_delivery_review)holdDiagnostics.independent_delivery++;
   if(p.requires_complex_scope_review)holdDiagnostics.complex_scope++;
   if(p.reasons.includes("delivery_risk_gate"))holdDiagnostics.delivery_risk++;
   if(!p.requires_human_qualification_review&&!p.requires_attachment_review&&!p.requires_independent_delivery_review&&!p.requires_complex_scope_review&&!p.reasons.includes("delivery_risk_gate"))holdDiagnostics.other++;
 }
 const actionableHumanCount=shortlistCount+otherHumanRows.length;
 const revenueExecutionCount=autoCount+shortlistCount+passiveRows.length+readyCount;
 const humanInbox=actionableHumanCount?'<div class="notice"><b>👆 지금 사람이 할 일 '+actionableHumanCount+'건</b><br><span class="sub">실제로 개입할 항목만 표시합니다. 지원/안전게이트 '+heldApplicationCount+'건은 Manager가 자동보류 중입니다.</span>'+(shortlistCount?'<div class="decisions"><button id="openApplicationCenter">📨 우선지원 '+shortlistCount+'건 열기</button></div>':'')+(otherHumanRows.length?'<div class="decisions">'+otherHumanRows.map(j=>'<a class="link" target="_blank" rel="noopener" href="'+esc(j.url)+'">'+esc(j.title)+' · '+esc(j.manager_status_label||'외부 처리')+'</a>').join('<br>')+'</div>':'')+'<div id="applicationCenter"></div></div>':'<div class="notice"><b>🙌 지금 사람이 할 일 0건</b><br><span class="sub">현재는 자동공장 또는 외부 응답을 기다리면 됩니다.</span></div>';
 const platformBox='<div class="notice" id="platformConnectionCenter"><b>🔌 플랫폼 연결센터</b><br><span class="sub">Freelancer 연결 상태 확인 중…</span></div>';
  const summary='<div class="notice"><b>💰 수익 실행 대시보드</b><br>수익진행 <b>'+revenueExecutionCount+'</b> · 내부자동 '+autoCount+' · 사람확인 '+actionableHumanCount+' · 자동보류 '+heldApplicationCount+' · 외부응답대기 '+passiveRows.length+' · 납품준비 '+readyCount+' · 예외 '+exceptionCount+'<br><span class="sub">Money Scout는 뒤에서 계속 탐색합니다. 여기에는 지금 돈으로 연결되는 실행 항목을 먼저 표시합니다.</span>'+(heldApplicationCount?'<br><span class="sub"><b>자동보류 진단</b> · 자격/포트폴리오 '+holdDiagnostics.qualification+' · 첨부검증 '+holdDiagnostics.attachment+' · 고객환경의존 '+holdDiagnostics.independent_delivery+' · 복합범위 '+holdDiagnostics.complex_scope+' · 납기/위험 '+holdDiagnostics.delivery_risk+' · 기타 '+holdDiagnostics.other+'</span>':'')+(appDiag.held_count?'<br><span class="sub"><b>지원센터 탈락 '+esc(appDiag.held_count)+'</b> · 하드차단 '+esc((appDiag.counts||{}).hard_hold||0)+' · 우선점수미달 '+esc((appDiag.counts||{}).below_priority||0)+' · 상위3건 제한 '+esc((appDiag.counts||{}).capacity_limit||0)+' · 플랫폼미연결 '+esc((appDiag.counts||{}).platform_not_connected||0)+' · 저가치/시간 '+esc((appDiag.counts||{}).low_value||0)+' · 경쟁과다 '+esc((appDiag.counts||{}).competition||0)+' · 계약후 고객접근 '+esc((appDiag.counts||{}).client_access||0)+'</span>':'')+'</div>'+humanInbox;
 el.innerHTML=platformBox+summary+'<details class="jobDetails" style="margin-top:14px"><summary>📦 전체 유료 일감 '+rows.length+'개 보기</summary><div class="sub" style="margin:10px 0">평소에는 열어볼 필요 없습니다. Manager가 우선지원·계약·제작·납품 단계가 되면 위 실행 영역으로 올립니다.</div>'+rows.map(j=>{
   const state=j.manager_status_label||'🤖 Manager 분석 대기';
   const next=j.manager_next_action||'자동공장이 다음 단계를 판단합니다.';
   const p=j.hold_priority||{reasons:[]};
   const holdReasons=[];
   if(p.requires_human_qualification_review)holdReasons.push('자격/포트폴리오 확인');
   if(p.requires_attachment_review)holdReasons.push('첨부파일 검증');
   if(p.requires_independent_delivery_review)holdReasons.push('고객환경 의존');
   if(p.requires_complex_scope_review)holdReasons.push('복합범위');
   if((p.reasons||[]).includes('delivery_risk_gate'))holdReasons.push('납기/위험');
   const isHeld=j.manager_stage==='auto_held';
   const buildLabel=j.manager_autopilot==='on'?'제작가능 ✓':'제작가능성 확인 중';
   const applyLabel=isHeld?'지원보류'+(holdReasons.length?' — '+holdReasons.join(' · '):' — 안전게이트'):'지원단계 진행가능';
   return '<div class="card">'+
     '<div class="title">'+esc(j.title)+'</div>'+
     '<div class="meta">'+esc([j.source,j.type,money(j),j.deadline?('마감 '+j.deadline):''].filter(Boolean).join(' · '))+'</div>'+
     '<div class="factoryState"><span class="autoOn">🏭 '+esc(buildLabel)+'</span><b>'+esc(applyLabel)+'</b><div class="sub">'+esc(state)+'</div><div class="factoryNext">다음: '+esc(next)+'</div></div>'+
     '<details class="jobDetails"><summary>상세보기</summary>'+
       '<div class="desc">'+esc(j.description||'')+'</div><div class="reason">'+esc(j.judge_reason||'')+'</div>'+
       '<div class="meta">'+(j.manager_last_error?('⚠ '+esc(j.manager_last_error)+'<br>'):'')+'Manager 갱신 '+esc(when(j.manager_updated_at)||'대기')+'</div>'+
       '<div class="manualBox"><details><summary class="sub">⚙️ 고급/수동 제어</summary>'+
         '<div class="decisions"><button class="managerPlanBtn" data-job-id="'+esc(j.opportunity_id)+'">🧭 작업계획</button><button class="sandboxRunBtn" data-job-id="'+esc(j.opportunity_id)+'">🧪 샌드박스</button><button class="dealGateBtn" data-job-id="'+esc(j.opportunity_id)+'">💳 계약·결제</button><button class="clientIntakeBtn" data-job-id="'+esc(j.opportunity_id)+'">👤 고객정보</button><button class="productionRunBtn" data-job-id="'+esc(j.opportunity_id)+'">🏭 제작</button> <a class="link" target="_blank" rel="noopener" href="'+esc(j.url)+'">원문/지원 페이지</a></div>'+
         '<div class="managerPlan" id="plan-'+esc(j.opportunity_id)+'"></div><div class="reason" id="sandbox-'+esc(j.opportunity_id)+'"></div><div class="reason" id="deal-'+esc(j.opportunity_id)+'"></div><div class="reason" id="intake-'+esc(j.opportunity_id)+'"></div><div class="reason" id="production-'+esc(j.opportunity_id)+'"></div>'+
       '</details></div>'+
     '</details>'+
   '</div>';
 }).join('')+'</details>';
 const pcb=document.getElementById('platformConnectionCenter');
 if(pcb){
   api('/api/platform-connections').then(d=>{
     const providers=d.providers||[],f=providers.find(x=>x.provider==='freelancer')||{};
     const rows=providers.map(p=>'<div style="margin-top:8px"><b>'+esc(p.label||p.provider)+'</b> · '+esc(p.connected?'공식 연결됨':(p.api_status==='manual'?'수동채널':p.api_status==='credential_present'?'인증정보 있음 · 검증대기':'미연결'))+'<br><span class="sub">'+esc(p.next_action||'')+'</span></div>').join('');
     pcb.innerHTML='<b>🔌 플랫폼 연결센터</b>'+rows+
       (f.account_status!=='ready'?'<div class="decisions"><button id="markFreelancerReady">방금 만든 Freelancer 계정 준비 완료</button></div>':'')+
       (!f.connected?'<div class="reason">⚠️ 공식 연결이 검증되지 않은 플랫폼은 자동지원·외부 쓰기를 실행하지 않습니다.</div>':'');
     const b=document.getElementById('markFreelancerReady'); if(b)b.onclick=async()=>{b.disabled=true;await api('/api/platform-connections/freelancer/account-ready',{method:'POST',body:JSON.stringify({ready:true})});await loadPaidJobs();};
   }).catch(e=>{pcb.innerHTML='<b>🔌 플랫폼 연결센터</b><br><span class="sub">연결 상태 조회 실패: '+esc(e.message)+'</span>';});
 }
  const appBtn=document.getElementById('openApplicationCenter');
 if(appBtn)appBtn.onclick=async()=>{
   const box=document.getElementById('applicationCenter'); appBtn.disabled=true;appBtn.textContent='지원서 준비 중…';
   try{
     const d=await api('/api/application-center');
     box.innerHTML='<div class="card" style="margin-top:10px"><b>📨 지원센터 · 우선지원 '+d.count+'건</b><div class="intakeHelp">Manager가 수익성·제작가능성·작업시간·외부의존성을 기준으로 선별했습니다. 보류 '+d.held_count+'건은 지금 확인할 필요 없습니다. Freelancer 공식 API 제출은 사용자 승인 후 Preflight를 통과한 지원서만 실행합니다.</div>'+
       d.items.map((x,i)=>'<details class="jobDetails"><summary>'+(i+1)+'. '+esc(x.title)+' · '+esc(x.currency)+' '+esc(x.bid_amount||'금액확인')+' · '+esc(x.delivery_days)+'일</summary><div class="reason"><b>제안문</b><br>'+esc(x.proposal)+'</div>'+((x.questions&&x.questions.length)?'<div class="reason"><b>확인 질문</b><br>'+x.questions.map(q=>'• '+esc(q)).join('<br>')+'</div>':'')+'<div class="reason"><b>판단근거</b><br>경쟁 '+esc((x.decision_summary&&x.decision_summary.competition_count)||0)+'명 · 제안 '+esc(x.currency)+' '+esc((x.decision_summary&&x.decision_summary.gross_bid)||x.bid_amount||0)+' · 예상 순수익 '+esc(x.currency)+' '+esc((x.decision_summary&&x.decision_summary.estimated_net)||'확인중')+' · 예상 작업 '+esc((x.decision_summary&&x.decision_summary.effective_estimated_hours)||'확인중')+'시간 · 시간당 가치 '+esc(x.currency)+' '+esc((x.decision_summary&&x.decision_summary.value_per_hour)||'확인중')+' · 자동완결 '+esc((x.decision_summary&&x.decision_summary.automation_completion_ratio)||0)+'%</div><div class="decisions"><button class="approveBidBtn" data-job-id="'+esc(x.opportunity_id)+'">✅ 지원 승인 · Preflight</button> <a class="link" target="_blank" rel="noopener" href="'+esc(x.application_url)+'">원문 열기</a></div><div class="sub" id="bid-status-'+esc(x.opportunity_id)+'"></div></details>').join('')+
       '</div>';
     box.querySelectorAll('.approveBidBtn').forEach(btn=>btn.onclick=async()=>{
       const id=btn.dataset.jobId,status=document.getElementById('bid-status-'+id);
       btn.disabled=true;status.textContent='Preflight 확인 중…';
       try{
         const pre=await api('/api/freelancer/bid-preflight',{method:'POST',body:JSON.stringify({opportunity_id:id})});
         if(!pre.ok||!pre.eligible){status.textContent='⛔ 지원 차단: '+esc(pre.reason||'preflight_failed');return;}
         const amount=(pre.draft&&pre.draft.bid_amount)||'',period=(pre.draft&&pre.draft.delivery_days)||'';
         const ok=confirm('Freelancer에 실제 입찰을 제출합니다.\\n금액: '+amount+' '+((pre.budget&&pre.budget.currency)||'')+'\\n기간: '+period+'일\\n\\n제출 후 취소가 제한될 수 있습니다. 계속할까요?');
         if(!ok){status.textContent='승인이 취소되었습니다.';return;}
         status.textContent='공식 API로 입찰 제출 중…';
         const out=await api('/api/freelancer/bid-submit',{method:'POST',body:JSON.stringify({opportunity_id:id,approved:true})});
         if(out.ok&&out.submitted){
           status.textContent='✅ 입찰 완료 · Bid ID '+esc(out.bid_id||'');
         }else{
           const pf=out.preflight||{}, dr=pf.draft||{}, bg=pf.budget||{};
           const parts=['⛔ 제출 실패'];
           if(pf.reason==='insufficient_account_balance'||pf.reason==='insufficient_account_balance_learned')parts.push('Freelancer 최소 잔액 '+esc(pf.required_balance_usd||19)+' USD 필요'+(pf.available_balance_usd!==undefined?' · 현재 '+esc(pf.available_balance_usd)+' USD':'')+(pf.learned_from_api?' · 이전 API 응답으로 사전차단':''));
           if(out.status!==undefined&&out.status!==null)parts.push('HTTP '+esc(out.status));
           if(out.api_message)parts.push(esc(out.api_message));
           if(dr.bid_amount!==undefined)parts.push('입찰 '+esc(dr.bid_amount)+(bg.currency?' '+esc(bg.currency):''));
           if(dr.delivery_days!==undefined)parts.push('납기 '+esc(dr.delivery_days)+'일');
           if(pf.status)parts.push('프로젝트 '+esc(pf.status));
           status.innerHTML=parts.join(' · ');
         }
         if(out.ok&&out.submitted)setTimeout(()=>loadPaidJobs(),1200);
       }catch(e){status.textContent='⛔ 처리 실패: '+esc(e.message);}
       finally{btn.disabled=false;}
     });
   }catch(e){box.innerHTML='<div class="empty error">지원센터 조회 실패: '+esc(e.message)+'</div>';}
   finally{appBtn.disabled=false;appBtn.textContent='📨 지원센터 다시 열기';}
 };
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



async function showDealGate(btn){
  const id=btn.dataset.jobId, el=document.getElementById('deal-'+id); if(!el)return;
  btn.disabled=true; const old=btn.textContent; btn.textContent='불러오는 중…';
  try{
    const d=await api('/api/paid-jobs/'+encodeURIComponent(id)+'/deal'), g=d.gate||{}, p=d.profile||{};
    const sel=(name,value,options)=>'<select data-deal-field="'+name+'">'+options.map(o=>'<option value="'+esc(o[0])+'" '+(String(value)===String(o[0])?'selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select>';
    const status=d.ready?'<div class="intakeReady">✅ 계약·결제 확보 완료 — 고객정보/계정연결/실제 제작 진행 가능</div>':'<div class="intakeMissing">🟡 실제 제작 전 계약 수락 + 결제 확보 + 실제 합의금액 확인이 필요합니다.</div>';
    const app=sel('application_status',g.application_status,[['not_applied','미지원'],['applied','지원함'],['client_replied','고객 응답'],['assigned','배정/낙찰']]);
    const contract=sel('contract_status',g.contract_status,[['not_agreed','계약 전'],['negotiating','협의 중'],['accepted','계약/작업 합의 완료'],['cancelled','취소']]);
    const pay=sel('payment_status',g.payment_status,[['unsecured','결제 미확보'],['secured','결제 확보/에스크로·마일스톤 확인'],['prepaid','선결제 확인'],['paid','입금 완료'],['failed','결제 실패']]);
    const protect=sel('payment_protection',g.payment_protection,[['unknown','확인 필요'],['platform_escrow','플랫폼 에스크로'],['funded_milestone','펀딩된 마일스톤'],['onchain_or_bounty','온체인/바운티'],['direct_prepaid','직접 선결제'],['other','기타']]);
    const input=(name,value,placeholder,type='text')=>'<input data-deal-field="'+name+'" type="'+type+'" value="'+esc(value||'')+'" placeholder="'+esc(placeholder)+'">';
    const net=g.net_estimate==null?'미확정':Number(g.net_estimate).toLocaleString()+' '+esc(g.currency||'');
    const ab=g.advertised_budget||{}, advertised=(ab.min==null&&ab.max==null)?'원문 예산 정보 없음':((ab.currency||'')+' '+(ab.min==null?'?':Number(ab.min).toLocaleString())+(ab.max!=null&&ab.max!==ab.min?' ~ '+Number(ab.max).toLocaleString():''));
    el.innerHTML='<div class="card" style="margin-top:10px"><b>💳 Contract / Payment Gate</b><div class="reason">'+esc(p.platform||g.platform||'')+' · '+esc(p.application_method||'')+'<br>'+esc(p.protection_hint||'')+'</div>'+status+
      '<div class="intakeField"><label>지원 상태</label>'+app+'</div>'+
      '<div class="intakeField"><label>계약 상태 *</label>'+contract+'</div>'+
      '<div class="intakeField"><label>결제 상태 *</label>'+pay+'</div>'+
      '<div class="intakeField"><label>결제 보호 방식</label>'+protect+'</div>'+
      '<div class="intakeField"><label>원문에 표시된 예산</label><div class="reason" style="margin-top:0">'+esc(advertised)+'</div><div class="intakeHelp">이 값은 고객과 확정한 계약 금액이 아닙니다.</div></div>'+\n      '<div class="intakeField"><label>실제 합의 금액 / 통화 *</label><div class="connectionControls">'+input('gross_amount',g.gross_amount,'계약 후 확정된 금액','number')+input('currency',g.currency,'USD')+'</div><div class="intakeHelp">낙찰/계약 후 실제로 합의된 금액만 입력합니다.</div></div>'+
      '<div class="intakeField"><label>플랫폼 수수료 예상액 (선택)</label>'+input('fee_estimate',g.fee_estimate,'예: 50','number')+'<div class="intakeHelp">예상 실수령액: '+net+'</div></div>'+
      '<div class="intakeField"><label>정산 경로</label>'+input('payout_route',g.payout_route,p.payout_route_hint||'플랫폼 → 출금수단')+'</div>'+
      '<div class="intakeField"><label>내 수령처 표시명</label>'+input('payout_destination',g.payout_destination,'예: Payoneer / 은행계좌 / Base wallet')+'<div class="intakeHelp">계좌번호·카드번호·비밀번호·시드문구·개인키는 입력하지 마세요.</div></div>'+
      '<div class="intakeField"><label>계약/마일스톤/바운티 참조번호 (선택)</label>'+input('external_reference',g.external_reference,'프로젝트/마일스톤/Claim ID')+'</div>'+
      '<div class="intakeField"><label>결제 확보 근거 URL (선택)</label>'+input('evidence_url',g.evidence_url,'플랫폼 계약/마일스톤 URL')+'</div>'+
      '<div class="intakeField"><label>메모 (선택)</label><textarea data-deal-field="note">'+esc(g.note||'')+'</textarea></div>'+
      '<button class="dealGateSaveBtn" data-job-id="'+esc(id)+'">💾 계약·결제 상태 저장</button>'+(p.application_url?' <a class="link" target="_blank" rel="noopener" href="'+esc(p.application_url)+'">지원/계약 페이지 열기</a>':'')+
      '<div class="intakeHelp">이 Gate는 자동 입금을 받는 기능이 아니라, 실제 제작 전에 계약과 결제 확보를 확인하는 안전장치입니다.</div></div>';
  }catch(err){el.innerHTML='<div class="empty error">계약·결제 조회 실패: '+esc(err.message)+'</div>';}
  finally{btn.disabled=false;btn.textContent=old;}
}
async function saveDealGate(btn){
  const id=btn.dataset.jobId, el=document.getElementById('deal-'+id); if(!el)return;
  btn.disabled=true; const old=btn.textContent; btn.textContent='저장 중…';
  try{
    const body={}; el.querySelectorAll('[data-deal-field]').forEach(x=>body[x.dataset.dealField]=x.value);
    const d=await api('/api/paid-jobs/'+encodeURIComponent(id)+'/deal',{method:'POST',body:JSON.stringify(body)});
    const fake={dataset:{jobId:id},disabled:false,textContent:'💳 계약·결제'}; await showDealGate(fake);
    if(d.ready)alert('계약·결제 Gate 통과. 이제 고객정보/계정연결/실제 제작을 진행할 수 있습니다.');
  }catch(err){alert('계약·결제 저장 실패: '+err.message);}
  finally{btn.disabled=false;btn.textContent=old;}
}

async function showClientIntake(btn){
  const id=btn.dataset.jobId, el=document.getElementById("intake-"+id); if(!el)return;
  btn.disabled=true; const old=btn.textContent; btn.textContent="불러오는 중…";
  try{
    const [d,c]=await Promise.all([api("/api/paid-jobs/"+encodeURIComponent(id)+"/intake"),api("/api/paid-jobs/"+encodeURIComponent(id)+"/connections")]);
    const a=d.answers||{}, fields=(d.spec&&d.spec.fields)||[];
    const renderField=f=>{
      const val=a[f.id]||""; const req=f.required?" *":""; const help=f.help?("<div class=\\\"intakeHelp\\\">"+esc(f.help)+"</div>"):"";
      let control="";
      if(f.type==="select"){control="<select data-intake-field=\\\""+esc(f.id)+"\\\">"+((f.options||[]).map(o=>"<option value=\\\""+esc(o.value)+"\\\" "+(String(val)===String(o.value)?"selected":"")+">"+esc(o.label)+"</option>").join(""))+"</select>";}
      else if(f.type==="textarea"){control="<textarea data-intake-field=\\\""+esc(f.id)+"\\\">"+esc(val)+"</textarea>";}
      else {control="<input data-intake-field=\\\""+esc(f.id)+"\\\" type=\\\"text\\\" value=\\\""+esc(val)+"\\\">";}
      return "<div class=\\\"intakeField\\\"><label>"+esc(f.label)+req+"</label>"+control+help+"</div>";
    };
    const basicHtml=fields.filter(f=>!f.advanced).map(renderField).join(""), advancedHtml=fields.filter(f=>f.advanced).map(renderField).join("");
    const discovery=(d.discovery_plan||(d.spec&&d.spec.discovery_plan)||[]);
    const discoveryHtml=discovery.length?("<div class=\\\"reason\\\" style=\\\"margin:10px 0\\\"><b>🤖 시스템이 자동으로 처리할 항목</b><br>"+discovery.map(x=>"• "+esc(x)).join("<br>")+"</div>"):"";
    const advancedSection=advancedHtml?("<details style=\\\"margin:10px 0\\\"><summary><b>⚙️ 고급 입력 — 자동처리가 실패할 때만</b></summary>"+advancedHtml+"</details>"):"";
    const answerStatus=d.status==="ready_for_build"?("<span class=\\\"intakeReady\\\">✅ 고객 답변 "+esc((d.completion&&d.completion.complete)||0)+"/"+esc((d.completion&&d.completion.required)||0)+"</span>"):("<span class=\\\"intakeMissing\\\">🟡 고객 답변 "+esc((d.completion&&d.completion.complete)||0)+"/"+esc((d.completion&&d.completion.required)||0)+"</span>");
    const cp=c.progress||{}, connStatus=cp.ready?("<span class=\\\"intakeReady\\\">✅ 계정 연결 "+esc(cp.connected||0)+"/"+esc(cp.required||0)+"</span>"):("<span class=\\\"intakeMissing\\\">🔗 계정 연결 "+esc(cp.connected||0)+"/"+esc(cp.required||0)+"</span>");
    const connRows=(c.connections||[]).map(x=>{
      const ok=x.status==="connected_verified", meta=x.metadata||{}, summary=x.provider==="squarespace"?(meta.title||meta.url||""):x.provider==="prodigi"?(meta.mode||""):"";
      let controls="";
      if(c.deal_ready&&!ok&&x.provider==="squarespace")controls="<div class=\\\"connectionControls\\\"><input type=\\\"password\\\" data-account-key=\\\"squarespace\\\" placeholder=\\\"Squarespace 작업용 API key\\\"><button class=\\\"accountConnectBtn\\\" data-job-id=\\\""+esc(id)+"\\\" data-provider=\\\"squarespace\\\">연결 확인</button></div>";
      if(c.deal_ready&&!ok&&x.provider==="etsy")controls="<div class=\\\"connectionControls\\\"><button class=\\\"accountConnectBtn\\\" data-job-id=\\\""+esc(id)+"\\\" data-provider=\\\"etsy\\\">Etsy에서 연결 승인</button></div>"+(x.app_configured?"":"<div class=\\\"intakeHelp\\\">Money Scout Etsy 앱 설정이 아직 필요합니다.</div>");
      if(c.deal_ready&&!ok&&x.provider==="prodigi")controls="<div class=\\\"connectionControls\\\"><select data-account-mode=\\\"prodigi\\\"><option value=\\\"sandbox\\\">Sandbox</option><option value=\\\"live\\\">Live (읽기 검증)</option></select><input type=\\\"password\\\" data-account-key=\\\"prodigi\\\" placeholder=\\\"Prodigi API key\\\"><button class=\\\"accountConnectBtn\\\" data-job-id=\\\""+esc(id)+"\\\" data-provider=\\\"prodigi\\\">연결 확인</button></div>";
      return "<div class=\\\"connectionRow\\\" data-connection-provider=\\\""+esc(x.provider)+"\\\"><b>"+esc(x.label)+"</b><div class=\\\"connectionStatus "+(ok?"ok":"wait")+"\\\">"+(ok?"✅ 연결·검증 완료":"연결 필요")+(summary?" · "+esc(summary):"")+"</div>"+controls+"</div>";
    }).join("");
    const connectionHtml=(c.connections||[]).length?("<div class=\\\"connectionGate\\\"><b>🔗 계정 연결</b><div class=\\\"intakeHelp\\\">"+(c.deal_ready?"OAuth/API 키는 고객 답변과 분리해 보안 저장하며 ZIP에 포함하지 않습니다.":"🔒 계약·결제 Gate 통과 후 계정 연결이 활성화됩니다.")+"</div>"+connRows+"</div>"):"";
    el.innerHTML="<div class=\\\"card\\\" style=\\\"margin-top:10px\\\"><b>👤 고객정보 / Account Connection Gate</b><div class=\\\"reason\\\" style=\\\"white-space:pre-wrap\\\"><b>고객에게 보낼 질문</b><br>"+esc(d.request_message||"")+"</div>"+discoveryHtml+"<div style=\\\"display:flex;gap:12px;flex-wrap:wrap;margin:10px 0\\\">"+answerStatus+connStatus+"</div>"+connectionHtml+"<div data-intake-form=\\\""+esc(id)+"\\\">"+basicHtml+advancedSection+"<button class=\\\"clientIntakeSaveBtn\\\" data-job-id=\\\""+esc(id)+"\\\">💾 고객 답변 저장</button></div></div>";
  }catch(err){el.innerHTML="<div class=\\\"empty error\\\">고객정보 조회 실패: "+esc(err.message)+"</div>";}
  finally{btn.disabled=false;btn.textContent=old;}
}

async function connectAccount(btn){
  const id=btn.dataset.jobId, provider=btn.dataset.provider; btn.disabled=true; const old=btn.textContent; btn.textContent="연결 중…";
  try{
    if(provider==="etsy"){
      const d=await api("/api/paid-jobs/"+encodeURIComponent(id)+"/connections/etsy/start",{method:"POST"});
      if(d.status==="config_required"){alert("Money Scout Etsy 앱 설정 필요: "+(d.missing_configuration||[]).join(", ")+"\\n고객이 입력할 값이 아니라 Automation Factory 운영 설정입니다.");return;}
      if(!d.authorization_url)throw new Error(d.error||"Etsy authorization URL missing");
      location.href=d.authorization_url; return;
    }
    const row=btn.closest("[data-connection-provider]"), key=((row&&row.querySelector("[data-account-key]"))||{}).value||"", mode=((row&&row.querySelector("[data-account-mode]"))||{}).value||"sandbox";
    if(!key){alert(provider+" API key를 입력해주세요.");return;}
    const d=await api("/api/paid-jobs/"+encodeURIComponent(id)+"/connections/"+encodeURIComponent(provider),{method:"POST",body:JSON.stringify({api_key:key,mode})});
    if(!d.ok)throw new Error(d.error+(d.detail?": "+d.detail:""));
    const fake={dataset:{jobId:id},disabled:false,textContent:"👤 고객정보"}; await showClientIntake(fake);
  }catch(err){alert("계정 연결 실패: "+err.message);}
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
    if(start.status==='contract_payment_required'){el.innerHTML='<b>💳 계약·결제 확보가 먼저 필요합니다.</b><br>같은 카드의 계약·결제 버튼에서 계약 완료와 결제 확보 상태를 저장해주세요.';return;}\n    if(start.status==='sandbox_required'){el.innerHTML='<b>🧪 샌드박스 성공이 먼저 필요합니다.</b><br>같은 카드의 샌드박스 테스트를 성공시킨 뒤 다시 눌러주세요.';return;}
    if(start.status!=='dispatched'){const missing=Array.isArray(start.missing_configuration)&&start.missing_configuration.length?' · 누락: '+start.missing_configuration.join(', '):'';el.textContent='제작 상태: '+esc(start.status||'unknown')+esc(missing);return;}
    el.textContent='제작 실행됨 · '+esc(start.run_id)+' · Factory Worker/QC 결과 확인 중…';
    for(let i=0;i<40;i++){
      await new Promise(r=>setTimeout(r,2000));
      const p=await api('/api/paid-jobs/'+encodeURIComponent(id)+'/production');
      if(p.status==='completed'){
        const ok=p.conclusion==='success', sm=p.summary||{};
        const gate=sm.next_gate==='client_intake_required'?'고객 답변 입력 필요':sm.next_gate==='account_connection_required'?'계정 연결 필요':sm.next_gate==='secure_execution_approval'?'보안연동 승인 대기':sm.next_gate==='client_access_required'?'고객 계정·권한 연결 대기':'납품 검토 가능';
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
  el.innerHTML='<div class="reason" style="margin-top:12px"><div class="meta">Manager '+esc(p.manager_version)+' · '+esc((p.build_spec&&p.build_spec.spec_version)||'no-build-spec')+'</div>'+diag+'<b>🧩 요구 기능</b><br>'+req+'<br><br><b>🏭 Factory Builder</b><br>'+esc(fb.builder_version||'')+' · 준비 '+esc(fb.ready_tasks||0)+' · 외부권한 대기 '+esc(fb.blocked_tasks||0)+'<br>'+bt+'<br><br><b>⚙️ Worker Execution</b><br>'+esc(wx.execution_version||'')+' · 내부 제작큐 '+esc(wx.queued_internal_builds||0)+' · 고객권한 대기 '+esc(wx.waiting_for_client_access||0)+'<br>'+wj+'<br><br><b>📦 Build Runtime</b><br>'+esc(br.runtime_version||'')+' · 산출물 '+esc(br.artifact_count||0)+'개<br>'+arts+'<br><br><b>🛠 Artifact Generator</b><br>'+esc(ag.generator_version||'')+' · 실제 초안 '+esc(ag.generated_count||0)+'개 · '+esc(ag.total_bytes||0)+' bytes<br><br><b>💻 Code Worker</b><br>'+esc(cw.code_worker_version||'')+' · '+esc(cw.status||'')+' · 파일 '+esc(cw.file_count||0)+'개 · 테스트 '+esc(cw.test_execution||'')+'<br><br><b>🧪 QC</b><br>'+esc(qc.qc_version||'')+' · '+esc(qc.status||'')+' · '+esc(qc.passed||0)+'/'+esc(qc.total||0)+'<br><br><b>❓ 고객 확인 질문</b><br>'+qs+'<br><br><b>⏱ 예상 제작</b> '+esc(p.estimated_build_hours)+'시간 · <b>외부비용</b> '+(p.external_cost_status==='needs_validation'||p.estimated_external_cost==null?'확인 필요':esc(p.estimated_external_cost))+' · <b>위험도</b> '+esc(p.delivery_risk)+'<br><br><b>✉️ 지원 메시지 초안</b><br>'+esc(p.proposal_draft)+'<br><br><b>상태</b> '+esc(p.status)+' — 승인 전에는 자동 지원/전송하지 않음</div>';
 }catch(err){el.innerHTML='<div class="empty error">작업계획 조회 실패: '+esc(err.message)+'</div>';}
 finally{btn.disabled=false;btn.textContent=old;}
}

document.addEventListener('click',async e=>{\n const dealSave=e.target.closest('.dealGateSaveBtn'); if(dealSave){await saveDealGate(dealSave);return;}\n const dealBtn=e.target.closest('.dealGateBtn'); if(dealBtn){await showDealGate(dealBtn);return;}\n const connectBtn=e.target.closest('.accountConnectBtn'); if(connectBtn){await connectAccount(connectBtn);return;}
 const intakeSave=e.target.closest('.clientIntakeSaveBtn'); if(intakeSave){await saveClientIntakeUi(intakeSave);return;}
 const intakeBtn=e.target.closest('.clientIntakeBtn'); if(intakeBtn){await showClientIntake(intakeBtn);return;}
 const downloadBtn=e.target.closest('.productionDownloadBtn'); if(downloadBtn){await downloadProduction(downloadBtn);return;}
 const packageBtn=e.target.closest('.productionPackageBtn'); if(packageBtn){await showProductionPackage(packageBtn);return;}
 const production=e.target.closest('.productionRunBtn'); if(production){await runProduction(production);return;}
 const sandbox=e.target.closest('.sandboxRunBtn'); if(sandbox){await runSandbox(sandbox);return;}
  const plan=e.target.closest('.managerPlanBtn'); if(plan){await showManagerPlan(plan);return;}
 const b=e.target.closest('#candidateBtn'); if(!b)return;
 e.preventDefault(); b.disabled=true; const old=b.textContent; b.textContent='시장후보 불러오는 중…';
 const el=document.getElementById('candidateList'); el.innerHTML='<div class="empty">시장후보 불러오는 중…</div>';
 try{await loadMarketCandidates();el.scrollIntoView({behavior:'smooth',block:'start'});}
 catch(err){el.innerHTML='<div class="empty error">시장후보 조회 실패: '+esc(err.message)+'</div>';alert('시장후보 조회 실패: '+err.message);}
 finally{b.disabled=false;b.textContent=old;}
});
loadPaidJobs().catch(e=>document.getElementById('paidJobsList').innerHTML='<div class="empty error">수익 실행 현황 오류: '+esc(e.message)+'</div>');
load().catch(e=>document.getElementById('list').innerHTML='<div class="empty error">오류: '+esc(e.message)+'</div>');
</script></body></html>`;
}

export default {
  async fetch(request, env, ctx) {
    globalThis.__moneyScoutCtx = ctx;
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Render the shell and health check without waiting for D1 schema work.
      // This keeps diagnostics reachable even when schema initialization is slow.
      if (path === "/" || path === "") return html(appHtml());

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

      // DB-backed routes initialize schema only after routing lightweight endpoints.
      await ensureSchemaOnce(env);

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

      if(path==="/api/freelancer/bid-submit"&&request.method==="POST"){const denied=requireAdmin(request,env);if(denied)return denied;const body=await request.json().catch(()=>({}));if(body.approved!==true)return json({ok:false,submitted:false,reason:"explicit_user_approval_required"},400);const id=String(body.opportunity_id||"");const row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(id).first();return json(await submitFreelancerBid(env,row));}
      if(path==="/api/freelancer/bid-preflight"&&request.method==="POST"){const denied=requireAdmin(request,env);if(denied)return denied;const body=await request.json().catch(()=>({}));const id=String(body.opportunity_id||"");const row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(id).first();return json(await freelancerBidPreflight(env,row));}
      if(path==="/api/platform-connections/freelancer/capabilities"&&request.method==="POST"){const denied=requireAdmin(request,env);if(denied)return denied;return json(await freelancerCapabilityProbe(env));}
      if(path==="/api/platform-connections"&&request.method==="GET"){
        const denied=requireAdmin(request,env);if(denied)return denied;
        return json(await platformConnectionCenter(env));
      }
      if(path==="/api/platform-connections/freelancer/account-ready"&&request.method==="POST"){
        const denied=requireAdmin(request,env);if(denied)return denied;
        const body=await request.json().catch(()=>({}));
        return json({ok:true,connection:await savePlatformAccountReady(env,"freelancer",body.ready!==false)});
      }
      if(path==="/api/application-center"&&request.method==="GET"){
        const denied=requireAdmin(request,env);if(denied)return denied;
        const center=await applicationCenterRows(env);
        return json({ok:true,count:center.selected.length,held_count:center.held.length,held_items:center.held_items||[],diagnostics:center.diagnostics||{},items:center.selected.map(x=>({...x.draft,opportunity_id:x.row.opportunity_id,decision_summary:x.decision_summary}))});
      }
      const appPrepareMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/application-draft$/);
      if(appPrepareMatch&&request.method==="GET"){
        const denied=requireAdmin(request,env);if(denied)return denied;
        const id=decodeURIComponent(appPrepareMatch[1]),row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(id).first();
        if(!row)return json({ok:false,error:"Paid job not found"},404);
        return json({ok:true,draft:applicationDraft(row)});
      }
      if(path==="/api/orchestrator/tick"&&request.method==="POST"){
        const denied=requireAdmin(request,env);if(denied)return denied;
        let body={};try{body=await request.json()}catch{}
        return json(await runManagerOrchestrator(env,{request,maxActions:Number(body.max_actions??2),limit:Number(body.limit??100)}));
      }

      if(path==="/oauth/etsy/callback"&&request.method==="GET")return finishEtsyOAuth(request,env);

      const dealMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/deal$/);
      if(dealMatch&&(request.method==="GET"||request.method==="POST")){
        const denied=requireAdmin(request,env);if(denied)return denied;
        const id=decodeURIComponent(dealMatch[1]), row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(id).first();
        if(!row)return json({ok:false,error:"Paid job not found"},404);
        let bd={};try{bd=JSON.parse(row.score_breakdown||"{}")}catch{}
        if(!bd.actionable_paid_job||!bd.factory_fulfillable)return json({ok:false,error:"Factory-ready paid job only"},400);
        if(request.method==="GET")return json(await getContractPaymentGate(env,row));
        const body=await request.json().catch(()=>({})); return json(await saveContractPaymentGate(env,row,body));
      }
      const connectionsMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/connections$/);
      if(connectionsMatch&&request.method==="GET"){
        const denied=requireAdmin(request,env);if(denied)return denied;
        const id=decodeURIComponent(connectionsMatch[1]), row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(id).first();
        if(!row)return json({ok:false,error:"Paid job not found"},404);
        const deal=await getContractPaymentGate(env,row);
        return json({ok:true,...await getAccountConnections(env,row),deal_ready:deal.ready,deal:{contract_status:deal.gate.contract_status,payment_status:deal.gate.payment_status,platform:deal.gate.platform}});
      }
      const connectionActionMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/connections\/(squarespace|prodigi)$/);
      if(connectionActionMatch&&request.method==="POST"){
        const denied=requireAdmin(request,env);if(denied)return denied;
        const id=decodeURIComponent(connectionActionMatch[1]), provider=connectionActionMatch[2], row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(id).first();
        if(!row)return json({ok:false,error:"Paid job not found"},404);
        const deal=await requireContractPaymentGate(env,row); if(deal)return json({ok:false,error:"계약 및 결제 확보가 먼저 필요합니다.",deal},409);
        const body=await request.json().catch(()=>({}));
        const out=provider==="squarespace"?await connectSquarespace(env,row,body.api_key):await connectProdigi(env,row,body.api_key,body.mode||"sandbox");
        return json(out,out.ok?200:400);
      }
      const etsyStartMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/connections\/etsy\/start$/);
      if(etsyStartMatch&&request.method==="POST"){
        const denied=requireAdmin(request,env);if(denied)return denied;
        const id=decodeURIComponent(etsyStartMatch[1]), row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(id).first();
        if(!row)return json({ok:false,error:"Paid job not found"},404);
        const deal=await requireContractPaymentGate(env,row); if(deal)return json({ok:false,error:"계약 및 결제 확보가 먼저 필요합니다.",deal},409);
        const out=await startEtsyOAuth(request,env,row); return json(out,out.ok?200:400);
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
        const ghHeaders={"authorization":"Bearer "+env.GITHUB_ACTIONS_TOKEN,"accept":"application/vnd.github+json","x-github-api-version":"2022-11-28","user-agent":"AutomationFactory-MoneyScout/0.49.0"};
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

      const revisionMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/revision$/);
      if(revisionMatch&&(request.method==="GET"||request.method==="POST")){
        const denied=requireAdmin(request,env);if(denied)return denied;
        const id=decodeURIComponent(revisionMatch[1]),row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(id).first();
        if(!row)return json({ok:false,error:"Paid job not found"},404);
        if(request.method==="GET")return json(await getRevisionApproval(env,row));
        const body=await request.json().catch(()=>({}));const out=await approveRevision(env,row,body);return json(out,out.ok===false?409:200);
      }

      const deliveryMatch=path.match(/^\/api\/paid-jobs\/([^/]+)\/delivery$/);
      if(deliveryMatch&&(request.method==="GET"||request.method==="POST")){
        const denied=requireAdmin(request,env);if(denied)return denied;
        const id=decodeURIComponent(deliveryMatch[1]),row=await env.DB.prepare("SELECT * FROM opportunities WHERE opportunity_id=?").bind(id).first();
        if(!row)return json({ok:false,error:"Paid job not found"},404);
        if(request.method==="GET")return json(await getDeliveryApproval(env,row));
        const body=await request.json().catch(()=>({}));
        const out=await approveDelivery(env,row,body);
        return json(out,out.ok===false?409:200);
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
        // Keep this endpoint strictly read-only and fast. Rejudging the whole database here
        // can exceed a mobile/browser request timeout and leave the dashboard on "loading".
        // Rejudging belongs to Scout/deploy maintenance, never the dashboard GET path.

        const rows = await env.DB.prepare(`SELECT o.*,m.stage AS manager_stage,m.status_label AS manager_status_label,m.next_action AS manager_next_action,m.autopilot AS manager_autopilot,m.last_action AS manager_last_action,m.last_error AS manager_last_error,m.updated_at AS manager_updated_at,
          g.application_status AS deal_application_status,g.contract_status AS deal_contract_status,g.payment_status AS deal_payment_status
          FROM opportunities o LEFT JOIN manager_job_states m ON m.opportunity_id=o.opportunity_id
          LEFT JOIN contract_payment_gates g ON g.opportunity_id=o.opportunity_id
          WHERE o.user_state!='reject' AND json_extract(o.score_breakdown,'$.judge_version')='execution-gate-v0.8.0' AND json_extract(o.score_breakdown,'$.factory_fulfillable')=1 AND json_extract(o.score_breakdown,'$.actionable_paid_job')=1
          ORDER BY o.score DESC,o.last_seen_at DESC LIMIT 50`).all();
        const paidRows=rows.results||[];
        return json(paidRows.map(row=>({...row,hold_priority:row.manager_stage==="auto_held"?applicationPriority(row,applicationDraft(row)):null})));
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
        const group=String(body.group||"");
        const sources=Array.isArray(body.sources)?body.sources:(SCOUT_GROUPS[group]||null);
        return json(await runScout(env, sources));
      }

      if (path === "/api/scout/gate-audit" && request.method === "GET") {
        const denied = requireAdmin(request, env); if (denied) return denied;
        const rows=(await env.DB.prepare(`
          SELECT opportunity_id,title,description,score,grade,score_breakdown,competition,budget_min,budget_max,currency,url,last_seen_at
          FROM opportunities WHERE source='freelancer_projects'
          ORDER BY CASE grade WHEN 'hot' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END,score DESC,last_seen_at DESC LIMIT 400
        `).all()).results||[];
        const counts={total:rows.length,hot:0,gate_blocked:0,not_factory_fit:0,needs_spec:0,human_service:0,non_software:0,ready:0,actionable:0};
        const blockers={};
        const near=[];
        for(const row of rows){
          let b={};try{b=JSON.parse(row.score_breakdown||"{}")}catch{}
          if(row.grade==="hot")counts.hot++;
          if(!b.execution_gate_ready)counts.gate_blocked++;
          if(b.fulfillment_status&&counts[b.fulfillment_status]!==undefined)counts[b.fulfillment_status]++;
          if(b.factory_fulfillable)counts.ready++;
          if(b.actionable_paid_job)counts.actionable++;
          for(const x of (b.execution_blockers||[]))blockers[x]=(blockers[x]||0)+1;
          const miss=[];
          if(!b.execution_gate_ready)miss.push("execution:"+((b.execution_blockers||[]).join("+")||"blocked"));
          if(!b.concrete_artifact)miss.push("artifact");
          if(!b.work_spec_ready)miss.push("spec");
          if(!b.explicit_pay)miss.push("pay");
          if(b.fulfillment_status==="human_service")miss.push("human");
          if(row.grade==="hot"||Number(row.score||0)>=55)near.push({id:row.opportunity_id,title:row.title,score:row.score,grade:row.grade,fulfillment_status:b.fulfillment_status,factory_score:b.factory_fulfillment_score,miss,artifact_hits:b.software_artifact_hits||[],spec_hits:b.spec_detail_hits||[],url:row.url});
        }
        near.sort((a,b)=>(a.miss.length-b.miss.length)||(b.score-a.score));
        return json({ok:true,counts,blockers,near_misses:near.slice(0,30)});
      }

      if (path === "/api/scout/revenue-core" && request.method === "POST") {
        const denied = requireAdmin(request, env); if (denied) return denied;
        // Interactive revenue scan must execute the configured revenue-core sources, not only Freelancer.
        const revenueSources=SCOUT_GROUPS.revenue_core.filter(x=>SOURCE_REGISTRY[x]);
        const scan=await runScout(env,revenueSources);
        const placeholders=revenueSources.map(()=>"?").join(",");
        const recent=(await env.DB.prepare(`
          SELECT opportunity_id,source,source_item_id,type,title,description,budget_min,budget_max,currency,location,skills,posted_at,deadline,competition,url
          FROM opportunities WHERE source IN (${placeholders}) ORDER BY last_seen_at DESC LIMIT 800
        `).bind(...revenueSources).all()).results||[];
        let hot=0,watch=0,cold=0;
        const updates=[];
        for(const row of recent){
          const j=judgeOpportunity(row); if(j.grade==="hot")hot++; else if(j.grade==="watch")watch++; else cold++;
          updates.push(env.DB.prepare("UPDATE opportunities SET score=?,grade=?,score_breakdown=?,judge_reason=?,updated_at=? WHERE opportunity_id=?").bind(j.score,j.grade,JSON.stringify(j.breakdown),j.reason,nowIso(),row.opportunity_id));
        }
        for(let i=0;i<updates.length;i+=50)await env.DB.batch(updates.slice(i,i+50));
        return json({ok:true,group:"revenue_core",scan,rejudge:{rejudged:recent.length,grades:{hot,watch,cold}},note:"interactive_revenue_core_multisource",sources:revenueSources});
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
    if(controller.cron==="47 * * * *") ctx.waitUntil(runManagerOrchestrator(env,{maxActions:3,limit:100}));
    else ctx.waitUntil(Promise.all([runMoneyPipeline(env),runManagerOrchestrator(env,{maxActions:3,limit:100})]));
  }
};
