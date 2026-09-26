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

function parseUsdAmount(text) {
  const s = String(text || "");
  const patterns = [
    /\$\s*([0-9][0-9,]*(?:\.\d+)?)(\s*[kK])?/,
    /USD\s*([0-9][0-9,]*(?:\.\d+)?)(\s*[kK])?/i
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    let n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    if (m[2]) n *= 1000;
    return n;
  }
  return null;
}

export async function collectRemoteOK() {
  const res = await fetch("https://remoteok.com/api", {
    headers: {
      "accept": "application/json",
      "user-agent": "AutomationFactory-MoneyScout/0.2"
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
      description: stripHtml(x.description || "").slice(0, 2500),
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

export async function collectGitHubBounties() {
  const q = encodeURIComponent("is:issue is:open label:bounty");
  const url = `https://api.github.com/search/issues?q=${q}&sort=created&order=desc&per_page=30`;
  const res = await fetch(url, {
    headers: {
      "accept": "application/vnd.github+json",
      "user-agent": "AutomationFactory-MoneyScout/0.2",
      "x-github-api-version": "2022-11-28"
    }
  });
  if (!res.ok) throw new Error(`GitHub Search HTTP ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];

  return items.map((x) => {
    const labels = Array.isArray(x.labels)
      ? x.labels.map((l) => typeof l === "string" ? l : l?.name).filter(Boolean)
      : [];
    const amount = parseUsdAmount(`${x.title || ""} ${x.body || ""}`);
    return {
      source: "github_bounty",
      source_item_id: String(x.id),
      type: "bounty",
      title: String(x.title || "GitHub bounty"),
      description: stripHtml(x.body || "").slice(0, 2500),
      budget_min: amount,
      budget_max: amount,
      currency: amount ? "USD" : "",
      location: "Online",
      skills: labels.join(", "),
      posted_at: x.created_at || "",
      deadline: "",
      competition: Number(x.comments) || 0,
      url: String(x.html_url || "")
    };
  });
}

export const SOURCE_REGISTRY = {
  remoteok: collectRemoteOK,
  github_bounty: collectGitHubBounties
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
