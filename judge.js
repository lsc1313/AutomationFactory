const AUTOMATION_WORDS = [
  "automation","automate","workflow","api","integration","bot","agent","ai","llm",
  "scrape","scraping","crawler","data pipeline","dashboard","spreadsheet","excel","google sheet",
  "discord","telegram","webhook","python","javascript","node","script","etl",
  "자동화","연동","봇","에이전트","크롤링","스크래핑","데이터 처리","대시보드","엑셀","구글시트","알림"
];

const REPEAT_WORDS = [
  "recurring","ongoing","weekly","daily","monthly","pipeline","monitor","maintenance","repeat",
  "반복","정기","매일","매주","매월","운영","모니터링","유지보수"
];

const FAST_WORDS = [
  "script","small","simple","fix","bug","integration","api","bot","automation","migration","csv","excel",
  "스크립트","간단","수정","연동","자동화","엑셀","csv","봇"
];

const HIGH_RISK_WORDS = [
  "full-time","full time","onsite","on-site","relocation","senior staff","principal","lead engineer",
  "6 months","12 months","employment","employee","상주","파견","풀타임","정규직","출근","6개월","1년"
];

function textOf(o) {
  return `${o.title || ""} ${o.description || ""} ${o.skills || ""} ${o.type || ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hits(text, words) {
  return words.filter((w) => text.includes(w));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function freshnessPoints(postedAt) {
  if (!postedAt) return 3;
  const t = Date.parse(postedAt);
  if (!Number.isFinite(t)) return 3;
  const days = Math.max(0, (Date.now() - t) / 86400000);
  if (days <= 1) return 10;
  if (days <= 3) return 8;
  if (days <= 7) return 6;
  if (days <= 14) return 3;
  return 0;
}

function moneyPoints(o) {
  const max = Number(o.budget_max ?? o.budget_min ?? 0);
  if (!Number.isFinite(max) || max <= 0) return 0;

  const currency = String(o.currency || "").toUpperCase();
  let usd = max;
  if (currency === "KRW") usd = max / 1350;
  if (currency === "EUR") usd = max * 1.08;
  if (currency === "GBP") usd = max * 1.27;

  if (usd >= 5000) return 20;
  if (usd >= 2000) return 17;
  if (usd >= 1000) return 14;
  if (usd >= 500) return 11;
  if (usd >= 200) return 7;
  return 3;
}

function sourceFitPoints(o, text) {
  const type = String(o.type || "").toLowerCase();
  if (type.includes("bounty")) return 10;
  if (type.includes("freelance") || type.includes("contract")) return 9;
  if (type.includes("lead") || type.includes("affiliate")) return 8;
  if (type.includes("content") || type.includes("creator")) return 7;
  if (text.includes("contract") || text.includes("freelance")) return 7;
  if (type.includes("remote_job")) return 2;
  return 4;
}

function competitionPenalty(o) {
  const c = Number(o.competition ?? o.applicant_count ?? 0);
  if (!Number.isFinite(c) || c <= 0) return 0;
  if (c >= 100) return 10;
  if (c >= 50) return 8;
  if (c >= 20) return 6;
  if (c >= 10) return 4;
  if (c >= 5) return 2;
  return 1;
}

export function judgeOpportunity(opportunity) {
  const text = textOf(opportunity);
  const autoHits = hits(text, AUTOMATION_WORDS);
  const repeatHits = hits(text, REPEAT_WORDS);
  const fastHits = hits(text, FAST_WORDS);
  const riskHits = hits(text, HIGH_RISK_WORDS);

  const automation = clamp(autoHits.length * 6, 0, 30);
  const money = moneyPoints(opportunity);
  const repeatability = clamp(repeatHits.length * 5, 0, 15);
  const speed = clamp(fastHits.length * 4, 0, 15);
  const freshness = freshnessPoints(opportunity.posted_at);
  const sourceFit = sourceFitPoints(opportunity, text);
  const riskPenalty = clamp(riskHits.length * 7, 0, 25);
  const competition = competitionPenalty(opportunity);

  const score = Math.round(clamp(
    automation + money + repeatability + speed + freshness + sourceFit - riskPenalty - competition,
    0,
    100
  ));

  const grade = score >= 70 ? "hot" : score >= 45 ? "watch" : "cold";

  const reasons = [];
  if (autoHits.length) reasons.push(`자동화 적합: ${autoHits.slice(0, 4).join(", ")}`);
  if (money > 0) reasons.push(`금액 신호 +${money}`);
  if (repeatHits.length) reasons.push(`반복 가능: ${repeatHits.slice(0, 3).join(", ")}`);
  if (fastHits.length) reasons.push(`빠른 처리 가능: ${fastHits.slice(0, 3).join(", ")}`);
  if (riskHits.length) reasons.push(`위험/비적합 신호: ${riskHits.slice(0, 3).join(", ")}`);
  if (competition > 0) reasons.push(`경쟁 신호 -${competition}`);
  if (!reasons.length) reasons.push("판단할 신호가 적음");

  return {
    score,
    grade,
    reason: reasons.join(" · "),
    breakdown: {
      automation,
      money,
      repeatability,
      speed,
      freshness,
      source_fit: sourceFit,
      risk_penalty: riskPenalty,
      competition_penalty: competition
    }
  };
}
