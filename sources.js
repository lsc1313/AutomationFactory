function stripHtml(input) {
  return String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function first(obj, keys, fallback = null) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return fallback;
}

function num(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/,/g, "").match(/-?[0-9]+(?:\.[0-9]+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function findArray(data, depth = 0) {
  if (depth > 3 || data == null) return [];
  if (Array.isArray(data)) return data;
  if (typeof data !== "object") return [];
  for (const key of ["items","opportunities","bounties","results","data","feed"]) {
    if (Array.isArray(data[key])) return data[key];
  }
  for (const key of ["data","result","payload","feed"]) {
    const arr = findArray(data[key], depth + 1);
    if (arr.length) return arr;
  }
  return [];
}

function rewardFromCanonical(x) {
  const candidates = [
    first(x, ["solver_reward_usdc","solver_reward","reward_usdc","reward","amount_usdc","amount"]),
    x?.economics?.solver_reward_usdc,
    x?.economics?.solver_reward,
    x?.funding?.solver_reward_usdc,
    x?.funding?.solver_reward,
    x?.terms?.solver_reward_usdc,
    x?.terms?.solver_reward
  ];
  for (const v of candidates) {
    const n = num(v);
    if (n != null && n >= 0) {
      // Some APIs expose token base units. A value this large is almost certainly 6-decimal USDC units.
      return n > 1000000 ? n / 1000000 : n;
    }
  }
  return null;
}

export async function collectRemoteOK() {
  const res = await fetch("https://remoteok.com/api", {
    headers: {
      "accept": "application/json",
      "user-agent": "AutomationFactory-MoneyScout/0.4.3"
    }
  });
  if (!res.ok) throw new Error(`RemoteOK HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("RemoteOK 응답 형식 오류");

  return data
    .filter((x) => x && x.id && x.position)
    .slice(0, 40)
    .map((x) => ({
      source: "remoteok",
      source_item_id: String(x.id),
      type: "remote_job",
      title: `${x.position}${x.company ? ` · ${x.company}` : ""}`,
      description: stripHtml(x.description || "").slice(0, 3000),
      // RemoteOK salary_min/max는 대개 연봉 범위다. Judge v0.4.3에서 fixed payout으로 취급하지 않는다.
      budget_min: Number(x.salary_min) || null,
      budget_max: Number(x.salary_max) || null,
      currency: (x.salary_min || x.salary_max) ? "USD" : "",
      location: String(x.location || "Remote"),
      skills: Array.isArray(x.tags) ? x.tags.join(", ") : "",
      posted_at: x.date || (x.epoch ? new Date(Number(x.epoch) * 1000).toISOString() : ""),
      deadline: "",
      competition: null,
      url: x.url || `https://remoteok.com/remote-jobs/${x.id}`
    }));
}

export async function collectAgentBounties() {
  const url = "https://api.agentbounties.app/v1/base/autonomous-bounties/feed?network=base-mainnet&claimable_only=true";
  const res = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "AutomationFactory-MoneyScout/0.4.3"
    }
  });
  if (!res.ok) throw new Error(`Agent Bounties HTTP ${res.status}`);
  const data = await res.json();
  const items = findArray(data);
  if (!items.length) return [];

  return items.slice(0, 50).map((x, i) => {
    const reward = rewardFromCanonical(x);
    const sourceUrl = String(first(x, ["source_url","github_url","url","public_url","bounty_url"], ""));
    const contract = String(first(x, ["contract_address","contract","bounty_contract"], x?.canonical?.contract || ""));
    const bountyId = String(first(x, ["bounty_id","id","uuid","opportunity_id"], contract || sourceUrl || i));
    const title = String(first(x, ["title","goal","name","summary"], "Claimable Agent Bounty"));
    const description = String(first(x, ["description","goal","acceptance_criteria","summary","next_action"], ""));
    const posted = first(x, ["created_at","posted_at","published_at","indexed_at"], "");
    const deadline = first(x, ["claim_deadline","deadline","expires_at","verification_deadline"], "");
    const verifierReady = first(x, ["verification_ready","verifier_ready"], x?.verifier?.ready);
    const status = String(first(x, ["status","lifecycle","state"], "claimable"));
    const meta = [
      contract ? `contract:${contract}` : "",
      `status:${status}`,
      verifierReady === undefined || verifierReady === null ? "" : `verification_ready:${Boolean(verifierReady)}`
    ].filter(Boolean).join(" · ");

    return {
      source: "agent_bounties",
      source_item_id: bountyId,
      type: "bounty",
      title,
      description: stripHtml(`${description} ${meta}`).slice(0, 3000),
      budget_min: reward,
      budget_max: reward,
      currency: reward == null ? "" : "USDC",
      location: "Online / Base mainnet",
      skills: "agent, api, automation, bounty, canonical, claimable",
      posted_at: String(posted || ""),
      deadline: String(deadline || ""),
      competition: num(first(x, ["claim_count","attempt_count","applicant_count"], null)),
      url: sourceUrl || "https://agentbounties.app/"
    };
  });
}


async function githubIssueSearch(query, perPage = 20) {
  const url = "https://api.github.com/search/issues?q=" + encodeURIComponent(query)
    + "&sort=updated&order=desc&per_page=" + Math.max(1, Math.min(30, perPage));
  const res = await fetch(url, {
    headers: {
      "accept": "application/vnd.github+json",
      "x-github-api-version": "2026-03-10",
      "user-agent": "AutomationFactory-MoneyScout/0.4.3"
    }
  });
  if (!res.ok) {
    const remain = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    throw new Error("GitHub Search HTTP " + res.status + (remain === "0" ? " · rate limit reset " + reset : ""));
  }
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items.filter((x) => !x.pull_request) : [];
}

function githubRepoName(repositoryUrl) {
  try {
    const u = new URL(String(repositoryUrl || ""));
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.lastIndexOf("repos");
    if (i >= 0 && parts[i + 1] && parts[i + 2]) return parts[i + 1] + "/" + parts[i + 2];
  } catch {}
  return "";
}

function githubIssueToOpportunity(x, source, type, note, extra = {}) {
  const repo = githubRepoName(x.repository_url);
  const labels = Array.isArray(x.labels)
    ? x.labels.map((v) => typeof v === "string" ? v : v?.name).filter(Boolean)
    : [];
  const extraSkills = Array.isArray(extra.skills) ? extra.skills : [];
  return {
    source,
    source_item_id: repo ? repo + "#" + x.number : String(x.id),
    type,
    title: (repo ? "[" + repo + "] " : "") + String(x.title || "GitHub opportunity"),
    description: stripHtml(note + " " + String(x.body || "")).slice(0, 3000),
    budget_min: extra.budget_min ?? null,
    budget_max: extra.budget_max ?? null,
    currency: String(extra.currency || ""),
    location: "Online",
    skills: [...labels, ...extraSkills].join(", "),
    posted_at: String(x.created_at || x.updated_at || ""),
    deadline: "",
    competition: null,
    url: String(x.html_url || "")
  };
}

function issueText(x) {
  return (String(x?.title || "") + "\n" + String(x?.body || "")).replace(/\s+/g, " ").trim();
}

export function parseGithubReward(text) {
  const stable = new Set(["USD","USDC","USDT"]);
  const clean = String(text || "").replace(/,/g, "");
  const label = "(?:bount(?:y|ies)|reward|prize|payout|payment|compensation)";
  let m;

  m = clean.match(new RegExp("\\b" + label + "\\b[^.\\n]{0,80}\\$\\s*(\\d+(?:\\.\\d+)?)\\s*(?:-|–|~|to)\\s*\\$?\\s*(\\d+(?:\\.\\d+)?)\\s*(USD|USDC|USDT)?\\b", "i"));
  if (m) return { kind:"stable", min:Number(m[1]), max:Number(m[2]), currency:String(m[3] || "USD").toUpperCase(), evidence:"explicit_label" };

  m = clean.match(new RegExp("\\b" + label + "\\b[^.\\n]{0,80}\\b(\\d+(?:\\.\\d+)?)\\s*(?:-|–|~|to)\\s*(\\d+(?:\\.\\d+)?)\\s*(USD|USDC|USDT)\\b", "i"));
  if (m) return { kind:"stable", min:Number(m[1]), max:Number(m[2]), currency:String(m[3]).toUpperCase(), evidence:"explicit_label" };

  m = clean.match(new RegExp("\\b" + label + "\\b\\s*(?:amount|tier|range)?\\s*[:=\\-]?\\s*\\$\\s*(\\d+(?:\\.\\d+)?)\\s*(USD|USDC|USDT)?\\b", "i"));
  if (m) return { kind:"stable", min:Number(m[1]), max:Number(m[1]), currency:String(m[2] || "USD").toUpperCase(), evidence:"explicit_label" };

  m = clean.match(new RegExp("\\b" + label + "\\b\\s*(?:amount|tier|range)?\\s*[:=\\-]?\\s*(\\d+(?:\\.\\d+)?)\\s*(USDC|USDT|USD)\\b", "i"));
  if (m) return { kind:"stable", min:Number(m[1]), max:Number(m[1]), currency:String(m[2]).toUpperCase(), evidence:"explicit_label" };

  m = clean.match(new RegExp("\\b" + label + "\\b[^.\\n]{0,80}\\b(\\d+(?:\\.\\d+)?)\\s*(?:-|–|~|to)\\s*(\\d+(?:\\.\\d+)?)\\s+\\$?([A-Z][A-Z0-9]{1,9})\\b", "i"));
  if (m && !stable.has(String(m[3]).toUpperCase())) {
    return { kind:"token", min:Number(m[1]), max:Number(m[2]), currency:String(m[3]).toUpperCase(), evidence:"explicit_label" };
  }

  m = clean.match(new RegExp("\\b" + label + "\\b\\s*(?:amount|tier|range)?\\s*[:=\\-]?\\s*(\\d+(?:\\.\\d+)?)\\s+\\$?([A-Z][A-Z0-9]{1,9})\\b", "i"));
  if (m && !stable.has(String(m[2]).toUpperCase())) {
    return { kind:"token", min:Number(m[1]), max:Number(m[1]), currency:String(m[2]).toUpperCase(), evidence:"explicit_label" };
  }

  return { kind:"none", min:null, max:null, currency:"", evidence:"none" };
}

export function paidMeta(text) {
  const raw = String(text || "");
  const reward = parseGithubReward(raw);
  const apply = /(apply on|apply at|apply here|click apply|applications? are open|how to apply|submit (?:an |your )?application)/i.test(raw);
  const claim = /(claim (?:this |the )?(?:bounty|issue|task|job)|claim work|claim job|claim bounty|\/claim\b)/i.test(raw);
  const draw = /(weighted draw|lottery|random draw|drawn and assigned|selected at random)/i.test(raw);
  const wallet = /(wallet|solana|ethereum|base mainnet|on-chain|onchain)/i.test(raw);
  const firstCome = /(first[- ]come|first come|fcfs)/i.test(raw);
  const assignment = draw ? "draw" : firstCome ? "first_come" : apply ? "application" : claim ? "claim" : "unknown";
  return {
    reward,
    assignment,
    wallet,
    has_action: apply || claim || firstCome || draw,
    skills: [
      "payout_evidence:" + reward.kind,
      "evidence_context:" + reward.evidence,
      "assignment:" + assignment,
      wallet ? "eligibility:wallet" : ""
    ].filter(Boolean)
  };
}

function isAutoGeneratedNoise(text) {
  const t = String(text || "").toLowerCase();
  return [
    "generated by github actions",
    "auto-generated",
    "automatically generated",
    "daily digest",
    "daily report",
    "trending daily",
    "github trending daily",
    "open source trends",
    "generated at:",
    "今日热榜",
    "每日",
    "早报"
  ].some((x) => t.includes(x.toLowerCase()));
}

export function issueDemandContext(x) {
  const title = String(x?.title || "");
  const body = String(x?.body || "");
  const first = body.slice(0, 1200);
  const sections = [];

  for (const heading of ["problem", "motivation", "proposal", "describe the solution", "feature request", "what to do"]) {
    const escaped = heading.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const re = new RegExp("(?:^|\\n)#{1,4}\\s*" + escaped + "[^\\n]*\\n([\\s\\S]{0,900})", "i");
    const m = body.match(re);
    if (m?.[0]) sections.push(m[0].slice(0, 1000));
  }

  return (title + "\n" + first + "\n" + sections.join("\n"))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2600);
}

export function isDemandDocumentNoise(text) {
  const t = String(text || "").toLowerCase();
  return [
    "position paper",
    "draft v1.",
    "draft v2.",
    "## abstract",
    "companion papers",
    "prior papers in this series",
    "this paper addresses",
    "the paper is speculative",
    "research agenda",
    "literature review"
  ].some((x) => t.includes(x));
}


function hasDemandProblem(text) {
  const t = String(text || "").toLowerCase();
  return [
    "feature request","problem","motivation","would like","please add","support for",
    "currently","there is no","there's no","lack","missing","need ","request","enhancement",
    "proposal","improve","unable to","cannot ","does not ","doesn't "
  ].some((x) => t.includes(x));
}

function demandGroup(text) {
  const t = String(text || "").toLowerCase();
  if (/(csv|markdown|pdf|export|report|reporting)/.test(t)) return "reporting_export";
  if (/(tiktok|youtube|pinterest|downloader|download media|media download)/.test(t)) return "media_downloader";
  if (/(spreadsheet|excel|google sheet|sheets)/.test(t)) return "spreadsheet";
  if (/(discord|telegram|whatsapp|bot integration|chat bot|chatbot)/.test(t)) return "bot_integration";
  if (/(monitor|alert|notification|watcher|uptime)/.test(t)) return "monitoring_alerting";
  if (/(etl|data pipeline|scrape|scraping|crawler|sync data)/.test(t)) return "data_pipeline";
  if (/(workflow|automation|automate|manual process)/.test(t)) return "workflow_automation";
  if (/(docs|documentation|knowledge base|reference)/.test(t)) return "docs_knowledge";
  return "other";
}

export function demandFingerprint(text) {
  const t = String(text || "").toLowerCase();
  const platforms = ["tiktok","youtube","pinterest"].filter((p) => t.includes(p));
  if (platforms.length >= 2 && /\b(download|downloader|media)\b/.test(t)) return "multi_platform_downloader";

  const patterns = [
    ["csv_export", /\bcsv\b.{0,80}\b(export|download|report)|\b(export|download)\b.{0,80}\bcsv\b/],
    ["markdown_export", /\bmarkdown\b.{0,80}\b(export|report|generate)|\b(export|generate)\b.{0,80}\bmarkdown\b/],
    ["pdf_export", /\bpdf\b.{0,80}\b(export|report|generate)|\b(export|generate)\b.{0,80}\bpdf\b/],
    ["report_export", /\b(report|reporting)\b.{0,80}\b(export|download|generate)|\b(export|generate)\b.{0,80}\breport/],
    ["tiktok_downloader", /\btiktok\b.{0,100}\b(download|downloader|media)/],
    ["youtube_downloader", /\byoutube\b.{0,100}\b(download|downloader|video|audio)/],
    ["pinterest_downloader", /\bpinterest\b.{0,100}\b(download|downloader|media|album)/],
    ["multi_platform_downloader", /(multi[- ]platform|multiple platforms).{0,100}\b(download|downloader)/],
    ["spreadsheet_sync", /(spreadsheet|excel|google sheets?).{0,100}\b(sync|synchroni[sz]e|integration)/],
    ["spreadsheet_automation", /(spreadsheet|excel|google sheets?).{0,100}\b(automation|automate|workflow)/],
    ["discord_bot", /\bdiscord\b.{0,100}\b(bot|automation|integration)/],
    ["telegram_bot", /\btelegram\b.{0,100}\b(bot|automation|integration)/],
    ["whatsapp_bot", /\bwhatsapp\b.{0,100}\b(bot|automation|integration)/],
    ["bot_integration", /\bbot\b.{0,80}\b(integration|webhook|workflow)/],
    ["price_monitoring", /\b(price|pricing)\b.{0,100}\b(monitor|tracking|alert|watch)/],
    ["uptime_monitoring", /\b(uptime|availability|health check)\b.{0,100}\b(monitor|alert|watch)/],
    ["change_monitoring", /\b(change|changes|update)\b.{0,100}\b(monitor|alert|watch|notification)/],
    ["web_scraping", /\b(scrape|scraping|crawler|crawl)\b/],
    ["data_sync", /\b(data|database|records?)\b.{0,100}\b(sync|synchroni[sz]e|replicate)/],
    ["data_pipeline", /\b(etl|data pipeline|ingestion pipeline)\b/],
    ["approval_workflow", /\b(approval|approve|review)\b.{0,100}\b(workflow|automation)/],
    ["notification_automation", /\b(notification|alert|message)\b.{0,100}\b(automation|automate|workflow)/],
    ["documentation_generator", /\b(docs?|documentation)\b.{0,100}\b(generate|generator|automatic|automation)/],
    ["api_reference", /\b(api reference|api docs|api documentation)\b/]
  ];
  for (const [name, re] of patterns) if (re.test(t)) return name;

  const stop = new Set([
    "feature","request","issue","problem","proposal","support","please","add","new","need","needs",
    "with","from","into","for","and","the","this","that","when","where","what","how","user","users",
    "currently","would","like","improve","enhancement","automation","automate","integration"
  ]);
  const tokens = t
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((x) => x.length >= 4 && !stop.has(x) && !/^\d+$/.test(x));

  const uniq = [...new Set(tokens)].slice(0, 3);
  return uniq.length >= 2 ? "lex_" + uniq.join("_") : "unclassified";
}

function dedupeIssues(items) {
  const map = new Map();
  for (const x of items) {
    if (!x?.id) continue;
    const prev = map.get(String(x.id));
    if (!prev || String(x.updated_at || "") > String(prev.updated_at || "")) map.set(String(x.id), x);
  }
  return [...map.values()];
}

export async function collectGitHubPaidDiscovery() {
  const queries = [
    "is:issue is:open label:bounty -repo:NSPG13/agent-bounties",
    "is:issue is:open bounty in:title,body -repo:NSPG13/agent-bounties",
    "is:issue is:open \"paid task\" in:title,body"
  ];
  const groups = [];
  for (const q of queries) groups.push(...await githubIssueSearch(q, 15));
  return dedupeIssues(groups).slice(0, 40).map((x) => {
    const meta = paidMeta(issueText(x));
    return githubIssueToOpportunity(
      x,
      "github_paid",
      "bounty_unverified",
      "[PAID DISCOVERY · Payout Verifier v0.4.3]",
      {
        budget_min: meta.reward.min,
        budget_max: meta.reward.max,
        currency: meta.reward.currency,
        skills: meta.skills
      }
    );
  });
}

export async function collectGitHubDemandSignals() {
  const queries = [
    "is:issue is:open \"csv export\" in:title,body",
    "is:issue is:open spreadsheet automation in:title,body",
    "is:issue is:open bot integration \"feature request\" in:title,body",
    "is:issue is:open \"manual process\" automation in:title,body",
    "is:issue is:open downloader \"feature request\" in:title,body"
  ];
  const groups = [];
  for (const q of queries) groups.push(...await githubIssueSearch(q, 12));

  const candidates = dedupeIssues(groups)
    .filter((x) => {
      const context = issueDemandContext(x);
      return !isAutoGeneratedNoise(context) &&
        !isDemandDocumentNoise(context) &&
        hasDemandProblem(context);
    })
    .slice(0, 50);

  const reposByFingerprint = new Map();
  for (const x of candidates) {
    const context = issueDemandContext(x);
    const fp = demandFingerprint(context);
    if (fp === "unclassified") continue;
    const repo = githubRepoName(x.repository_url) || String(x.repository_url || x.id);
    if (!reposByFingerprint.has(fp)) reposByFingerprint.set(fp, new Set());
    reposByFingerprint.get(fp).add(repo);
  }

  return candidates.map((x) => {
    const context = issueDemandContext(x);
    const group = demandGroup(context);
    const fingerprint = demandFingerprint(context);
    const repeat = fingerprint === "unclassified" ? 1 : (reposByFingerprint.get(fingerprint)?.size || 1);
    return githubIssueToOpportunity(
      x,
      "github_demand",
      "business_opportunity",
      "[PRODUCT SIGNAL · Evidence Context Filter v0.4.3]",
      {
        skills: [
          "demand_group:" + group,
          "demand_fingerprint:" + fingerprint,
          "demand_repeat:" + repeat,
          "demand_problem:yes",
          "demand_context:focused"
        ]
      }
    );
  });
}


const MARKETPLACE_NAMES = new Set(["shopify","discord","chrome","google_workspace","atlassian"]);

function marketplaceProblemText(x) {
  return [
    x?.title, x?.review_title, x?.review_text, x?.description, x?.complaint, x?.notes
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function normalizeMarketplaceEvidence(input = {}) {
  const marketplace = String(input.marketplace || input.platform || "").toLowerCase().trim();
  if (!MARKETPLACE_NAMES.has(marketplace)) throw new Error("지원하지 않는 marketplace: " + marketplace);

  const text = marketplaceProblemText(input);
  const rating = num(input.rating);
  const lowStar = rating != null && rating <= 2;
  const manual = /(manual|manually|copy.?paste|copy and paste|re[- ]?enter|reentry|re-enter|csv|export|import|spreadsheet|excel|workaround|수동|복붙|재입력)/i.test(text);
  const sync = /(sync|synchroni[sz]|mismatch|out of sync|doesn.?t update|not updating|delay|oversell|mapping|동기화|불일치|업데이트 안)/i.test(text);
  const pain = /(problem|issue|broken|fail|error|missing|lack|cannot|can.?t|doesn.?t work|support|frustrat|problematic|문제|오류|안됨|불편)/i.test(text);
  const fingerprint = demandFingerprint(text);
  const group = demandGroup(text);

  return {
    marketplace,
    app_id: String(input.app_id || input.product_id || input.slug || input.app_name || "unknown"),
    app_name: String(input.app_name || input.product_name || input.title || "Unknown app"),
    evidence_id: String(input.evidence_id || input.review_id || input.id || ""),
    rating,
    low_star: lowStar,
    manual_signal: manual,
    sync_signal: sync,
    pain_signal: pain,
    fingerprint,
    group,
    text,
    url: String(input.url || input.review_url || input.app_url || ""),
    posted_at: String(input.posted_at || input.review_date || input.updated_at || ""),
    competitor_strength: String(input.competitor_strength || "unknown").toLowerCase()
  };
}

export function marketplaceEvidenceToOpportunities(rawItems = []) {
  const normalized = rawItems.map(normalizeMarketplaceEvidence)
    .filter((x) => x.text && (x.low_star || x.manual_signal || x.sync_signal || x.pain_signal))
    .filter((x) => x.fingerprint !== "unclassified");

  const groups = new Map();
  for (const x of normalized) {
    const key = x.marketplace + ":" + x.fingerprint;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }

  const out = [];
  for (const [key, items] of groups) {
    const repos = new Set(items.map((x) => x.app_id));
    const repeat = repos.size;
    const lowStars = items.filter((x) => x.low_star).length;
    const complaints = items.filter((x) => x.pain_signal || x.manual_signal || x.sync_signal).length;
    const sample = items[0];
    const weakCompetitors = items.filter((x) => x.competitor_strength === "weak").length;
    const description = items.slice(0, 5).map((x) => x.text).join(" | ").slice(0, 3000);
    out.push({
      source: "marketplace_demand",
      source_item_id: key,
      type: "business_opportunity",
      title: "[" + sample.marketplace + "] " + sample.fingerprint + " · repeated marketplace pain",
      description: "[MARKETPLACE EVIDENCE v0.4.4] " + description,
      budget_min: null,
      budget_max: null,
      currency: "",
      location: "Online",
      skills: [
        "marketplace:" + sample.marketplace,
        "demand_group:" + sample.group,
        "demand_fingerprint:" + sample.fingerprint,
        "demand_repeat:" + repeat,
        "demand_problem:yes",
        "demand_context:review_evidence",
        "complaint_count:" + complaints,
        "low_star_reviews:" + lowStars,
        "weak_competitor_signals:" + weakCompetitors
      ].join(", "),
      posted_at: items.map((x) => x.posted_at).filter(Boolean).sort().at(-1) || "",
      deadline: "",
      competition: null,
      url: sample.url
    });
  }
  return out;
}

// v0.4.4 public Shopify adapter. It intentionally uses only public App Store pages.
// Site adapters stay isolated so markup changes fail this source without corrupting Judge logic.
function decodeEntities(input) {
  return String(input || "")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
}

function shopifyReviewLinks(html) {
  const links = new Set();
  const re = /href=["'](\/[^"'?#]+\/reviews(?:\?[^"']*)?)["']/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const path = m[1].replace(/&amp;/g, "&");
    if (!path.includes("/categories/")) links.add("https://apps.shopify.com" + path);
  }
  return [...links];
}

export function parseShopifyReviewPage(html, url = "") {
  const raw = String(html || "");
  const title = decodeEntities(stripHtml((raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "Shopify app"));
  const slug = (() => { try { return new URL(url).pathname.split("/").filter(Boolean)[0] || title; } catch { return title; } })();
  const evidence = [];

  // Shopify review cards expose rating in accessible labels/text and review prose in the card.
  // Prefer semantic/card boundaries, but fall back to date/rating text windows because
  // Shopify does not guarantee a stable public CSS class for review cards.
  let chunks = raw.split(/<(?:article|div)[^>]+(?:review|Review)[^>]*>/i).slice(1);
  if (!chunks.length) {
    const anchors = [...raw.matchAll(/(?:[1-5]\s*(?:out of|\/)\s*5|(?:rating|stars?)[^0-9]{0,40}[1-5])/gi)];
    chunks = anchors.slice(0, 80).map((m) => raw.slice(Math.max(0, m.index - 1200), m.index + 9000));
  }
  for (const chunk of chunks.slice(0, 80)) {
    const block = chunk.slice(0, 12000);
    const ratingMatch = block.match(/(?:rating|stars?)[^0-9]{0,40}([1-5])(?:\s*(?:out of|\/)?\s*5)?/i)
      || block.match(/([1-5])\s*(?:out of|\/)\s*5/i);
    const rating = ratingMatch ? Number(ratingMatch[1]) : null;
    if (rating == null || rating > 2) continue;
    const text = decodeEntities(stripHtml(block)).slice(0, 1800);
    if (text.length < 25) continue;
    evidence.push({
      marketplace: "shopify", app_id: slug, app_name: title, rating,
      review_text: text, url, posted_at: ""
    });
  }
  return evidence;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "accept":"text/html,application/xhtml+xml", "user-agent":"AutomationFactory-MoneyScout/0.4.4" }
  });
  if (!res.ok) throw new Error("Marketplace HTTP " + res.status + " · " + url);
  return await res.text();
}

export async function collectShopifyMarketplaceEvidence() {
  const discovery = [
    "https://apps.shopify.com/categories/store-management-operations",
    "https://apps.shopify.com/categories/store-management-finances",
    "https://apps.shopify.com/categories/store-management-orders-and-shipping"
  ];
  const reviewUrls = new Set();
  for (const url of discovery) {
    try {
      const html = await fetchText(url);
      for (const link of shopifyReviewLinks(html)) reviewUrls.add(link);
    } catch {}
  }

  // Stable public review pages keep the adapter useful even when category markup omits review links.
  for (const slug of ["easycsv","reviewsimportify","wise-reviews","judge-me","loox"]) {
    reviewUrls.add("https://apps.shopify.com/" + slug + "/reviews");
  }

  const evidence = [];
  for (const url of [...reviewUrls].slice(0, 18)) {
    try {
      const html = await fetchText(url);
      evidence.push(...parseShopifyReviewPage(html, url));
    } catch {}
  }
  return evidence.slice(0, 120);
}

export function parseChromeWebStorePage(html, url = "") {
  const text = decodeEntities(stripHtml(html));
  const title = decodeEntities(stripHtml((String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || text.slice(0, 120)));
  const id = (() => { try { return new URL(url).pathname.split("/").filter(Boolean).at(-1) || title; } catch { return title; } })();
  const ratingMatch = text.match(/([1-5](?:\.[0-9])?)\s*(?:out of 5|\([0-9,]+ ratings?\)|ratings?)/i);
  const rating = ratingMatch ? Number(ratingMatch[1]) : null;
  return [{
    marketplace:"chrome", app_id:id, app_name:title, rating,
    // Detail-page prose is demand evidence even when individual reviews are JS-loaded.
    description:text.slice(0, 3500), url, posted_at:""
  }];
}

export async function collectChromeMarketplaceEvidence() {
  // Seed narrow workflow tools rather than generic extensions. The list can grow from discovery later.
  const urls = [
    "https://chromewebstore.google.com/detail/shopify-app-reviews-expor/mplcfkpihmfpnakdenkakklbiipnfijj?hl=en",
    "https://chromewebstore.google.com/detail/shopify-exporter/mcapkakeigpnehoebmbghpchjokbphmg?hl=en",
    "https://chromewebstore.google.com/detail/shopify-raise-shopify-sto/hdpfnbgfohonaplgnaahcefglgclmdpo?hl=en"
  ];
  const evidence = [];
  for (const url of urls) {
    try {
      const html = await fetchText(url);
      evidence.push(...parseChromeWebStorePage(html, url));
    } catch {}
  }
  return evidence;
}

export function parseWorkspaceMarketplacePage(html, url = "") {
  const text = decodeEntities(stripHtml(html));
  const chunks = text.split(/(?=\b[1-5](?:\.[0-9])?\s*(?:stars?|rating|M\+|K\+))/i).slice(0, 80);
  return chunks.map((chunk, i) => ({
    marketplace:"google_workspace", app_id:"workspace-" + i, app_name:chunk.slice(0, 100),
    description:chunk.slice(0, 2500), url, posted_at:""
  })).filter((x) => /(manual|csv|export|import|sync|integration|workflow|spreadsheet|excel|workaround)/i.test(x.description));
}

export async function collectWorkspaceMarketplaceEvidence() {
  const urls = ["https://workspace.google.com/marketplace/"];
  const evidence = [];
  for (const url of urls) {
    try { evidence.push(...parseWorkspaceMarketplacePage(await fetchText(url), url)); } catch {}
  }
  return evidence;
}

export function parseAtlassianReviews(payload, addonKey) {
  const reviews = payload?._embedded?.reviews || payload?.reviews || [];
  return reviews.filter((r) => Number(r.stars) <= 2).map((r, i) => ({
    marketplace:"atlassian", app_id:addonKey, app_name:addonKey,
    evidence_id:String(r.id || i), rating:Number(r.stars),
    review_text:String(r.review || r.content || ""),
    url:"https://marketplace.atlassian.com/apps/" + encodeURIComponent(addonKey),
    posted_at:String(r.date || "")
  }));
}

export async function collectAtlassianMarketplaceEvidence() {
  // REST v2 GET remains publicly documented; v3 reviews require authentication.
  // Keep a narrow seed set and fail independently if Atlassian retires anonymous v2 access.
  const addonKeys = ["com.onresolve.jira.groovy.groovyrunner","com.mxgraph.confluence.plugins.diagramly"];
  const evidence = [];
  for (const key of addonKeys) {
    try {
      const url = "https://marketplace.atlassian.com/rest/2/addons/" + encodeURIComponent(key) + "/reviews?limit=50&sort=recent";
      const res = await fetch(url, { headers:{accept:"application/json","user-agent":"AutomationFactory-MoneyScout/0.4.4"} });
      if (!res.ok) continue;
      evidence.push(...parseAtlassianReviews(await res.json(), key));
    } catch {}
  }
  return evidence;
}

export async function collectMarketplaceDemand() {
  const evidence = [];
  const adapters = [
    collectShopifyMarketplaceEvidence,
    collectChromeMarketplaceEvidence,
    collectWorkspaceMarketplaceEvidence,
    collectAtlassianMarketplaceEvidence
  ];
  for (const adapter of adapters) {
    try { evidence.push(...await adapter()); } catch {}
  }
  return marketplaceEvidenceToOpportunities(evidence);
}

export const SOURCE_REGISTRY = {
  marketplace_demand: collectMarketplaceDemand,
  agent_bounties: collectAgentBounties,
  github_paid: collectGitHubPaidDiscovery,
  github_demand: collectGitHubDemandSignals,
  remoteok: collectRemoteOK
};

export async function collectSources(names = Object.keys(SOURCE_REGISTRY)) {
  const results = [];
  const errors = [];

  for (const name of names) {
    const fn = SOURCE_REGISTRY[name];
    if (!fn) {
      errors.push({ source: name, error: "알 수 없는 source" });
      continue;
    }
    try {
      const items = await fn();
      results.push({ source: name, items });
    } catch (error) {
      errors.push({ source: name, error: error?.message || String(error) });
    }
  }

  return { results, errors };
}
