import assert from "node:assert/strict";
import { judgeOpportunity } from "./judge.js";
import {
  demandFingerprint,
  parseGithubReward,
  paidMeta,
  issueDemandContext,
  isDemandDocumentNoise
} from "./sources.js";

function judged(x) {
  return judgeOpportunity({
    source_item_id: "test",
    type: "unknown",
    title: "",
    description: "",
    skills: "",
    budget_min: null,
    budget_max: null,
    currency: "",
    location: "Online",
    posted_at: new Date().toISOString(),
    ...x
  });
}

assert.equal(
  demandFingerprint("Feature request: add CSV export for weekly reports"),
  "csv_export"
);
assert.equal(
  demandFingerprint("Please add Markdown export for documentation"),
  "markdown_export"
);
assert.equal(
  demandFingerprint("TikTok and YouTube media downloader with custom quality"),
  "multi_platform_downloader"
);
assert.notEqual(
  demandFingerprint("Feature request: add CSV export"),
  demandFingerprint("Feature request: add PDF export")
);

const explicitReward = parseGithubReward("**Bounty: $1 USDC.** Apply on the dashboard.");
assert.equal(explicitReward.kind, "stable");
assert.equal(explicitReward.max, 1);

const marketReference = parseGithubReward("A weekly brief could sell for about $500-1,500 a month.");
assert.equal(marketReference.kind, "none");

const tokenReward = parseGithubReward("Build Bounties (25-150 RTC). Claim this bounty after assignment.");
assert.equal(tokenReward.kind, "token");
assert.equal(tokenReward.currency, "RTC");

const falseClaim = paidMeta("Client writing in someone else's voice is a gap, not a capability to claim.");
assert.equal(falseClaim.has_action, false);

const realClaim = paidMeta("Bounty: $25 USDC. Applications are open. Apply on the dashboard.");
assert.equal(realClaim.has_action, true);
assert.equal(realClaim.assignment, "application");

const demandContext = issueDemandContext({
  title: "Feature: Expenses CSV export",
  body: "## Today\nNo CSV export exists.\n\n## Proposal\nAdd CSV export.\n\n" + "unrelated ".repeat(300)
});
assert.match(demandContext, /CSV export/i);

const positionPaperContext = issueDemandContext({
  title: "The Political Economy of Structural Computation",
  body: "Draft v1.0 — position paper\n\n## Abstract\nThis paper addresses governance.\n\n" + "spreadsheet automation ".repeat(200)
});
assert.equal(isDemandDocumentNoise(positionPaperContext), true);

const falsePaid = judged({
  source: "github_paid",
  type: "bounty_unverified",
  title: "Which client jobs can my system deliver?",
  description: "I want paid work from Fiverr and Upwork. A recurring brief might sell for $500-1,500 a month. Client writing is not a capability to claim.",
  budget_min: 500,
  budget_max: 1500,
  currency: "USD",
  skills: "payout_evidence:stable, assignment:claim"
});
assert.equal(falsePaid.grade, "cold");
assert.equal(falsePaid.breakdown.payout_kind, "no_reward_evidence");
assert.equal(falsePaid.breakdown.claim_assignment, null);

const micro = judged({
  source: "github_paid",
  type: "bounty_unverified",
  title: "Expose inference metrics",
  description: "Bounty: $1 USDC. Applications are open. Apply on the dashboard and link a Solana wallet.",
  budget_min: 1,
  budget_max: 1,
  currency: "USDC"
});
assert.equal(micro.grade, "cold");
assert.equal(micro.breakdown.usd_estimate, 1);
assert.equal(micro.breakdown.claim_assignment, "application");

const token = judged({
  source: "github_paid",
  type: "bounty_unverified",
  title: "Build Bounties (25-150 RTC)",
  description: "Build Bounties (25-150 RTC). Claim this bounty after assignment.",
  budget_min: 25,
  budget_max: 150,
  currency: "RTC",
  skills: "automation, api"
});
assert.equal(token.breakdown.payout_kind, "token_fixed");
assert.equal(token.breakdown.requires_pay_check, true);

const legacyDemand = judged({
  source: "github_demand",
  type: "business_opportunity",
  title: "Add CSV export",
  description: "Feature request: there is no CSV export and users need reports.",
  skills: "demand_group:reporting_export, demand_repeat:3, demand_problem:yes, csv, automation"
});
assert.equal(legacyDemand.grade, "cold");
assert.equal(legacyDemand.breakdown.demand_status, "legacy_signal");

const singleDemand = judged({
  source: "github_demand",
  type: "business_opportunity",
  title: "Add CSV export",
  description: "Feature request: there is no CSV export and users need reports.",
  skills: "demand_group:reporting_export, demand_fingerprint:csv_export, demand_repeat:1, demand_problem:yes, demand_context:focused, csv, automation"
});
assert.equal(singleDemand.grade, "cold");
assert.equal(singleDemand.breakdown.demand_status, "signal");
assert.equal(singleDemand.breakdown.demand_fingerprint, "csv_export");

const repeatedDemand = judged({
  source: "github_demand",
  type: "business_opportunity",
  title: "Add CSV export",
  description: "Feature request: there is no CSV export and users need reports.",
  skills: "demand_group:reporting_export, demand_fingerprint:csv_export, demand_repeat:3, demand_problem:yes, demand_context:focused, csv, automation"
});
assert.equal(repeatedDemand.grade, "watch");
assert.equal(repeatedDemand.breakdown.demand_status, "product_candidate");

const documentNoise = judged({
  source: "github_demand",
  type: "business_opportunity",
  title: "The Political Economy of Structural Computation",
  description: "Draft v1.0 — position paper. ## Abstract This paper addresses ownership. Later it mentions spreadsheet automation.",
  skills: "demand_group:spreadsheet, demand_fingerprint:spreadsheet_automation, demand_repeat:3, demand_problem:yes"
});
assert.equal(documentNoise.grade, "cold");
assert.equal(documentNoise.breakdown.demand_status, "document_noise");

const noise = judged({
  source: "github_demand",
  type: "business_opportunity",
  title: "GitHub Trending Daily",
  description: "Generated by GitHub Actions. Daily digest generated at: now.",
  skills: "demand_group:other, demand_fingerprint:lex_trending_daily_github, demand_repeat:4, demand_problem:yes, automation"
});
assert.equal(noise.grade, "cold");
assert.equal(noise.breakdown.demand_status, "noise");

console.log("validator tests: OK");
