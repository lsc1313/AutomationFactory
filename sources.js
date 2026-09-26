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
      "user-agent": "AutomationFactory-MoneyScout/0.4.1"
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
      // RemoteOK salary_min/max는 대개 연봉 범위다. Judge v0.4.1에서 fixed payout으로 취급하지 않는다.
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
      "user-agent": "AutomationFactory-MoneyScout/0.4.1"
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
      "user-agent": "AutomationFactory-MoneyScout/0.4.1"
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

function parseGithubReward(text) {
  const stable = new Set(["USD","USDC","USDT"]);
  const clean = String(text || "").replace(/,/g, "");

  const usdRange = clean.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:-|–|~|to)\s*\$?\s*(\d+(?:\.\d+)?)\s*(USD|USDC|USDT)?\b/i);
  if (usdRange) return { kind:"stable", min:Number(usdRange[1]), max:Number(usdRange[2]), currency:(usdRange[3] || "USD").toUpperCase() };

  const stableRange = clean.match(/\b(\d+(?:\.\d+)?)\s*(?:-|–|~|to)\s*(\d+(?:\.\d+)?)\s*(USD|USDC|USDT)\b/i);
  if (stableRange) return { kind:"stable", min:Number(stableRange[1]), max:Number(stableRange[2]), currency:stableRange[3].toUpperCase() };

  const usdSingle = clean.match(/(?:bounty|reward|paid|payment|pays?|earn(?:ed)?)\s*[:=-]?\s*\$\s*(\d+(?:\.\d+)?)\s*(USD|USDC|USDT)?\b/i)
    || clean.match(/\*\*Bounty:\s*\$\s*(\d+(?:\.\d+)?)\s*(USD|USDC|USDT)?/i);
  if (usdSingle) return { kind:"stable", min:Number(usdSingle[1]), max:Number(usdSingle[1]), currency:(usdSingle[2] || "USD").toUpperCase() };

  const stableSingle = clean.match(/(?:bounty|reward|paid|payment|pays?|earn(?:ed)?)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*(USDC|USDT|USD)\b/i)
    || clean.match(/\b(\d+(?:\.\d+)?)\s*(USDC|USDT)\b/i);
  if (stableSingle) return { kind:"stable", min:Number(stableSingle[1]), max:Number(stableSingle[1]), currency:stableSingle[2].toUpperCase() };

  const tokenRange = clean.match(/(?:bounty|reward|tier[^:]*:)?[^.\n]{0,45}\b(\d+(?:\.\d+)?)\s*(?:-|–|~|to)\s*(\d+(?:\.\d+)?)\s+\$?([A-Z][A-Z0-9]{1,9})\b/);
  if (tokenRange && !stable.has(tokenRange[3])) return { kind:"token", min:Number(tokenRange[1]), max:Number(tokenRange[2]), currency:tokenRange[3] };

  const tokenSingle = clean.match(/(?:bounty|reward|paid|payment|pays?)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s+\$?([A-Z][A-Z0-9]{1,9})\b/i)
    || clean.match(/\b(\d+(?:\.\d+)?)\s+\$([A-Z][A-Z0-9]{1,9})\b/);
  if (tokenSingle && !stable.has(String(tokenSingle[2]).toUpperCase())) return { kind:"token", min:Number(tokenSingle[1]), max:Number(tokenSingle[1]), currency:String(tokenSingle[2]).toUpperCase() };

  return { kind:"none", min:null, max:null, currency:"" };
}

function paidMeta(text) {
  const t = String(text || "").toLowerCase();
  const reward = parseGithubReward(text);
  const apply = /(apply on|apply at|apply here|click apply|application|submit.*application)/i.test(text);
  const claim = /\bclaim(?:ed|ing)?\b|claim work|claim job/i.test(text);
  const draw = /(weighted draw|lottery|random draw|drawn and assigned|selected at random)/i.test(text);
  const wallet = /(wallet|solana|ethereum|base mainnet|on-chain|onchain)/i.test(text);
  const firstCome = /(first[- ]come|first come|fcfs)/i.test(text);
  const assignment = draw ? "draw" : firstCome ? "first_come" : apply ? "application" : claim ? "claim" : "unknown";
  return {
    reward,
    assignment,
    wallet,
    has_action: apply || claim || firstCome || draw,
    skills: [
      "payout_evidence:" + reward.kind,
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
  if (/(csv|markdown|export|report|reporting)/.test(t)) return "reporting_export";
  if (/(tiktok|youtube|pinterest|downloader|download media|media download)/.test(t)) return "media_downloader";
  if (/(spreadsheet|excel|google sheet|sheets)/.test(t)) return "spreadsheet";
  if (/(discord|telegram|whatsapp|bot integration|chat bot|chatbot)/.test(t)) return "bot_integration";
  if (/(monitor|alert|notification|watcher|uptime)/.test(t)) return "monitoring_alerting";
  if (/(etl|data pipeline|scrape|scraping|crawler|sync data)/.test(t)) return "data_pipeline";
  if (/(workflow|automation|automate|manual process)/.test(t)) return "workflow_automation";
  if (/(docs|documentation|knowledge base|reference)/.test(t)) return "docs_knowledge";
  return "other";
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
      "[PAID DISCOVERY · Payout Verifier v0.4.1]",
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
    "is:issue is:open automation manual in:title,body",
    "is:issue is:open spreadsheet automation in:title,body",
    "is:issue is:open bot integration \"feature request\" in:title,body"
  ];
  const groups = [];
  for (const q of queries) groups.push(...await githubIssueSearch(q, 15));

  const candidates = dedupeIssues(groups)
    .filter((x) => {
      const text = issueText(x);
      return !isAutoGeneratedNoise(text) && hasDemandProblem(text);
    })
    .slice(0, 40);

  const reposByGroup = new Map();
  for (const x of candidates) {
    const group = demandGroup(issueText(x));
    const repo = githubRepoName(x.repository_url) || String(x.repository_url || x.id);
    if (!reposByGroup.has(group)) reposByGroup.set(group, new Set());
    reposByGroup.get(group).add(repo);
  }

  return candidates.map((x) => {
    const group = demandGroup(issueText(x));
    const repeat = reposByGroup.get(group)?.size || 1;
    return githubIssueToOpportunity(
      x,
      "github_demand",
      "business_opportunity",
      "[PRODUCT SIGNAL · Demand Validator v0.4.1]",
      {
        skills: [
          "demand_group:" + group,
          "demand_repeat:" + repeat,
          "demand_problem:yes"
        ]
      }
    );
  });
}

export const SOURCE_REGISTRY = {
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
