import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { judgeOpportunity } from "./judge.js";
import {
  demandFingerprint,
  parseGithubReward,
  paidMeta,
  issueDemandContext,
  isDemandDocumentNoise,
  normalizeMarketplaceEvidence,
  marketplaceEvidenceToOpportunities,
  parseWorkspaceMarketplacePage,
  workspaceListingLinks,
  parseChromeWebStorePage,
  parseShopifyReviewPage
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



const marketplaceRepeated = judged({
  source: "marketplace_demand",
  type: "business_opportunity",
  title: "Shopify to accounting sync keeps requiring manual CSV repair",
  description: "Recent low-star reviews repeatedly report manual export/import, sync mismatch and re-entry.",
  skills: "marketplace:shopify, demand_group:data_pipeline, demand_fingerprint:data_sync, demand_repeat:3, demand_problem:yes, demand_context:review_evidence, complaint_count:4, low_star_reviews:3, competitor_strength:weak, automation"
});
assert.equal(marketplaceRepeated.grade, "watch");
assert.equal(marketplaceRepeated.breakdown.judge_mode, "demand");
assert.equal(marketplaceRepeated.breakdown.demand_status, "product_candidate");

const marketplaceSingle = judged({
  source: "marketplace_demand",
  type: "business_opportunity",
  title: "One review asks for CSV export",
  description: "A single user asks for CSV export.",
  skills: "marketplace:chrome, demand_group:reporting_export, demand_fingerprint:csv_export, demand_repeat:1, demand_problem:yes, demand_context:review_evidence"
});
assert.equal(marketplaceSingle.grade, "cold");
assert.equal(marketplaceSingle.breakdown.demand_status, "weak_marketplace_evidence");
assert.equal(marketplaceSingle.breakdown.marketplace_evidence_ready, false);


const normalizedMarket = normalizeMarketplaceEvidence({
  marketplace: "shopify",
  app_id: "accounting-a",
  app_name: "Accounting A",
  rating: 1,
  review_text: "Inventory sync is broken so we manually export CSV and re-enter orders.",
  competitor_strength: "weak"
});
assert.equal(normalizedMarket.low_star, true);
assert.equal(normalizedMarket.manual_signal, true);
assert.equal(normalizedMarket.sync_signal, true);

const marketOpps = marketplaceEvidenceToOpportunities([
  { marketplace:"shopify", app_id:"a", rating:1, review_text:"Data sync mismatch forces manual CSV export and import.", competitor_strength:"weak" },
  { marketplace:"shopify", app_id:"b", rating:2, review_text:"Data sync is broken; manual CSV workaround every day.", competitor_strength:"weak" },
  { marketplace:"shopify", app_id:"c", rating:1, review_text:"Need data sync because records are out of sync and require manual export.", competitor_strength:"weak" }
]);
assert.equal(marketOpps.length, 1);
assert.match(marketOpps[0].skills, /demand_repeat:3/);
assert.match(marketOpps[0].skills, /low_star_reviews:3/);
assert.equal(judged(marketOpps[0]).breakdown.demand_status, "product_candidate");

const workspaceLandingFixture = `
<a href="/marketplace/app/sheetgo/94172092257">Sheetgo</a>
<a href="/marketplace/app/email_spreadsheets/431723916752?flow_type=12">Email Spreadsheets</a>`;
const workspaceLinks = workspaceListingLinks(workspaceLandingFixture);
assert.equal(workspaceLinks.length, 2);
assert.match(workspaceLinks[0], /94172092257/);
assert.match(workspaceLinks[1], /431723916752/);

const workspaceDetail = parseWorkspaceMarketplacePage(
  "<h1>Sheetgo</h1><p>Connect Google Sheets, Excel, and CSV files and automate data sync workflows.</p>",
  "https://workspace.google.com/marketplace/app/sheetgo/94172092257"
);
assert.equal(workspaceDetail.length, 1);
assert.equal(workspaceDetail[0].app_id, "94172092257");
assert.equal(workspaceDetail[0].app_name, "Sheetgo");
assert.equal(parseWorkspaceMarketplacePage("<p>CSV sync</p>", "https://workspace.google.com/marketplace/").length, 0);

const weakSingleMarketplaceSignal = marketplaceEvidenceToOpportunities([{
  marketplace:"chrome", app_id:"one-extension", app_name:"One Extension",
  rating:null, description:"Manual CSV export workaround because sync is broken", url:"https://example.invalid/one"
}]);
assert.equal(weakSingleMarketplaceSignal.length, 0);

const corroboratedMarketplaceSignal = marketplaceEvidenceToOpportunities([
  { marketplace:"shopify", app_id:"app-a", app_name:"A", rating:1, review_text:"Manual CSV workaround because inventory sync is broken", url:"https://example.invalid/a" },
  { marketplace:"shopify", app_id:"app-b", app_name:"B", rating:2, review_text:"Inventory sync mismatch requires manual CSV export every day", url:"https://example.invalid/b" }
]);
assert.equal(corroboratedMarketplaceSignal.length, 1);
assert.match(corroboratedMarketplaceSignal[0].skills, /demand_repeat:2/);

const guardEvidence = normalizeMarketplaceEvidence({
  marketplace:"shopify", app_id:"guard-test", rating:1,
  review_text:"Auto sync used the wrong SKU mapping. We need validation before sync and recovery after a failed sync."
});
assert.equal(guardEvidence.fingerprint, "automation_guard");
assert.equal(guardEvidence.group, "reliability");


// v0.4.6 evidence-integrity regression: listing prose must never become complaint demand.
const chromeListing = parseChromeWebStorePage(
  "<h1>Exporter</h1><p>CSV export and sync workflow. 1 out of 5 ratings.</p>",
  "https://chromewebstore.google.com/detail/exporter/abcdefghijklmnop"
);
assert.equal(chromeListing[0].evidence_kind, "listing");
assert.equal(chromeListing[0].evidence_quality, "weak");
assert.equal(chromeListing[0].complaint_bearing, false);
assert.equal(chromeListing[0].rating, null);

assert.equal(workspaceDetail[0].evidence_kind, "listing");
assert.equal(workspaceDetail[0].evidence_quality, "weak");
assert.equal(workspaceDetail[0].complaint_bearing, false);

const threeWeakListings = marketplaceEvidenceToOpportunities([
  { marketplace:"chrome", app_id:"a", description:"CSV export sync workflow", evidence_kind:"listing", evidence_quality:"weak", complaint_bearing:false },
  { marketplace:"chrome", app_id:"b", description:"CSV export sync workflow", evidence_kind:"listing", evidence_quality:"weak", complaint_bearing:false },
  { marketplace:"chrome", app_id:"c", description:"CSV export sync workflow", evidence_kind:"listing", evidence_quality:"weak", complaint_bearing:false }
]);
assert.equal(threeWeakListings.length, 0);

const reviewPlusListings = marketplaceEvidenceToOpportunities([
  { marketplace:"shopify", app_id:"review-a", rating:1, review_text:"CSV export sync is broken and requires manual work", evidence_kind:"review", evidence_quality:"strong", complaint_bearing:true },
  { marketplace:"shopify", app_id:"listing-b", description:"CSV export sync workflow", evidence_kind:"listing", evidence_quality:"weak", complaint_bearing:false },
  { marketplace:"shopify", app_id:"listing-c", description:"CSV export sync workflow", evidence_kind:"listing", evidence_quality:"weak", complaint_bearing:false }
]);
assert.equal(reviewPlusListings.length, 0);

const twoStrongReviews = marketplaceEvidenceToOpportunities([
  { marketplace:"shopify", app_id:"review-a", rating:1, review_text:"CSV export sync is broken and requires manual work", evidence_kind:"review", evidence_quality:"strong", complaint_bearing:true },
  { marketplace:"shopify", app_id:"review-b", rating:2, review_text:"CSV export sync is broken and requires manual work", evidence_kind:"review", evidence_quality:"strong", complaint_bearing:true }
]);
assert.equal(twoStrongReviews.length, 1);
assert.match(twoStrongReviews[0].skills, /demand_repeat:2/);
assert.match(twoStrongReviews[0].skills, /complaint_count:2/);
assert.match(twoStrongReviews[0].skills, /low_star_reviews:2/);

const marketplaceJudgeEvidence = judged({
  source:"marketplace_demand", type:"business_opportunity",
  title:"Repeated automation guard pain",
  description:"problem missing support automation workflow",
  skills:"demand_group:reliability, demand_fingerprint:automation_guard, demand_repeat:3, demand_problem:yes, complaint_count:4, low_star_reviews:2, weak_competitor_signals:1"
});
assert.equal(marketplaceJudgeEvidence.breakdown.marketplace_evidence_ready, true);
assert.equal(marketplaceJudgeEvidence.breakdown.complaint_count, 4);
assert.equal(marketplaceJudgeEvidence.breakdown.low_star_reviews, 2);

const weakMarketplaceJudgeEvidence = judged({
  source:"marketplace_demand", type:"business_opportunity",
  title:"Weak marketplace signal",
  description:"problem automation workflow",
  skills:"demand_group:reliability, demand_fingerprint:automation_guard, demand_repeat:2, demand_problem:yes, complaint_count:1, low_star_reviews:0"
});
assert.equal(weakMarketplaceJudgeEvidence.grade, "cold");
assert.equal(weakMarketplaceJudgeEvidence.breakdown.marketplace_evidence_ready, false);

console.log("validator tests: OK");


// Generated HTML script regression: nested template output must not contain raw newlines inside quoted JS strings.
const workerSource = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(workerSource, /\\\\n/);
const suspicious = workerSource.match(/re\.textContent='[^']*\n[^']*'/);
assert.equal(suspicious, null);


const provenanceOpps = marketplaceEvidenceToOpportunities([
  { marketplace:"shopify", app_id:"prov-a", app_name:"Prov A", evidence_id:"r1", rating:1, review_text:"Inventory sync is broken and requires manual CSV export.", url:"https://example.invalid/prov-a" },
  { marketplace:"shopify", app_id:"prov-b", app_name:"Prov B", evidence_id:"r2", rating:2, review_text:"Inventory sync mismatch means manual CSV export every day.", url:"https://example.invalid/prov-b" }
]);
assert.equal(provenanceOpps.length, 1);
assert.equal(provenanceOpps[0].evidence.length, 2);
assert.equal(provenanceOpps[0].evidence[0].complaint_bearing, true);
assert.match(provenanceOpps[0].evidence[0].url, /prov-a/);


const uiWorkerSource = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(uiWorkerSource, /const evidenceHtml=/);
assert.match(uiWorkerSource, /\+evidenceHtml\+'<div class="meta">/);
