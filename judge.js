const AUTOMATION_WORDS = [
  "automation","automate","workflow","api","integration","bot","agent","ai","llm",
  "scrape","scraping","crawler","data pipeline","dashboard","spreadsheet","excel","google sheet",
  "discord","telegram","webhook","python","javascript","node","script","etl","cli","github action",
  "자동화","연동","봇","에이전트","크롤링","스크래핑","데이터 처리","대시보드","엑셀","구글시트","알림"
];

const REPEAT_WORDS = [
  "recurring","ongoing","weekly","daily","monthly","pipeline","monitor","maintenance","repeat",
  "platform","template","reusable","product","saas","subscription",
  "반복","정기","매일","매주","매월","운영","모니터링","유지보수","재사용","구독","상품화"
];

const FAST_WORDS = [
  "script","small","simple","fix","bug","integration","api","bot","automation","migration","csv","excel",
  "cli","github action","docs","documentation","guide","payload","metric","endpoint",
  "스크립트","간단","수정","연동","자동화","엑셀","csv","봇","문서","가이드"
];

const EMPLOYMENT_WORDS = [
  "we are hiring","hiring","full-time","full time","employee","employment","salary","benefits",
  "senior developer","senior engineer","staff engineer","principal","career","resume","cv","interview",
  "정규직","채용","입사","연봉","복리후생","이력서","면접"
];

const HOURLY_WORDS = [
  "/hour","per hour","hourly","hrs/week","hours/week","hours per week","part-time","part time",
  "시간당","주당","파트타임"
];

const CONTRACT_WORDS = [
  "contract","contractor","freelance","freelancer","project-based","fixed price","one-off","one off",
  "프로젝트","외주","프리랜서","건별"
];

const FACTORY_DELIVERABLE_WORDS = [
  "automation","automate","workflow","api integration","integration","bot","chatbot","webhook",
  "script","python","javascript","node","scrape","scraping","crawler","data extraction","data pipeline",
  "etl","excel","spreadsheet","google sheet","dashboard","web app","website","discord bot","telegram bot",
  "cli","plugin","extension","software","tool","program","자동화","연동","봇","스크립트","크롤링","스크래핑",
  "데이터 수집","데이터 처리","엑셀","구글시트","대시보드","웹앱","프로그램","개발"
];

const HUMAN_SERVICE_WORDS = [
  "cold email","cold outreach","outreach campaign","lead generation","generate leads","appointment setting",
  "sales representative","sales closer","paid advertising","paid ads","google ads","facebook ads","meta ads",
  "media buyer","social media manager","community manager","virtual assistant","customer support",
  "telemarketing","recruiter","recruiting","seo specialist","copywriter","content writer",
  "영업","콜드메일","리드 생성","광고 운영","광고 집행","마케팅 운영","고객 응대","상담","채용 대행"
];

const BUILD_ACTION_WORDS = [
  "build","develop","create","implement","integrate","configure","migrate","fix","debug","code","program",
  "build a","develop a","create a","implement a","개발","제작","구현","연동","수정","마이그레이션"
];
const HUMAN_EXECUTION_WORDS = [
  "manage campaign","campaign management","promote services","social media promotion","marketing campaign",
  "manual testing","functionality testing","test every","qa eyes","perform qa","user testing",
  "manage account","daily posting","create and manage","gérer une","promouvoir","promotion de services",
  "campagne","réseaux sociaux","publicité","prospection","gestion des réseaux sociaux",
  "운영 대행","홍보","캠페인 운영","수동 테스트","기능 테스트","계정 운영"
];

const HIGH_RISK_WORDS = [
  "onsite","on-site","relocation","6 months","12 months","security clearance","citizenship required",
  "상주","파견","출근","6개월","1년","시민권","보안인가"
];

function textOf(o) {
  return `${o.title || ""} ${o.description || ""} ${o.skills || ""} ${o.type || ""}`
    .toLowerCase().replace(/\s+/g, " ").trim();
}
function hits(text, words) { return words.filter((w) => text.includes(w)); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function toUsd(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  const c = String(currency || "USD").toUpperCase();
  if (c === "USD" || c === "USDT" || c === "USDC") return n;
  if (c === "KRW") return n / 1350;
  if (c === "EUR") return n * 1.08;
  if (c === "GBP") return n * 1.27;
  if (c === "JPY") return n / 150;
  // 알 수 없는 토큰/통화를 USD로 오인하지 않는다.
  return null;
}

function parseHourlyRate(text) {
  const patterns = [
    /\$\s*([0-9]+(?:\.\d+)?)\s*(?:-|–|~|to)\s*\$?\s*([0-9]+(?:\.\d+)?)\s*(?:\/\s*(?:h|hr|hour)|per\s+hour)/i,
    /\$\s*([0-9]+(?:\.\d+)?)\s*(?:\/\s*(?:h|hr|hour)|per\s+hour)/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2] || m[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) return { min: Math.min(a,b), max: Math.max(a,b) };
  }
  return null;
}

function classifyOpportunity(o, text) {
  const source = String(o.source || "").toLowerCase();
  const rawType = String(o.type || "").toLowerCase();

  if (source === "agent_bounties") return "bounty";
  if (source === "github_paid") return "bounty_unverified";
  if (source === "github_demand" || source === "marketplace_demand") return "business_opportunity";
  if (source === "github_bounty") return "bounty_unverified";
  if (rawType.includes("bounty")) return "bounty";
  if (rawType.includes("affiliate") || text.includes("affiliate") || text.includes("commission only")) return "affiliate";
  if (rawType.includes("content") || rawType.includes("creator")) return "content_opportunity";
  if (rawType.includes("saas") || rawType.includes("business")) return "business_opportunity";

  if (source === "remoteok" || rawType === "remote_job") {
    if (hits(text, HOURLY_WORDS).length || (hits(text, CONTRACT_WORDS).length && text.includes("hours"))) return "hourly_contract";
    return "employment";
  }

  if (text.includes("fixed price") || text.includes("one-off") || text.includes("one off") || rawType.includes("fixed")) return "fixed_project";
  if (hits(text, CONTRACT_WORDS).length || rawType.includes("freelance") || rawType.includes("contract")) return "freelance_gig";
  if (hits(text, EMPLOYMENT_WORDS).length) return "employment";
  return "unknown";
}

function fixedMoneyScore(usd) {
  if (usd == null) return { status: "unknown", score: 0, hardCap: 54 };
  if (usd < 10) return { status: "micro", score: 2, hardCap: 20 };
  if (usd < 30) return { status: "very_low", score: 8, hardCap: 35 };
  if (usd < 100) return { status: "low", score: 28, hardCap: 55 };
  if (usd < 200) return { status: "ok", score: 45, hardCap: 100 };
  if (usd < 500) return { status: "good", score: 62, hardCap: 100 };
  if (usd < 1000) return { status: "strong", score: 75, hardCap: 100 };
  if (usd < 2000) return { status: "high", score: 85, hardCap: 100 };
  if (usd < 5000) return { status: "very_high", score: 95, hardCap: 100 };
  return { status: "premium", score: 100, hardCap: 100 };
}

function parseRewardEvidence(o, text) {
  const source = String(o.source || "").toLowerCase();
  const stable = new Set(["USD","USDC","USDT"]);
  const clean = String(text || "").replace(/,/g, " ");
  const label = "(?:bount(?:y|ies)|reward|prize|payout|payment|compensation)";
  let m;

  const stableRangeDollar = new RegExp("\\b" + label + "\\b[^.\\n]{0,80}\\$\\s*(\\d+(?:\\.\\d+)?)\\s*(?:-|–|~|to)\\s*\\$?\\s*(\\d+(?:\\.\\d+)?)\\s*(usd|usdc|usdt)?\\b", "i");
  m = clean.match(stableRangeDollar);
  if (m) return { kind:"stable", min:Number(m[1]), max:Number(m[2]), currency:String(m[3] || "USD").toUpperCase(), evidence:"explicit_label" };

  const stableRange = new RegExp("\\b" + label + "\\b[^.\\n]{0,80}\\b(\\d+(?:\\.\\d+)?)\\s*(?:-|–|~|to)\\s*(\\d+(?:\\.\\d+)?)\\s*(usd|usdc|usdt)\\b", "i");
  m = clean.match(stableRange);
  if (m) return { kind:"stable", min:Number(m[1]), max:Number(m[2]), currency:String(m[3]).toUpperCase(), evidence:"explicit_label" };

  const stableSingleDollar = new RegExp("\\b" + label + "\\b\\s*(?:amount|tier|range)?\\s*[:=\\-]?\\s*\\$\\s*(\\d+(?:\\.\\d+)?)\\s*(usd|usdc|usdt)?\\b", "i");
  m = clean.match(stableSingleDollar);
  if (m) return { kind:"stable", min:Number(m[1]), max:Number(m[1]), currency:String(m[2] || "USD").toUpperCase(), evidence:"explicit_label" };

  const stableSingle = new RegExp("\\b" + label + "\\b\\s*(?:amount|tier|range)?\\s*[:=\\-]?\\s*(\\d+(?:\\.\\d+)?)\\s*(usdc|usdt|usd)\\b", "i");
  m = clean.match(stableSingle);
  if (m) return { kind:"stable", min:Number(m[1]), max:Number(m[1]), currency:String(m[2]).toUpperCase(), evidence:"explicit_label" };

  const tokenRange = new RegExp("\\b" + label + "\\b[^.\\n]{0,80}\\b(\\d+(?:\\.\\d+)?)\\s*(?:-|–|~|to)\\s*(\\d+(?:\\.\\d+)?)\\s+\\$?([a-z][a-z0-9]{1,9})\\b", "i");
  m = clean.match(tokenRange);
  if (m && !stable.has(String(m[3]).toUpperCase())) {
    return { kind:"token", min:Number(m[1]), max:Number(m[2]), currency:String(m[3]).toUpperCase(), evidence:"explicit_label" };
  }

  const tokenSingle = new RegExp("\\b" + label + "\\b\\s*(?:amount|tier|range)?\\s*[:=\\-]?\\s*(\\d+(?:\\.\\d+)?)\\s+\\$?([a-z][a-z0-9]{1,9})\\b", "i");
  m = clean.match(tokenSingle);
  if (m && !stable.has(String(m[2]).toUpperCase())) {
    return { kind:"token", min:Number(m[1]), max:Number(m[1]), currency:String(m[2]).toUpperCase(), evidence:"explicit_label" };
  }

  // GitHub discovery는 구조화 필드가 과거 오탐에서 만들어졌을 수 있으므로
  // 반드시 원문에 explicit payout 문구가 있어야 한다.
  if (source === "github_paid") return { kind:"none", min:null, max:null, currency:"", evidence:"none" };

  const c = String(o.currency || "").toUpperCase();
  const min0 = Number(o.budget_min);
  const max0 = Number(o.budget_max ?? o.budget_min);
  if (c && Number.isFinite(max0) && max0 > 0) {
    if (stable.has(c)) {
      return { kind:"stable", min:Number.isFinite(min0) && min0 > 0 ? min0 : max0, max:max0, currency:c, evidence:"structured" };
    }
    return { kind:"token", min:Number.isFinite(min0) && min0 > 0 ? min0 : max0, max:max0, currency:c, evidence:"structured" };
  }

  return { kind:"none", min:null, max:null, currency:"", evidence:"none" };
}

function claimEvidence(text) {
  const raw = String(text || "");
  const apply = /(apply on|apply at|apply here|click apply|applications? are open|how to apply|submit (?:an |your )?application)/i.test(raw);
  const claim = /(claim (?:this |the )?(?:bounty|issue|task|job)|claim work|claim job|claim bounty|\/claim\b)/i.test(raw);
  const draw = /(weighted draw|lottery|random draw|drawn and assigned|selected at random)/i.test(raw);
  const firstCome = /(first[- ]come|first come|fcfs)/i.test(raw);
  const wallet = /(wallet|solana|ethereum|base mainnet|on-chain|onchain)/i.test(raw);
  const accountAge = /(account.{0,20}(?:days|day|months|month)|at least \d+ days old)/i.test(raw);
  return {
    has_action: apply || claim || draw || firstCome,
    assignment: draw ? "draw" : firstCome ? "first_come" : apply ? "application" : claim ? "claim" : "unknown",
    wallet,
    account_age: accountAge
  };
}

const DEMAND_PROBLEM_WORDS = [
  "feature request","problem","motivation","would like","please add","support for","currently",
  "there is no","there's no","lack","missing","need ","request","enhancement","proposal",
  "improve","unable to","cannot ","does not ","doesn't ","demand_problem:yes"
];

const DEMAND_MONETIZE_WORDS = [
  "api","dashboard","export","report","reporting","plugin","integration","subscription","saas",
  "bot","spreadsheet","excel","downloader","monitor","alert","workflow","template","service"
];

const DEMAND_NOISE_WORDS = [
  "generated by github actions","auto-generated","automatically generated","daily digest","daily report",
  "trending daily","github trending daily","open source trends","generated at:","今日热榜","早报"
];

const DEMAND_DOCUMENT_NOISE_WORDS = [
  "position paper","draft v1.","draft v2.","## abstract","companion papers",
  "prior papers in this series","this paper addresses","the paper is speculative",
  "research agenda","literature review"
];


function parseDemandRepeat(text) {
  const m = String(text || "").match(/demand_repeat:(\d+)/i);
  return m ? Math.max(1, Number(m[1]) || 1) : 1;
}

function parseDemandGroup(text) {
  const m = String(text || "").match(/demand_group:([a-z0-9_-]+)/i);
  return m ? m[1] : "unknown";
}

function parseDemandFingerprint(text) {
  const m = String(text || "").match(/demand_fingerprint:([a-z0-9_-]+)/i);
  return m ? m[1] : "";
}

function parseDemandMetric(text, name) {
  const m = String(text || "").match(new RegExp(name + ":(\\d+)", "i"));
  return m ? Math.max(0, Number(m[1]) || 0) : 0;
}

function judgeDemandOpportunity(o, text) {
  const noiseHits = hits(text, DEMAND_NOISE_WORDS);
  const documentNoiseHits = hits(text, DEMAND_DOCUMENT_NOISE_WORDS);
  const problemHits = hits(text, DEMAND_PROBLEM_WORDS);
  const monetizeHits = hits(text, DEMAND_MONETIZE_WORDS);
  const autoHits = hits(text, AUTOMATION_WORDS);
  const fastHits = hits(text, FAST_WORDS);
  const repeatCount = parseDemandRepeat(text);
  const group = parseDemandGroup(text);
  const fingerprint = parseDemandFingerprint(text);
  const legacyOrUnknownFingerprint = !fingerprint || fingerprint === "unclassified";
  const isMarketplace = String(o.source || "").toLowerCase() === "marketplace_demand";
  const complaintCount = parseDemandMetric(text, "complaint_count");
  const lowStarReviews = parseDemandMetric(text, "low_star_reviews");
  const weakCompetitorSignals = parseDemandMetric(text, "weak_competitor_signals");
  const marketplaceEvidenceReady = !isMarketplace || (repeatCount >= 2 && complaintCount >= 2 && (lowStarReviews >= 1 || repeatCount >= 3));

  const demand = problemHits.length ? hitScore(problemHits.length, [38,55,70,82,92,100]) : 10;
  const repeat = repeatCount >= 5 ? 100 : repeatCount === 4 ? 92 : repeatCount === 3 ? 80 : repeatCount === 2 ? 55 : 20;
  const build = hitScore(autoHits.length + fastHits.length, [35,50,62,74,84,92,97,100]);
  const monetize = monetizeHits.length ? hitScore(monetizeHits.length, [35,50,65,78,88,95,100]) : 20;
  const noise = (noiseHits.length || documentNoiseHits.length) ? 100 : 0;

  let score = Math.round(clamp(
    demand * 0.35 + repeat * 0.25 + build * 0.20 + monetize * 0.20 - noise * 0.70,
    0, 69
  ));

  let status = repeatCount >= 3 ? "product_candidate" : repeatCount === 2 ? "watch_signal" : "signal";
  let grade = (!noiseHits.length && !legacyOrUnknownFingerprint && repeatCount >= 2 && demand >= 55 && score >= 50) ? "watch" : "cold";
  if (noiseHits.length || documentNoiseHits.length) {
    score = Math.min(score, 15);
    status = documentNoiseHits.length ? "document_noise" : "noise";
    grade = "cold";
  } else if (legacyOrUnknownFingerprint) {
    score = Math.min(score, 39);
    status = fingerprint === "unclassified" ? "unclassified" : "legacy_signal";
    grade = "cold";
  } else if (!marketplaceEvidenceReady) {
    score = Math.min(score, 39);
    status = "weak_marketplace_evidence";
    grade = "cold";
  }

  const reasons = [
    "DEMAND " + status,
    "GROUP " + group,
    "FINGERPRINT " + (fingerprint || "legacy/none"),
    "동일 문제 독립 repo 반복 " + repeatCount,
    "문제신호 " + demand,
    "BUILD " + build,
    "MONETIZE " + monetize,
    ...(isMarketplace ? [
      "MARKETPLACE complaints " + complaintCount,
      "low-star " + lowStarReviews,
      "weak-competitor " + weakCompetitorSignals
    ] : [])
  ];
  if (documentNoiseHits.length) reasons.push("논문/리서치 문서형 → 상품수요에서 제외");
  else if (noiseHits.length) reasons.push("자동생성/리포트형 노이즈 → 제외");
  else if (legacyOrUnknownFingerprint) reasons.push("정확한 수요 fingerprint 없음 → COLD");
  else if (repeatCount < 2) reasons.push("동일 문제 단일 repo 신호 → 시장수요 확정 전 COLD");

  const paymentEvidence = parseDemandMetric(text, "payment_evidence");
  const pricingEvidence = parseDemandMetric(text, "pricing_evidence");
  const competitorEvidence = parseDemandMetric(text, "competitor_evidence");
  const weakGapEvidence = weakCompetitorSignals;
  const willingnessToPay = paymentEvidence > 0 || pricingEvidence > 0 ? "evidenced" : "needs_validation";
  const competitionGap = competitorEvidence > 0
    ? (weakGapEvidence > 0 ? "gap_evidenced" : "competition_evidenced")
    : "needs_validation";
  const recurringRevenue = repeatCount >= 3 ? "promising" : repeatCount === 2 ? "possible" : "unproven";
  const automationFit = build >= 70 ? "strong" : build >= 50 ? "medium" : "weak";
  const evidenceConfidence = isMarketplace
    ? (marketplaceEvidenceReady ? "corroborated" : "weak")
    : (repeatCount >= 3 ? "corroborated" : repeatCount === 2 ? "partial" : "single_signal");
  const validationMissing = [
    ...(willingnessToPay === "needs_validation" ? ["willingness_to_pay"] : []),
    ...(competitionGap === "needs_validation" ? ["competition_gap"] : [])
  ];
  const commercializationStatus = validationMissing.length
    ? "validation_required"
    : (repeatCount >= 3 && build >= 70 ? "commercialization_candidate" : "observe");

  reasons.push("사업화 " + commercializationStatus);
  if (validationMissing.length) reasons.push("추가검증 " + validationMissing.join(","));

  return {
    score,
    grade,
    reason: reasons.join(" · "),
    breakdown: {
      judge_version: "opportunity-judge-v1",

      judge_mode: "demand",
      opportunity_type: "business_opportunity",
      demand_status: status,
      demand_group: group,
      demand_fingerprint: fingerprint || null,
      demand,
      repeat,
      demand_repeat_count: repeatCount,
      complaint_count: complaintCount,
      low_star_reviews: lowStarReviews,
      weak_competitor_signals: weakCompetitorSignals,
      marketplace_evidence_ready: marketplaceEvidenceReady,
      build,
      monetize,
      noise,
      document_noise: documentNoiseHits.length ? 100 : 0,
      money: 0,
      automation: build,
      speed: 0,
      scale: repeat,
      payout_kind: "not_applicable",
      payout_trust: "not_applicable",
      requires_pay_check: false,
      hard_cap: 69,
      commercialization_status: commercializationStatus,
      willingness_to_pay: willingnessToPay,
      competition_gap: competitionGap,
      recurring_revenue: recurringRevenue,
      automation_fit: automationFit,
      evidence_confidence: evidenceConfidence,
      validation_missing: validationMissing,
      payment_evidence: paymentEvidence,
      pricing_evidence: pricingEvidence,
      competitor_evidence: competitorEvidence
    }
  };
}

function normalizePayout(o, opportunityType, text) {
  const source = String(o.source || "").toLowerCase();
  const raw = Number(o.budget_max ?? o.budget_min ?? 0);
  const rawUsd = toUsd(raw, o.currency);

  // 레거시 GitHub 본문 숫자는 지급액으로 신뢰하지 않는다.
  if (source === "github_bounty") {
    return {
      kind: "unverified_text_amount", trust: "unverified", status: "unknown", score: 0,
      usd: null, raw_usd: rawUsd, hourly: null, hardCap: 29, requiresPayCheck: true,
      note: "레거시 GitHub 본문 숫자 → 실제 지급액으로 사용 금지"
    };
  }

  if (source === "github_paid") {
    const evidenceText = `${o.title || ""} ${o.description || ""}`;
    const reward = parseRewardEvidence(o, evidenceText);
    const claim = claimEvidence(evidenceText);

    if (reward.kind === "none") {
      return {
        kind: "no_reward_evidence", trust: "none", status: "no_reward", score: 0,
        usd: null, raw_usd: null, hourly: null, hardCap: 29, requiresPayCheck: false,
        claim, note: "실제 보상 문구를 찾지 못함 → paid 후보에서 제외"
      };
    }

    if (reward.kind === "token") {
      return {
        kind: "token_fixed", trust: "token_reward", status: "token", score: 24,
        usd: null, raw_usd: null, hourly: null, hardCap: 54, requiresPayCheck: true,
        token_amount_min: reward.min, token_amount_max: reward.max, token_currency: reward.currency,
        claim, note: "토큰 보상 → 시세/지급 가능성 확인 필요"
      };
    }

    const usd = reward.max;
    const fixed = fixedMoneyScore(usd);
    return {
      kind: "fixed_total",
      trust: claim.has_action ? "text_reward_claim_path" : "text_reward",
      status: fixed.status,
      score: fixed.score,
      usd,
      raw_usd: usd,
      hourly: null,
      hardCap: claim.has_action ? Math.min(fixed.hardCap, 69) : Math.min(fixed.hardCap, 59),
      requiresPayCheck: !claim.has_action,
      claim,
      note: claim.has_action
        ? "보상 문구 + 신청/claim 경로 확인"
        : "보상 문구는 있으나 신청/claim 경로 추가 확인 필요"
    };
  }

  if (opportunityType === "employment") {
    return {
      kind: "annual_salary", trust: rawUsd == null ? "unknown" : "structured",
      status: "not_immediate", score: 0, usd: null, raw_usd: rawUsd, hourly: null,
      hardCap: 29, requiresPayCheck: false, note: "연봉은 1회 일감 보상이 아님"
    };
  }

  if (opportunityType === "hourly_contract") {
    const hourly = parseHourlyRate(text);
    const rate = hourly ? hourly.max : null;
    const score = rate == null ? 12 : rate < 20 ? 8 : rate < 40 ? 18 : rate < 80 ? 28 : 36;
    return {
      kind: "hourly", trust: hourly ? "text_rate" : "unknown", status: "hourly",
      score, usd: null, raw_usd: rawUsd, hourly, hardCap: 39,
      requiresPayCheck: !hourly, note: "시간제 계약은 자동화 단발 납품과 별도 취급"
    };
  }

  if (["content_opportunity","affiliate","business_opportunity"].includes(opportunityType) && rawUsd == null) {
    return {
      kind: "variable", trust: "unknown", status: "variable", score: 18,
      usd: null, raw_usd: null, hourly: null, hardCap: 64,
      requiresPayCheck: false, note: "즉시 지급보다 반복수익/자산화 평가 대상"
    };
  }

  const fixed = fixedMoneyScore(rawUsd);
  const canonical = source === "agent_bounties";
  return {
    kind: "fixed_total",
    trust: canonical ? "canonical_claimable_feed" : (rawUsd == null ? "unknown" : "source_structured"),
    status: fixed.status,
    score: fixed.score,
    usd: rawUsd,
    raw_usd: rawUsd,
    hourly: null,
    hardCap: fixed.hardCap,
    requiresPayCheck: rawUsd == null,
    note: canonical ? "claimable-only 공식 피드" : "고정 보상 후보"
  };
}

function hitScore(count, steps) {
  if (count <= 0) return 0;
  return steps[Math.min(count, steps.length) - 1];
}

function freshnessScore(postedAt) {
  if (!postedAt) return 35;
  const t = Date.parse(postedAt);
  if (!Number.isFinite(t)) return 35;
  const days = Math.max(0, (Date.now() - t) / 86400000);
  if (days <= 1) return 100;
  if (days <= 3) return 85;
  if (days <= 7) return 70;
  if (days <= 14) return 45;
  if (days <= 30) return 20;
  return 5;
}

function sourceFitScore(o, opportunityType) {
  const source = String(o.source || "").toLowerCase();
  if (source === "agent_bounties") return 100;
  if (source === "github_paid") return 58;
  if (source === "github_demand") return 72;
  if (source === "github_bounty") return 22;
  if (["bounty","fixed_project","freelance_gig"].includes(opportunityType)) return 92;
  if (["content_opportunity","affiliate","business_opportunity"].includes(opportunityType)) return 76;
  if (opportunityType === "hourly_contract") return 25;
  if (opportunityType === "employment") return 8;
  return 45;
}

function trustScore(trust) {
  if (trust === "canonical_claimable_feed") return 100;
  if (trust === "text_reward_claim_path") return 82;
  if (trust === "text_reward") return 64;
  if (trust === "token_reward") return 45;
  if (trust === "none") return 0;
  if (trust === "source_structured") return 80;
  if (trust === "text_rate") return 58;
  if (trust === "structured") return 45;
  if (trust === "unknown") return 20;
  return 5;
}

function competitionScore(o) {
  const c = Number(o.competition ?? o.applicant_count ?? 0);
  if (!Number.isFinite(c) || c <= 0) return 0;
  if (c >= 100) return 100;
  if (c >= 50) return 80;
  if (c >= 20) return 60;
  if (c >= 10) return 42;
  if (c >= 5) return 25;
  return 10;
}

export function judgeOpportunity(opportunity) {
  const text = textOf(opportunity);
  const source = String(opportunity.source || "").toLowerCase();
  if (source === "github_demand" || source === "marketplace_demand") return judgeDemandOpportunity(opportunity, text);
  const opportunityType = classifyOpportunity(opportunity, text);
  const payout = normalizePayout(opportunity, opportunityType, text);

  const autoHits = hits(text, AUTOMATION_WORDS);
  const repeatHits = hits(text, REPEAT_WORDS);
  const fastHits = hits(text, FAST_WORDS);
  const riskHits = hits(text, HIGH_RISK_WORDS);
  const employmentHits = hits(text, EMPLOYMENT_WORDS);

  const automation = hitScore(autoHits.length, [32, 50, 65, 78, 88, 95, 100]);
  const speed = hitScore(fastHits.length, [30, 48, 65, 78, 88, 96, 100]);
  const scale = hitScore(repeatHits.length, [30, 52, 70, 84, 94, 100]);
  const freshness = freshnessScore(opportunity.posted_at);
  const sourceFit = sourceFitScore(opportunity, opportunityType);
  const payoutTrust = trustScore(payout.trust);
  const competition = competitionScore(opportunity);

  let risk = hitScore(riskHits.length, [38, 62, 80, 92, 100]);
  if (opportunityType === "employment") risk = Math.max(risk, 85);
  if (opportunityType === "hourly_contract") risk = Math.max(risk, 62);
  if (employmentHits.length && opportunityType !== "bounty") risk = Math.max(risk, 55);

  let score = Math.round(clamp(
    payout.score * 0.30 +
    automation * 0.20 +
    speed * 0.15 +
    scale * 0.15 +
    sourceFit * 0.05 +
    freshness * 0.05 +
    payoutTrust * 0.10 -
    risk * 0.15 -
    competition * 0.08,
    0, 100
  ));

  let hardCap = payout.hardCap;
  if (opportunityType === "employment") hardCap = Math.min(hardCap, 29);
  if (opportunityType === "hourly_contract") hardCap = Math.min(hardCap, 39);
  if (opportunityType === "bounty_unverified") {
    const paidVerified = source === "github_paid" && payout.kind === "fixed_total" && payout.trust === "text_reward_claim_path";
    hardCap = Math.min(hardCap, paidVerified ? 69 : 54);
  }
  if (payout.status === "low" && !(automation >= 70 && speed >= 70)) hardCap = Math.min(hardCap, 44);
  score = Math.min(score, hardCap);

  let grade = score >= 70 ? "hot" : score >= 45 ? "watch" : "cold";
  const paidJob = ["bounty","fixed_project","freelance_gig"].includes(opportunityType);
  const deliverableHits = hits(text, FACTORY_DELIVERABLE_WORDS);
  const buildActionHits = hits(text, BUILD_ACTION_WORDS);
  const humanServiceHits = hits(text, HUMAN_SERVICE_WORDS);
  const humanExecutionHits = hits(text, HUMAN_EXECUTION_WORDS);
  const hasConcreteArtifact = deliverableHits.length > 0 && buildActionHits.length > 0;
  const humanExecution = humanServiceHits.length > 0 || humanExecutionHits.length > 0;
  const factoryFulfillmentScore = clamp((deliverableHits.length * 18) + (buildActionHits.length * 22) - (humanServiceHits.length * 45) - (humanExecutionHits.length * 55), 0, 100);
  const factoryFulfillable = hasConcreteArtifact && !humanExecution && factoryFulfillmentScore >= 55;
  const fulfillmentStatus = factoryFulfillable ? "ready" : humanExecution ? "human_service" : deliverableHits.length ? "needs_clarification" : "not_factory_fit";
  const explicitPay = payout.usd != null && payout.usd > 0 && !payout.requiresPayCheck;
  const actionablePaidJob = paidJob && explicitPay && factoryFulfillable && !["micro","very_low","no_reward"].includes(payout.status);
  if (payout.requiresPayCheck && grade === "hot") grade = "watch";
  if (["micro","very_low","no_reward"].includes(payout.status)) grade = "cold";
  if (payout.kind === "token_fixed" && grade === "hot") grade = "watch";
  if (["employment","hourly_contract"].includes(opportunityType)) grade = "cold";

  const reasons = [];
  reasons.push(`TYPE ${opportunityType}`);
  reasons.push(`PAYOUT ${payout.kind}/${payout.trust}`);
  if (payout.kind === "no_reward_evidence") reasons.push("보상 근거 없음 → COLD");
  else if (payout.kind === "token_fixed") reasons.push(`TOKEN ${payout.token_amount_min}~${payout.token_amount_max} ${payout.token_currency} → 시세/지급 확인`);
  else if (payout.requiresPayCheck) reasons.push("보상/claim 추가 검증 필요 → HOT 금지");
  else if (payout.usd != null) reasons.push(`실제 후보 보상 약 ${Math.round(payout.usd * 100) / 100}`);
  if (payout.claim?.assignment && payout.claim.assignment !== "unknown") reasons.push(`배정방식 ${payout.claim.assignment}`);
  if (payout.claim?.wallet) reasons.push("지갑 필요");
  if (payout.claim?.account_age) reasons.push("계정 연령 조건 가능");
  if (payout.raw_usd != null && payout.usd == null && payout.kind === "annual_salary") reasons.push(`표시 연봉 $${Math.round(payout.raw_usd).toLocaleString()}는 일감 보상에서 제외`);
  if (payout.raw_usd != null && payout.kind === "unverified_text_amount") reasons.push(`본문 추출 $${Math.round(payout.raw_usd).toLocaleString()}는 지급액으로 무시`);
  if (payout.hourly) reasons.push(`시간당 $${payout.hourly.min}~$${payout.hourly.max}`);
  if (payout.status === "micro") reasons.push("초소액 → 자동 COLD");
  else if (payout.status === "very_low") reasons.push("저보상 → 자동 COLD");
  else if (payout.status === "low") reasons.push("$30~99 → 매우 빠른 자동처리일 때만 WATCH");
  if (autoHits.length) reasons.push(`AUTO ${automation}: ${autoHits.slice(0, 4).join(", ")}`);
  if (fastHits.length) reasons.push(`SPEED ${speed}: ${fastHits.slice(0, 3).join(", ")}`);
  if (repeatHits.length) reasons.push(`SCALE ${scale}: ${repeatHits.slice(0, 3).join(", ")}`);
  if (opportunityType === "employment") reasons.push("채용/연봉형 → 자동화 일감 HOT 대상 아님");
  if (opportunityType === "hourly_contract") reasons.push("시간제 계약 → 단발 자동납품보다 우선순위 낮음");
  if (riskHits.length) reasons.push(`리스크 ${risk}: ${riskHits.slice(0, 3).join(", ")}`);
  if (competition > 0) reasons.push(`경쟁 ${competition}`);

  return {
    score,
    grade,
    reason: reasons.join(" · "),
    breakdown: {
      judge_version: "deliverable-judge-v0.7.7",
      judge_mode: "paid",
      paid_job: paidJob,
      explicit_pay: explicitPay,
      actionable_paid_job: actionablePaidJob,
      factory_fulfillable: factoryFulfillable,
      fulfillment_status: fulfillmentStatus,
      concrete_artifact: hasConcreteArtifact,
      factory_fulfillment_score: factoryFulfillmentScore,
      factory_deliverable_hits: deliverableHits.slice(0,8),
      build_action_hits: buildActionHits.slice(0,8),
      human_execution_hits: humanExecutionHits.slice(0,8),
      human_service_hits: humanServiceHits.slice(0,8),
      opportunity_type: opportunityType,
      payout_kind: payout.kind,
      payout_trust: payout.trust,
      payout_note: payout.note,
      money: payout.score,
      money_status: payout.status,
      usd_estimate: payout.usd == null ? null : Math.round(payout.usd * 100) / 100,
      raw_usd: payout.raw_usd == null ? null : Math.round(payout.raw_usd * 100) / 100,
      hourly_rate: payout.hourly,
      token_amount_min: payout.token_amount_min ?? null,
      token_amount_max: payout.token_amount_max ?? null,
      token_currency: payout.token_currency ?? null,
      claim_assignment: payout.claim?.assignment && payout.claim.assignment !== "unknown" ? payout.claim.assignment : null,
      claim_wallet_required: !!payout.claim?.wallet,
      claim_account_age_rule: !!payout.claim?.account_age,
      requires_pay_check: payout.requiresPayCheck,
      automation,
      speed,
      scale,
      freshness,
      source_fit: sourceFit,
      payout_trust_score: payoutTrust,
      risk,
      competition_penalty: competition,
      hard_cap: hardCap
    }
  };
}
