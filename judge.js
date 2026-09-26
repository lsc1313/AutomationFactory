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
  return n;
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

function normalizePayout(o, opportunityType, text) {
  const source = String(o.source || "").toLowerCase();
  const raw = Number(o.budget_max ?? o.budget_min ?? 0);
  const rawUsd = toUsd(raw, o.currency);

  // v0.3에서 GitHub issue 본문의 첫 달러 숫자를 bounty 금액으로 오인했던 레거시 데이터.
  // 원문 텍스트 추출 금액은 지급 근거로 사용하지 않는다.
  if (source === "github_bounty") {
    return {
      kind: "unverified_text_amount", trust: "unverified", status: "unknown", score: 0,
      usd: null, raw_usd: rawUsd, hourly: null, hardCap: 54, requiresPayCheck: true,
      note: "레거시 GitHub 본문 숫자 → 실제 지급액으로 사용 금지"
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
  if (source === "github_bounty") return 22;
  if (["bounty","fixed_project","freelance_gig"].includes(opportunityType)) return 92;
  if (["content_opportunity","affiliate","business_opportunity"].includes(opportunityType)) return 76;
  if (opportunityType === "hourly_contract") return 25;
  if (opportunityType === "employment") return 8;
  return 45;
}

function trustScore(trust) {
  if (trust === "canonical_claimable_feed") return 100;
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
  if (opportunityType === "bounty_unverified") hardCap = Math.min(hardCap, 54);
  if (payout.status === "low" && !(automation >= 70 && speed >= 70)) hardCap = Math.min(hardCap, 44);
  score = Math.min(score, hardCap);

  let grade = score >= 70 ? "hot" : score >= 45 ? "watch" : "cold";
  if (payout.requiresPayCheck && grade === "hot") grade = "watch";
  if (["micro","very_low"].includes(payout.status)) grade = "cold";
  if (["employment","hourly_contract"].includes(opportunityType)) grade = "cold";

  const reasons = [];
  reasons.push(`TYPE ${opportunityType}`);
  reasons.push(`PAYOUT ${payout.kind}/${payout.trust}`);
  if (payout.requiresPayCheck) reasons.push("보상 검증 필요 → HOT 금지");
  else if (payout.usd != null) reasons.push(`실제 후보 보상 약 $${Math.round(payout.usd * 100) / 100}`);
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
      judge_version: "type+payout-v0.3.1",
      opportunity_type: opportunityType,
      payout_kind: payout.kind,
      payout_trust: payout.trust,
      payout_note: payout.note,
      money: payout.score,
      money_status: payout.status,
      usd_estimate: payout.usd == null ? null : Math.round(payout.usd * 100) / 100,
      raw_usd: payout.raw_usd == null ? null : Math.round(payout.raw_usd * 100) / 100,
      hourly_rate: payout.hourly,
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
