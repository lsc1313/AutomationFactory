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

const HIGH_RISK_WORDS = [
  "full-time","full time","onsite","on-site","relocation","senior staff","principal","lead engineer",
  "employment","employee","salary","benefits","6 months","12 months",
  "상주","파견","풀타임","정규직","출근","6개월","1년","연봉"
];

const CONTRACT_WORDS = ["contract","contractor","freelance","freelancer","bounty","fixed price","project-based","프로젝트","외주","프리랜서","건별"];

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

function moneyInfo(o) {
  const raw = Number(o.budget_max ?? o.budget_min ?? 0);
  const usd = toUsd(raw, o.currency);
  if (usd == null) return { status: "unknown", score: 0, usd: null, hardCap: 54, requiresPayCheck: true };
  if (usd < 10) return { status: "micro", score: 2, usd, hardCap: 20, requiresPayCheck: false };
  if (usd < 30) return { status: "very_low", score: 8, usd, hardCap: 35, requiresPayCheck: false };
  if (usd < 100) return { status: "low", score: 28, usd, hardCap: 55, requiresPayCheck: false };
  if (usd < 200) return { status: "ok", score: 45, usd, hardCap: 100, requiresPayCheck: false };
  if (usd < 500) return { status: "good", score: 62, usd, hardCap: 100, requiresPayCheck: false };
  if (usd < 1000) return { status: "strong", score: 75, usd, hardCap: 100, requiresPayCheck: false };
  if (usd < 2000) return { status: "high", score: 85, usd, hardCap: 100, requiresPayCheck: false };
  if (usd < 5000) return { status: "very_high", score: 95, usd, hardCap: 100, requiresPayCheck: false };
  return { status: "premium", score: 100, usd, hardCap: 100, requiresPayCheck: false };
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

function sourceFitScore(o, text) {
  const type = String(o.type || "").toLowerCase();
  if (type.includes("bounty")) return 95;
  if (type.includes("freelance") || type.includes("contract")) return 90;
  if (type.includes("lead") || type.includes("affiliate")) return 80;
  if (type.includes("content") || type.includes("creator")) return 72;
  if (text.includes("contract") || text.includes("freelance")) return 85;
  if (type.includes("remote_job")) return 18;
  return 45;
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
  const autoHits = hits(text, AUTOMATION_WORDS);
  const repeatHits = hits(text, REPEAT_WORDS);
  const fastHits = hits(text, FAST_WORDS);
  const riskHits = hits(text, HIGH_RISK_WORDS);
  const contractHits = hits(text, CONTRACT_WORDS);
  const money = moneyInfo(opportunity);

  const automation = hitScore(autoHits.length, [32, 50, 65, 78, 88, 95, 100]);
  const speed = hitScore(fastHits.length, [30, 48, 65, 78, 88, 96, 100]);
  const scale = hitScore(repeatHits.length, [30, 52, 70, 84, 94, 100]);
  const freshness = freshnessScore(opportunity.posted_at);
  const sourceFit = sourceFitScore(opportunity, text);
  const competition = competitionScore(opportunity);

  const isEmploymentLike = String(opportunity.type || "").toLowerCase().includes("remote_job") && contractHits.length === 0;
  let risk = hitScore(riskHits.length, [38, 62, 80, 92, 100]);
  if (isEmploymentLike) risk = Math.max(risk, 72);

  let score = Math.round(clamp(
    money.score * 0.35 +
    automation * 0.25 +
    speed * 0.15 +
    scale * 0.15 +
    sourceFit * 0.05 +
    freshness * 0.05 -
    risk * 0.20 -
    competition * 0.10,
    0, 100
  ));

  let hardCap = money.hardCap;
  if (isEmploymentLike) hardCap = Math.min(hardCap, 34);
  if (money.status === "low" && !(automation >= 70 && speed >= 70)) hardCap = Math.min(hardCap, 44);
  score = Math.min(score, hardCap);

  let grade = score >= 70 ? "hot" : score >= 45 ? "watch" : "cold";
  if (money.requiresPayCheck && grade === "hot") grade = "watch";
  if (money.status === "micro" || money.status === "very_low") grade = "cold";

  const reasons = [];
  if (money.requiresPayCheck) reasons.push("보상 미확인 → HOT 금지, 원문 금액 확인 필요");
  else if (money.usd != null) reasons.push(`예상 보상 약 $${Math.round(money.usd).toLocaleString()} · MONEY ${money.score}/100`);
  if (money.status === "micro") reasons.push("초소액 보상 → 자동 COLD");
  else if (money.status === "very_low") reasons.push("저보상 → 자동 COLD");
  else if (money.status === "low") reasons.push("$30~99 구간 → 매우 빠른 자동처리일 때만 WATCH");
  if (autoHits.length) reasons.push(`AUTO ${automation}/100: ${autoHits.slice(0, 4).join(", ")}`);
  if (fastHits.length) reasons.push(`SPEED ${speed}/100: ${fastHits.slice(0, 3).join(", ")}`);
  if (repeatHits.length) reasons.push(`SCALE ${scale}/100: ${repeatHits.slice(0, 3).join(", ")}`);
  if (isEmploymentLike) reasons.push("일반 원격 채용형 → Money Scout 우선순위 하향");
  else if (riskHits.length) reasons.push(`리스크 ${risk}/100: ${riskHits.slice(0, 3).join(", ")}`);
  if (competition > 0) reasons.push(`경쟁 ${competition}/100`);
  if (!reasons.length) reasons.push("판단 신호 부족");

  return {
    score,
    grade,
    reason: reasons.join(" · "),
    breakdown: {
      judge_version: "money-first-v0.3",
      money: money.score,
      money_status: money.status,
      usd_estimate: money.usd == null ? null : Math.round(money.usd * 100) / 100,
      requires_pay_check: money.requiresPayCheck,
      automation,
      speed,
      scale,
      freshness,
      source_fit: sourceFit,
      risk,
      competition_penalty: competition,
      employment_like: isEmploymentLike,
      hard_cap: hardCap
    }
  };
}
