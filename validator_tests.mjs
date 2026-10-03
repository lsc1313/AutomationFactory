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
  body: `## Today\nNo CSV export exists.\n\n## Proposal\nAdd CSV export.\n\n` + "unrelated ".repeat(300)
});
assert.match(demandContext, /CSV export/i);

const positionPaperContext = issueDemandContext({
  title: "The Political Economy of Structural Computation",
  body: `Draft v1.0 — position paper\n\n## Abstract\nThis paper addresses governance.\n\n` + "spreadsheet automation ".repeat(200)
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


// Generated HTML script regression: worker source must retain escaped newline sequences used by nested browser scripts.
const workerSource = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(workerSource.includes("\\n"));


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


const githubCollectorSource = fs.readFileSync(new URL("./sources.js", import.meta.url), "utf8");
assert.match(githubCollectorSource, /evidenceByFingerprint/);
assert.match(githubCollectorSource, /app_id: repo/);
assert.match(githubCollectorSource, /\.\.\.\(evidenceByFingerprint\.get\(fingerprint\)\?\.values\(\) \|\| \[\]\)/);


const judgeV1Unverified = judged({
  source:"github_demand", type:"business_opportunity",
  title:"Repeated CSV automation demand",
  description:"Feature request: users need CSV export automation and reporting.",
  skills:"demand_group:reporting_export, demand_fingerprint:csv_export, demand_repeat:4, demand_problem:yes, automation, csv"
});
assert.equal(judgeV1Unverified.breakdown.commercialization_status, "validation_required");
assert.ok(judgeV1Unverified.breakdown.validation_missing.includes("willingness_to_pay"));
assert.ok(judgeV1Unverified.breakdown.validation_missing.includes("competition_gap"));

const judgeV1Validated = judged({
  source:"marketplace_demand", type:"business_opportunity",
  title:"Repeated paid sync pain",
  description:"Problem: automation sync workflow missing support.",
  skills:"demand_group:reliability, demand_fingerprint:automation_guard, demand_repeat:4, demand_problem:yes, complaint_count:4, low_star_reviews:2, weak_competitor_signals:2, payment_evidence:2, pricing_evidence:1, competitor_evidence:3, automation"
});
assert.equal(judgeV1Validated.breakdown.willingness_to_pay, "evidenced");
assert.equal(judgeV1Validated.breakdown.competition_gap, "gap_evidenced");
assert.equal(judgeV1Validated.breakdown.validation_missing.length, 0);


const validationEvidenceOpps = marketplaceEvidenceToOpportunities([
  { marketplace:"shopify", app_id:"paid-a", app_name:"Paid A", rating:1, review_text:"The $19 per month paid plan still has broken data sync and manual CSV work.", competitor_strength:"weak" },
  { marketplace:"shopify", app_id:"paid-b", app_name:"Paid B", rating:2, review_text:"We pay for this subscription but sync mismatch still requires manual CSV export.", competitor_strength:"weak" }
]);
assert.equal(validationEvidenceOpps.length, 1);
assert.match(validationEvidenceOpps[0].skills, /payment_evidence:[1-9]/);
assert.match(validationEvidenceOpps[0].skills, /pricing_evidence:[1-9]/);
assert.match(validationEvidenceOpps[0].skills, /competitor_evidence:2/);
const validationJudged = judged(validationEvidenceOpps[0]);
assert.equal(validationJudged.breakdown.willingness_to_pay, "evidenced");
assert.equal(validationJudged.breakdown.competition_gap, "gap_evidenced");

const crossMarketWorkerSource = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(crossMarketWorkerSource, /async function crossValidateMarkets/);
assert.match(crossMarketWorkerSource, /cross_market_validation:yes/);
assert.match(crossMarketWorkerSource, /\/api\/validate\/markets/);

const uiHotfixSource = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");

const runtimeFixSource = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(runtimeFixSource, /runScout\(env, \["marketplace_demand"\]\)/);

const rawMarketSource = fs.readFileSync(new URL("./sources.js", import.meta.url), "utf8");
const rawMarketWorker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(rawMarketSource, /export async function collectMarketplaceValidationEvidence/);
assert.match(rawMarketWorker, /collectMarketplaceValidationEvidence/);
assert.match(rawMarketWorker, /raw_evidence/);
assert.doesNotMatch(rawMarketWorker.slice(rawMarketWorker.indexOf("async function crossValidateMarkets"), rawMarketWorker.indexOf("async function rejudgeAll")), /runScout\(env, \["marketplace_demand"\]\)/);

const clusterWorker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(clusterWorker, /CREATE TABLE IF NOT EXISTS market_candidates/);
assert.match(clusterWorker, /ON CONFLICT\(fingerprint\) DO UPDATE SET/);
assert.match(clusterWorker, /market_candidates:marketCandidates/);

const detailWorker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(detailWorker, /\/api\/market-candidates/);
assert.match(detailWorker, /id="paidJobsList"/);
assert.match(detailWorker, /독립수요/);
assert.match(detailWorker, /가격근거/);
assert.match(detailWorker, /GitHub 수요 근거/);

const mobileButtonWorker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(mobileButtonWorker, /closest\('#candidateBtn'\)/);
assert.match(mobileButtonWorker, /시장후보 불러오는 중/);
assert.match(mobileButtonWorker, /scrollIntoView/);

const candidateViewWorker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(candidateViewWorker, /사업화 후보 '\+ready\.length\+'개/);
assert.match(candidateViewWorker, /검증 대기 '\+pending\.length\+'개 보기/);
assert.match(candidateViewWorker, /commercialization_candidate/);

const autopilotWorker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(autopilotWorker, /async function runMoneyPipeline/);
assert.ok(autopilotWorker.includes("runMoneyPipeline(env)")); assert.ok(autopilotWorker.includes("runManagerOrchestrator(env"));
assert.match(autopilotWorker, /\/api\/pipeline\/run/);
assert.match(autopilotWorker, /💰 수익 실행 대시보드/);
assert.doesNotMatch(autopilotWorker, /<button class="scan" id="scanBtn">/);
assert.doesNotMatch(autopilotWorker, /<button id="rejudgeBtn">/);
assert.doesNotMatch(autopilotWorker, /<button id="validateBtn">/);

// v0.7.0 runtime hotfix: retired controls must not have live DOM handlers
const runtimeHotfixWorker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
for (const retiredId of ["scanBtn","rejudgeBtn","validateBtn","marketRebuildBtn"]) {
  assert.doesNotMatch(runtimeHotfixWorker, new RegExp("getElementById\\\\(['\\\"]" + retiredId + "['\\\"]\\\\)\\\\.onclick"));
}

// v0.7.1: final candidates require verified money evidence, not mere commercialization possibility
const verifiedMoneyWorker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(verifiedMoneyWorker, /verified_money/);
assert.match(verifiedMoneyWorker, /verifiedMissing\.push\("payment"\)/);
assert.match(verifiedMoneyWorker, /verifiedMissing\.push\("pricing"\)/);
assert.match(verifiedMoneyWorker, /verifiedMissing\.push\("buyer_market"\)/);
assert.match(verifiedMoneyWorker, /verifiedMissing\.push\("independent_demand"\)/);

// v0.7.2 Paid Job Scout
const paidWorker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const paidJudge = fs.readFileSync(new URL("./judge.js", import.meta.url), "utf8");
assert.match(paidWorker, /\/api\/paid-jobs/);
assert.match(paidWorker, /💰 수익 실행 대시보드/);
assert.match(paidJudge, /actionable_paid_job/);
assert.match(paidJudge, /execution-gate-v0\.8\.0/);

// v0.7.3 direct paid-job sources
const sourceV073 = fs.readFileSync(new URL("./sources.js", import.meta.url), "utf8");
assert.match(sourceV073, /collectFreelancerProjects/);
assert.match(sourceV073, /freelancer_projects: collectFreelancerProjects/);
assert.match(sourceV073, /api\/projects\/0\.1\/projects\/active/);
assert.match(sourceV073, /type: fixed \? "fixed_project" : "hourly_contract"/);

// v0.7.4 paid-job sources; v0.52.4 collection is cron-owned, not dashboard-triggered\nconst autoRefreshWorker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");\nassert.match(autoRefreshWorker, /paidSources = \\["freelancer_projects","agent_bounties","github_paid"\\]/);\nassert.match(autoRefreshWorker, /Collection is cron-owned/);\nassert.doesNotMatch(autoRefreshWorker, /const refresh = runScout\\(env, paidSources\\)/);

// v0.7.5 Factory Fulfillment Gate
const fulfillJudge = fs.readFileSync(new URL("./judge.js", import.meta.url), "utf8");
assert.match(fulfillJudge, /FACTORY_DELIVERABLE_WORDS/);
assert.match(fulfillJudge, /HUMAN_SERVICE_WORDS/);
assert.match(fulfillJudge, /factory_fulfillable/);
assert.match(fulfillJudge, /human_service_hits/);
assert.match(fulfillJudge, /execution-gate-v0\.8\.0/);

// v0.7.6 paid jobs must be rejudged after Judge upgrades
const rejudgeWorker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(rejudgeWorker, /staleJudge/);
assert.match(rejudgeWorker, /execution-gate-v0\.8\.0/);
assert.match(rejudgeWorker, /factory_fulfillable/);
assert.match(rejudgeWorker, /await rejudgeAll\(env\)/);

// v0.7.7 Deliverable Judge
const deliverableJudge = fs.readFileSync(new URL("./judge.js", import.meta.url), "utf8");
assert.match(deliverableJudge, /BUILD_ACTION_WORDS/);
assert.match(deliverableJudge, /HUMAN_EXECUTION_WORDS/);
assert.match(deliverableJudge, /fulfillment_status/);
assert.match(deliverableJudge, /concrete_artifact/);
assert.match(deliverableJudge, /execution-gate-v0\.8\.0/);

// v0.7.8 Work-Spec Gate
const workSpecJudge = fs.readFileSync(new URL("./judge.js", import.meta.url), "utf8");
assert.match(workSpecJudge, /SOFTWARE_ARTIFACT_WORDS/);
assert.match(workSpecJudge, /SPEC_DETAIL_WORDS/);
assert.match(workSpecJudge, /NON_SOFTWARE_DOMAIN_WORDS/);
assert.match(workSpecJudge, /work_spec_ready/);
assert.match(workSpecJudge, /execution-gate-v0\.8\.0/);

// v0.7.9 Expanded Paid Discovery
const discoverySources = fs.readFileSync(new URL("./sources.js", import.meta.url), "utf8");
assert.match(discoverySources, /const pages = 12/);
assert.match(discoverySources, /offset=/);
assert.ok(discoverySources.includes("AutomationFactory-MoneyScout/0.7.9"));

// v0.8.1 Paid Job Manager
const managerWorker = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(managerWorker.includes("paid-job-manager-v2.0"));
assert.ok(managerWorker.includes("clarification_questions"));
assert.ok(managerWorker.includes("proposal_draft"));
assert.ok(managerWorker.includes('path.endsWith("/plan")'));

// v0.8.2 Paid Job Manager mobile UI
const managerUi = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(managerUi.includes("managerPlanBtn"));
assert.ok(managerUi.includes("작업계획"));
assert.ok(managerUi.includes("showManagerPlan"));
assert.ok(managerUi.includes("승인 전에는 자동 지원/전송하지 않음"));

// Paid Job Manager current contract
const managerV2 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(managerV2.includes('paid-job-manager-v2.0'));
assert.ok(managerV2.includes('detected_language'));
assert.ok(managerV2.includes('const questions=[...new Set(q)].slice(0,4)'));
assert.ok(managerV2.includes('factory-build-spec-v2'));

// v0.8.4 Manager v3 implementation spec
const managerV3 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(managerV3.includes("implementation_plan"));
assert.ok(managerV3.includes("deliverables"));
assert.ok(managerV3.includes("external_cost_status"));
assert.ok(managerV3.includes("needs_validation"));
assert.ok(managerV3.includes("p.external_cost_status===\'needs_validation\'||p.estimated_external_cost==null"));

// Current Builder-ready spec contract
const builderReady = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(builderReady.includes("factory-build-spec-v2"));
assert.ok(builderReady.includes("functional_requirements"));
assert.ok(builderReady.includes("acceptance_criteria"));
assert.ok(builderReady.includes("open_questions"));
assert.ok(builderReady.includes('externalCostStatus=externalCostKnown?"source_indicates_none":"needs_validation"'));

// v0.8.6 source-of-truth regression
const managerSourceFix = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(managerSourceFix.includes('String(row.title||"")+" "+String(row.description||"'));
assert.ok(!managerSourceFix.includes('String(row.description||"")+" "+String(row.skills||"'));
assert.ok(managerSourceFix.includes("Manager '+esc(p.manager_version)"));
assert.ok(managerSourceFix.includes("p.build_spec?.spec_version"));

// v0.8.7 Manager input diagnostics
const inputDiag = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(inputDiag.includes("input_diagnostics"));
assert.ok(inputDiag.includes("description_length"));
assert.ok(inputDiag.includes("analysis_preview"));
assert.ok(inputDiag.includes("Manager 실제 입력 진단"));

// v0.8.8 browser script regression: diagnostic lines must be escaped inside generated HTML
const browserHotfix = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(browserHotfix.includes("\\\\nDESCRIPTION LENGTH:"));
assert.ok(browserHotfix.includes("\\\\nANALYSIS PREVIEW:"));

// v0.8.9 diagnostics render + cost evidence
const diagRender = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(diagRender.includes("</div>'+diag+'<b>🧩 요구 기능</b>"));
assert.ok(!diagRender.includes("const externalCostKnown=/free|"));
assert.ok(diagRender.includes("no external cost|no paid service|no paid api"));

// v0.9.0 Manager v2: client-brief-driven requirements
const briefDrivenManagerV2 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(briefDrivenManagerV2.includes("paid-job-manager-v2.0"));
assert.ok(briefDrivenManagerV2.includes("factory-build-spec-v2"));
assert.ok(briefDrivenManagerV2.includes("Export the selected products from Squarespace"));
assert.ok(briefDrivenManagerV2.includes("Create the Etsy listings"));
assert.ok(briefDrivenManagerV2.includes("Connect Etsy to Prodigi"));
assert.ok(briefDrivenManagerV2.includes("Squarespace → Etsy → Prodigi"));
assert.ok(briefDrivenManagerV2.includes("US-targeted tax and shipping"));

// v0.10.0 Factory Builder v1 contract
const factoryBuilderV1 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(factoryBuilderV1.includes("factory-builder-v1"));
assert.ok(factoryBuilderV1.includes("blocked_by_client_access"));
assert.ok(factoryBuilderV1.includes("user_approval_required_before_external_actions"));
assert.ok(factoryBuilderV1.includes("data-migration-worker"));
assert.ok(factoryBuilderV1.includes("commerce-integration-worker"));
assert.ok(factoryBuilderV1.includes("integration-test-worker"));
assert.ok(factoryBuilderV1.includes("🏭 Factory Builder"));

// v0.11.0 Worker Execution v1 safety contract
const workerExecutionV1 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(workerExecutionV1.includes("worker-execution-v1"));
assert.ok(workerExecutionV1.includes("safe_internal_only"));
assert.ok(workerExecutionV1.includes("queued_internal_build"));
assert.ok(workerExecutionV1.includes("waiting_for_client_access"));
assert.ok(workerExecutionV1.includes("external_action_allowed:false"));
assert.ok(workerExecutionV1.includes("user_approval_before_any_external_action"));
assert.ok(workerExecutionV1.includes("⚙️ Worker Execution"));

// v0.12.0 Build Runtime + QC v1 contract
const buildRuntimeQcV1 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(buildRuntimeQcV1.includes("build-runtime-v1"));
assert.ok(buildRuntimeQcV1.includes("artifact_manifest_only"));
assert.ok(buildRuntimeQcV1.includes("planned_internal_artifact"));
assert.ok(buildRuntimeQcV1.includes("external_side_effect:false"));
assert.ok(buildRuntimeQcV1.includes("qc-v1"));
assert.ok(buildRuntimeQcV1.includes("external_side_effects_blocked"));
assert.ok(buildRuntimeQcV1.includes("preflight_pass"));
assert.ok(buildRuntimeQcV1.includes("📦 Build Runtime"));
assert.ok(buildRuntimeQcV1.includes("🧪 QC"));

// v0.13.0 Artifact Generator v1 contract
const artifactGeneratorV1 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(artifactGeneratorV1.includes("artifact-generator-v1"));
assert.ok(artifactGeneratorV1.includes("deterministic_internal_drafts"));
assert.ok(artifactGeneratorV1.includes("generated_internal_draft"));
assert.ok(artifactGeneratorV1.includes("internal_artifacts_generated"));
assert.ok(artifactGeneratorV1.includes("External account actions require user approval"));
assert.ok(artifactGeneratorV1.includes("🛠 Artifact Generator"));

// v0.14.0 Code Worker v1 contract
const codeWorkerV1 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(codeWorkerV1.includes("code-worker-v2.2"));
assert.ok(codeWorkerV1.includes("source_generated"));
assert.ok(codeWorkerV1.includes("project/package.json"));
assert.ok(codeWorkerV1.includes("project/src/index.js"));
assert.ok(codeWorkerV1.includes("project/test/spec.test.js"));
assert.ok(codeWorkerV1.includes("sandbox_runner_available"));
assert.ok(codeWorkerV1.includes("github-actions:sandbox-runner-v1"));
assert.ok(codeWorkerV1.includes("production remains gated on contract/payment"));
assert.ok(codeWorkerV1.includes("💻 Code Worker"));

// v0.16.1 dynamic per-job sandbox auth contract
const dynamicSandbox = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(dynamicSandbox.includes('job-sandbox-bundle-v1'));
assert.ok(dynamicSandbox.includes('sandbox_runs'));
assert.ok(dynamicSandbox.includes('GITHUB_ACTIONS_TOKEN'));
assert.ok(dynamicSandbox.includes('SANDBOX_CALLBACK_TOKEN'));
assert.ok(dynamicSandbox.includes('/sandbox'));
const dynamicWorkflow = fs.readFileSync(new URL("./.github/workflows/sandbox-runner.yml", import.meta.url), "utf8");
assert.ok(dynamicWorkflow.includes('bundle_url'));
assert.ok(dynamicWorkflow.includes('/tmp/job-sandbox'));
assert.ok(dynamicWorkflow.includes('external actions must be disabled'));
assert.ok(dynamicWorkflow.includes('secrets.SANDBOX_CALLBACK_TOKEN'));
assert.ok(dynamicWorkflow.includes('Authorization: Bearer $BUNDLE_TOKEN'));
assert.ok(dynamicSandbox.includes('const missingConfig=[]'));
assert.ok(dynamicSandbox.includes('if(!env.GITHUB_ACTIONS_TOKEN)missingConfig.push("GITHUB_ACTIONS_TOKEN")'));
assert.ok(dynamicSandbox.includes('if(!env.SANDBOX_CALLBACK_TOKEN)missingConfig.push("SANDBOX_CALLBACK_TOKEN")'));
assert.ok(dynamicSandbox.includes('const publicBaseUrl=String(env.PUBLIC_BASE_URL||new URL(request.url).origin)'));
assert.ok(dynamicSandbox.includes('request.headers.get("authorization")!=="Bearer "+env.SANDBOX_CALLBACK_TOKEN'));
assert.ok(dynamicSandbox.includes('sandboxRunBtn'));
assert.ok(dynamicSandbox.includes("method:'POST'"));
assert.ok(dynamicSandbox.includes('샌드박스 테스트 성공'));
assert.ok(dynamicSandbox.includes('missing_configuration'));
assert.ok(dynamicSandbox.includes('GITHUB_ACTIONS_TOKEN'));
assert.ok(dynamicSandbox.includes('SANDBOX_CALLBACK_TOKEN'));
assert.ok(dynamicSandbox.includes('PUBLIC_BASE_URL'));
assert.ok(dynamicSandbox.includes("j.detail?(' · '+String(j.detail).slice(0,300))"));
assert.ok(dynamicSandbox.includes('"user-agent":"AutomationFactory-MoneyScout/0.49.0"'));


// v0.17.0 Production Pipeline v1 contract
const productionV017 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(productionV017, /const APP_VERSION = "0\.56\.\d+"/);
assert.ok(productionV017.includes("CREATE TABLE IF NOT EXISTS production_runs"));
assert.ok(productionV017.includes("production-pipeline-v4"));
assert.ok(productionV017.includes("job-production-bundle-v4"));
assert.ok(productionV017.includes("dispatchProduction"));
assert.ok(productionV017.includes("productionRunBtn"));
assert.ok(productionV017.includes("🏭 제작"));
assert.ok(productionV017.includes("제작 패키지 생성·QC 테스트 통과"));
assert.ok(productionV017.includes("runnable_job_specific_package"));
assert.ok(productionV017.includes("normalizeSquarespaceExport"));
assert.ok(productionV017.includes("buildEtsyListingDrafts"));
assert.ok(productionV017.includes("buildProdigiMappings"));
assert.ok(productionV017.includes("sandbox_required"));
assert.ok(productionV017.includes("/production/package"));
assert.ok(productionV017.includes("client_access_required"));
assert.ok(productionV017.includes("external_actions_allowed:false"));


// v0.17.1 client-ready package + ZIP artifact contract
const deliveryV0171 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const workflowV0171 = fs.readFileSync(new URL("./.github/workflows/sandbox-runner.yml", import.meta.url), "utf8");
assert.ok(deliveryV0171.includes("project/src/live-connectors.js"));
assert.ok(deliveryV0171.includes("https://api.squarespace.com/v2/commerce/products"));
assert.ok(deliveryV0171.includes("https://openapi.etsy.com/v3/application/shops/"));
assert.ok(deliveryV0171.includes("https://api.sandbox.prodigi.com"));
assert.ok(deliveryV0171.includes("External action blocked: explicit approval required"));
assert.ok(deliveryV0171.includes("productionDownloadBtn"));
assert.ok(deliveryV0171.includes("/production/download"));
assert.ok(deliveryV0171.includes("job-package-"));
assert.ok(workflowV0171.includes("actions/upload-artifact@v4"));
assert.ok(workflowV0171.includes("npm run build --if-present"));
assert.ok(workflowV0171.includes("job-package-${{ inputs.run_id }}"));


// v0.18.0 Client Intake v1 contract
const intakeV018 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(intakeV018.includes("CREATE TABLE IF NOT EXISTS client_intakes"));
assert.ok(intakeV018.includes("client-intake-v3"));
assert.ok(intakeV018.includes("clientIntakeSpec"));
assert.ok(intakeV018.includes("encryptClientSecrets"));
assert.ok(intakeV018.includes("AES-GCM"));
assert.ok(intakeV018.includes("AutomationFactory-ClientVault-v1"));
assert.ok(intakeV018.includes("secret_present"));
assert.ok(intakeV018.includes("Account credentials are stored separately and are intentionally excluded from this package."));
assert.ok(intakeV018.includes("clientIntakeBtn"));
assert.ok(intakeV018.includes("clientIntakeSaveBtn"));
assert.ok(intakeV018.includes("👤 고객정보"));
assert.ok(intakeV018.includes("/intake"));
assert.ok(intakeV018.includes("client_intake_required"));
assert.ok(intakeV018.includes("secure_execution_approval"));
assert.ok(intakeV018.includes("client/CLIENT_INPUT.json"));
assert.ok(intakeV018.includes("client/ACCESS_STATUS.md"));
assert.ok(intakeV018.includes("config/client.json"));
assert.ok(intakeV018.includes("Passwords, API keys, OAuth access tokens and refresh tokens are never exported to GitHub Actions artifacts or delivery ZIP files."));


// v0.18.1 browser-script syntax regression
const uiSyntaxSource = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const appStart = uiSyntaxSource.indexOf("function appHtml() {");
assert.ok(appStart >= 0);
const templateStartMarker = "return `";
const templateStart = uiSyntaxSource.indexOf(templateStartMarker, appStart) + templateStartMarker.length;
const appEnd = uiSyntaxSource.indexOf("\n}\n\nexport default", templateStart);
assert.ok(appEnd > templateStart);
const templateEnd = uiSyntaxSource.lastIndexOf("`;", appEnd);
assert.ok(templateEnd > templateStart);
const appTemplate = uiSyntaxSource.slice(templateStart, templateEnd);
const renderedHtml = new Function("APP_VERSION", "return `" + appTemplate + "`;")("test");
const browserScriptStart = renderedHtml.indexOf("<script>") + "<script>".length;
const browserScriptEnd = renderedHtml.lastIndexOf("</script>");
assert.ok(browserScriptStart >= "<script>".length && browserScriptEnd > browserScriptStart);
assert.doesNotThrow(() => new vm.Script(renderedHtml.slice(browserScriptStart, browserScriptEnd)));
assert.ok(renderedHtml.includes("clientIntakeBtn"));


// v0.18.2 Smart Intake v2 contract
const smartIntakeV0182 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.match(smartIntakeV0182, /const APP_VERSION = "0\.56\.\d+"/);
assert.ok(smartIntakeV0182.includes("Account Connection Gate"));
assert.ok(smartIntakeV0182.includes("discovery_plan"));
assert.ok(smartIntakeV0182.includes("Etsy Shop ID override"));
assert.ok(smartIntakeV0182.includes("SKU mapping override"));
assert.ok(smartIntakeV0182.includes("automatic discovery fails"));
assert.ok(smartIntakeV0182.includes("autoMap:!Object.keys(parsedSkuMap).length"));
assert.ok(smartIntakeV0182.toLowerCase().includes("taxonomy"));
assert.ok(smartIntakeV0182.includes("고급 입력 — 자동처리가 실패할 때만"));
assert.ok(smartIntakeV0182.includes("🤖 시스템이 자동으로 처리할 항목"));
assert.ok(smartIntakeV0182.includes("config/client.json"));


// v0.18.3 Account Connection Gate v1 contract
const connectionV0183 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(connectionV0183.includes('const APP_VERSION = "0.52.4"'));
assert.ok(connectionV0183.includes("CREATE TABLE IF NOT EXISTS account_connections"));
assert.ok(connectionV0183.includes("CREATE TABLE IF NOT EXISTS oauth_states"));
assert.ok(connectionV0183.includes("accountProviderSpec"));
assert.ok(connectionV0183.includes("connectSquarespace"));
assert.ok(connectionV0183.includes("connectProdigi"));
assert.ok(connectionV0183.includes("startEtsyOAuth"));
assert.ok(connectionV0183.includes("finishEtsyOAuth"));
assert.ok(connectionV0183.includes("https://www.etsy.com/oauth/connect"));
assert.ok(connectionV0183.includes("https://api.etsy.com/v3/public/oauth/token"));
assert.ok(connectionV0183.includes('code_challenge_method","S256"'));
assert.ok(connectionV0183.includes("https://api.squarespace.com/1.0/authorization/website"));
assert.ok(connectionV0183.includes("https://api.sandbox.prodigi.com"));
assert.ok(connectionV0183.includes("account_connection_required"));
assert.ok(connectionV0183.includes("Account Connection Gate"));
assert.ok(connectionV0183.includes("accountConnectBtn"));
assert.ok(connectionV0183.includes("Etsy에서 연결 승인"));
assert.ok(connectionV0183.includes("고객 답변"));
assert.ok(connectionV0183.includes("계정 연결"));
assert.ok(!connectionV0183.includes('intakeField("etsy_oauth_token"'));
assert.ok(!connectionV0183.includes('intakeField("etsy_api_key"'));
assert.ok(!connectionV0183.includes('intakeField("squarespace_token"'));
assert.ok(!connectionV0183.includes('intakeField("prodigi_api_key"'));


// v0.18.4 connection cleanup
const connectionV0184 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(connectionV0184.includes('const APP_VERSION = "0.52.4"'));
assert.ok(!connectionV0184.includes('intakeField("prodigi_mode"'));
assert.ok(!connectionV0184.includes('Whether to validate through Prodigi Sandbox first'));
assert.ok(connectionV0184.includes('prodigiConn?.metadata?.mode||"sandbox"'));
assert.ok(connectionV0184.includes("ETSY_SHARED_SECRET"));
assert.ok(connectionV0184.includes("ETSY_SHARED_SECRET"));


// v0.18.5 Etsy auth header + verified OAuth
const etsyV0185 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(etsyV0185.includes('const APP_VERSION = "0.52.4"'));
assert.ok(etsyV0185.includes("ETSY_KEYSTRING"));
assert.ok(etsyV0185.includes("ETSY_SHARED_SECRET"));
assert.ok(etsyV0185.includes('"x-api-key":keystring+":"+sharedSecret'));
assert.ok(etsyV0185.includes("https://api.etsy.com/v3/application/users/me"));
assert.ok(etsyV0185.includes("Etsy API 검증에 실패"));
assert.ok(etsyV0185.includes("ETSY_KEYSTRING="));
assert.ok(etsyV0185.includes("ETSY_SHARED_SECRET="));


// v0.19.0 Contract & Payment Gate v1 contract
const dealV0190 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(dealV0190.includes('const APP_VERSION = "0.52.4"'));
assert.ok(dealV0190.includes("CREATE TABLE IF NOT EXISTS contract_payment_gates"));
assert.ok(dealV0190.includes("contractPaymentProfile"));
assert.ok(dealV0190.includes("contractPaymentReady"));
assert.ok(dealV0190.includes("getContractPaymentGate"));
assert.ok(dealV0190.includes("saveContractPaymentGate"));
assert.ok(dealV0190.includes("/deal"));
assert.ok(dealV0190.includes("dealGateBtn"));
assert.ok(dealV0190.includes("dealGateSaveBtn"));
assert.ok(dealV0190.includes("💳 계약·결제"));
assert.ok(dealV0190.includes("contract_payment_required"));
assert.ok(dealV0190.includes("계약 및 결제 확보가 먼저 필요합니다."));
assert.ok(dealV0190.includes("contract_status"));
assert.ok(dealV0190.includes("payment_status"));
assert.ok(dealV0190.includes("payment_protection"));
assert.ok(dealV0190.includes("net_estimate"));
assert.ok(dealV0190.includes("payout_destination"));
assert.ok(dealV0190.includes("계좌번호·카드번호·비밀번호·시드문구·개인키는 입력하지 마세요."));
assert.ok(dealV0190.includes("production-pipeline-v4"));
assert.ok(dealV0190.includes("job-production-bundle-v4"));
assert.ok(dealV0190.includes("Contract / Payment Gate"));

assert.ok(dealV0190.includes("계약·결제 Gate가 더 이상 준비 상태가 아닙니다."));


// v0.19.1 deal amount semantics
const dealV0191 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(dealV0191.includes('const APP_VERSION = "0.52.4"'));
assert.ok(dealV0191.includes("advertised_budget"));
assert.ok(dealV0191.includes("원문에 표시된 예산"));
assert.ok(dealV0191.includes("실제 합의 금액 / 통화 *"));
assert.ok(dealV0191.includes("이 값은 고객과 확정한 계약 금액이 아닙니다."));
assert.ok(dealV0191.includes("gross=saved?.gross_amount ?? null"));
assert.ok(dealV0191.includes('default_protection:"unknown"'));
assert.ok(dealV0191.includes("Number(gate?.gross_amount)>0"));


// v0.20.0 Manager Orchestrator v1
const managerV0200 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const wranglerV0200 = fs.readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8");
assert.ok(managerV0200.includes('const APP_VERSION = "0.52.4"'));
assert.ok(managerV0200.includes("CREATE TABLE IF NOT EXISTS manager_job_states"));
assert.ok(managerV0200.includes("managerEvaluateJob"));
assert.ok(managerV0200.includes("runManagerOrchestrator"));
assert.ok(managerV0200.includes("manager-orchestrator-v1"));
assert.ok(managerV0200.includes("/api/orchestrator/tick"));
assert.ok(managerV0200.includes("sandbox_queued"));
assert.ok(managerV0200.includes("waiting_contract_payment"));
assert.ok(managerV0200.includes("waiting_client_answers"));
assert.ok(managerV0200.includes("waiting_account_connections"));
assert.ok(managerV0200.includes("production_queued"));
assert.ok(managerV0200.includes("delivery_ready"));
assert.ok(managerV0200.includes("💰 수익 실행 대시보드"));
assert.ok(managerV0200.includes("⚙️ 고급/수동 제어"));
assert.ok(managerV0200.includes("상세보기"));
assert.ok(managerV0200.includes("client_intake_required"));
assert.ok(managerV0200.includes("account_connection_required"));
assert.ok(managerV0200.includes("Manager Orchestrator v1"));
assert.ok(wranglerV0200.includes('"47 * * * *"'));


// v0.20.1 universal sandbox acceptance harness
const sandboxV0201 = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(sandboxV0201.includes('const APP_VERSION = "0.52.4"'));
assert.ok(sandboxV0201.includes("acceptanceHarness:true"));
assert.ok(sandboxV0201.includes("acceptance_harness"));
assert.ok(sandboxV0201.includes("code-worker-v2.2"));
assert.ok(sandboxV0201.includes("A passing sandbox is a preflight result"));
assert.ok(!sandboxV0201.includes('status:"not_applicable",files:[],test_execution:"not_requested"'));


// v0.21.0 consolidated application center
const appCenterV0210=fs.readFileSync(new URL("./worker.js",import.meta.url),"utf8");
assert.ok(appCenterV0210.includes('const APP_VERSION = "0.52.4"'));
assert.ok(appCenterV0210.includes("function applicationDraft"));
assert.ok(appCenterV0210.includes("applicationCenterRows"));
assert.ok(appCenterV0210.includes("/api/application-center"));
assert.ok(appCenterV0210.includes("📨 지원센터"));
assert.ok(appCenterV0210.includes("proposal:plan.proposal_draft"));
assert.ok(appCenterV0210.includes("bid_amount:bidAmount"));
assert.ok(appCenterV0210.includes("delivery_days:deliveryDays"));
assert.ok(appCenterV0210.includes("auto_submit_supported:false"));
assert.ok(appCenterV0210.includes("requires_human_submit:true"));
assert.ok(appCenterV0210.includes("지원 페이지 열기"));

// v0.21.1 realistic application estimates
const v0211=fs.readFileSync(new URL("./worker.js",import.meta.url),"utf8");
assert.ok(v0211.includes('const APP_VERSION = "0.52.4"'));
assert.ok(v0211.includes("scopeMultiplier"));
assert.ok(v0211.includes("effective_estimated_hours"));
assert.ok(v0211.includes("externalBuffer"));
assert.ok(v0211.includes("deliveryDays=Math.max(2"));
assert.ok(v0211.includes("automated access/submission is not enabled without express permission"));

// v0.22.0 application shortlist
const v0220=fs.readFileSync(new URL("./worker.js",import.meta.url),"utf8");
assert.ok(v0220.includes("function applicationPriority"));
assert.ok(v0220.includes("value_per_hour"));
assert.ok(v0220.includes("slice(0,3)"));
assert.ok(v0220.includes("held_count"));
assert.ok(v0220.includes("우선지원"));

// v0.22.1 revenue-first dashboard
const v0221=fs.readFileSync(new URL("./worker.js",import.meta.url),"utf8");
assert.ok(v0221.includes("💰 수익 실행 대시보드"));
assert.ok(v0221.includes("🔎 Money Scout 탐색 현황 보기"));
assert.ok(v0221.includes("loadPaidJobs().catch"));
assert.ok(v0221.includes("actionableHumanCount"));
assert.ok(v0221.includes("자동보류"));
assert.ok(!v0221.includes('id="paidJobsBtn"'));

// v0.22.2 focus dashboard
const v0222 = workerSource;
assert.ok(v0222.includes('const APP_VERSION = "0.52.4"'));
assert.ok(v0222.includes("📦 전체 유료 일감 '+rows.length+'개 보기"));
assert.ok(v0222.includes("평소에는 열어볼 필요 없습니다."));

// v0.23.0 delivery-risk gate
const v0230 = workerSource;
assert.ok(v0230.includes("delivery_risk_gate"));
assert.ok(v0230.includes("automation_completion_ratio"));
assert.ok(v0230.includes("unsafe_delivery_window"));
assert.ok(v0230.includes("!x.draft.priority.hard_hold"));


// v0.46.0 delivery approval gate static regression checks
{
  const workerSource = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  assert.match(workerSource, /CREATE TABLE IF NOT EXISTS delivery_approvals/);
  assert.match(workerSource, /async function getDeliveryApproval/);
  assert.match(workerSource, /async function approveDelivery/);
  assert.match(workerSource, /awaiting_delivery_approval/);
  assert.match(workerSource, /external_actions_allowed:false/);
  assert.ok(workerSource.includes("const deliveryMatch=path.match(/^\\/api\\/paid-jobs\\/([^/]+)\\/delivery$/);"));
}

// v0.46.0 approved Freelancer delivery send static regression checks
{
  const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  assert.ok(workerSource.includes("async function sendFreelancerDelivery(env,row)"));
  assert.ok(workerSource.includes('delivery.status!=="approved"'));
  assert.ok(workerSource.includes('"freelancer:delivery:"+row.opportunity_id+":"+delivery.production_run_id'));
  assert.ok(workerSource.includes("'delivery_message','confirmed'"));
  assert.ok(workerSource.includes('stage:"delivery_sent"'));
  assert.ok(workerSource.includes('last_action:sent.duplicate?"delivery_already_sent":"delivery_sent"'));
}

// v0.46.0 post-delivery feedback regression checks
{
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(workerSource.includes("function classifyClientFeedback(text)"));
 assert.ok(workerSource.includes("async function getPostDeliveryFeedback(env,row)"));
 assert.ok(workerSource.includes('stage:"revision_requested"'));
 assert.ok(workerSource.includes('stage:"client_accepted"'));
 assert.ok(workerSource.includes('stage:"client_feedback"'));
 assert.ok(workerSource.includes('next_action:"수정 요청 검토 후 재작업 승인"'));
}

// v0.46.0 revision approval/rework regression checks
{
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(workerSource.includes("CREATE TABLE IF NOT EXISTS revision_approvals"));
 assert.ok(workerSource.includes("async function getRevisionApproval(env,row)"));
 assert.ok(workerSource.includes("async function approveRevision(env,row,body={})"));
 assert.ok(workerSource.includes("plan.revision_request={feedback_message_id:revision.feedback_message_id,instructions:revision.feedback_body}"));
 assert.ok(workerSource.includes('stage:"revision_approved"'));
 assert.ok(workerSource.includes('stage:"revision_running"'));
 assert.ok(workerSource.includes("revisionMatch=path.match"));
}

// v0.46.0 verified payment outcome regression checks
{
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(workerSource.includes('["released","paid"].includes'));
 assert.ok(workerSource.includes("UPDATE contract_payment_gates SET payment_status="));
 assert.ok(workerSource.includes("released.length"));
 assert.ok(workerSource.includes("INSERT INTO opportunity_outcomes"));
 assert.ok(workerSource.includes("Verified Freelancer milestone release"));
 assert.ok(workerSource.includes('stage:"paid_complete"'));
 assert.ok(workerSource.includes('last_action:"payment_verified"'));
}

// v0.46.0 revision production and run-specific delivery regression checks
{
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 const revisionPos=workerSource.indexOf("if(revision)plan.revision_request=");
 const builderPos=workerSource.indexOf("plan.factory_builder=factoryBuilder(plan)", revisionPos);
 assert.ok(revisionPos>0 && builderPos>revisionPos, "revision context must be attached before production builders run");
 assert.ok(workerSource.includes('const deliveryKey="freelancer:delivery:"+id+":"+latestProduction.run_id'));
 assert.ok(workerSource.includes("WHERE action_key=? AND provider="));
 assert.ok(workerSource.includes("revision_request:plan?.revision_request||null"));
}

// v0.46.0 live qualification/scope safety regression checks
{
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(workerSource.includes('proofRequirements.push("live_work_links")'));
 assert.ok(workerSource.includes('proofRequirements.push("portfolio_evidence")'));
 assert.ok(workerSource.includes('proofRequirements.push("mandatory_qualification_evidence")'));
 assert.ok(workerSource.includes('integrationDependencies.push("existing_business_system")'));
 assert.ok(workerSource.includes('reasons.push("scope_time_underestimate")'));
 assert.ok(workerSource.includes('reasons.push("qualification_proof_required")'));
 assert.ok(workerSource.includes('requires_human_qualification_review:qualificationHardHold'));
 assert.ok(workerSource.includes('const hardHold=qualificationHardHold||'));
}

// v0.46.0 live-site complex scope and attachment safety checks
{
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(workerSource.includes('scopeSignals.push("live_site_implementation")'));
 assert.ok(workerSource.includes('scopeSignals.push("multi_page_scope")'));
 assert.ok(workerSource.includes('scopeSignals.push("cross_device_validation")'));
 assert.ok(workerSource.includes('scopeSignals.push("content_design_implementation_combo")'));
 assert.ok(workerSource.includes('attachmentSignals.push("unverified_attachment")'));
 assert.ok(workerSource.includes('reasons.push("attachment_not_verified")'));
 assert.ok(workerSource.includes('"complex_scope_review_gate"'));
 assert.ok(workerSource.includes('requires_attachment_review:attachmentHardHold'));
}

// v0.46.0 independent delivery safety gate
{
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(workerSource.includes('externalWorkspaceSignals.push("managed_saas_workspace")'));
 assert.ok(workerSource.includes('externalWorkspaceSignals.push("client_workspace_changes")'));
 assert.ok(workerSource.includes('externalWorkspaceSignals.push("workspace_configuration")'));
 assert.ok(workerSource.includes('reasons.push("external_workspace_not_independently_deliverable")'));
 assert.ok(workerSource.includes('"independent_delivery_gate"'));
 assert.ok(workerSource.includes('requires_independent_delivery_review:independentDeliveryHardHold'));
}

// v0.46.0 self-contained deliverable / client runtime gate
{
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(workerSource.includes('environmentDependencySignals.push("client_runtime_access")'));
 assert.ok(workerSource.includes('environmentDependencySignals.push("live_runtime_diagnostics")'));
 assert.ok(workerSource.includes('environmentDependencySignals.push("live_performance_acceptance")'));
 assert.ok(workerSource.includes('externalWorkspaceSignals.length>0||environmentDependencySignals.length>0'));
 assert.ok(workerSource.includes('environment_dependency_signals:environmentDependencySignals'));
 assert.ok(workerSource.includes('requires_client_environment_review:environmentDependencySignals.length>0'));
}

// v0.46.0 Manager eligibility alignment regression checks
{
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(workerSource.includes('if(managerPriority.hard_hold)return managerSaveState'));
 assert.ok(workerSource.includes('stage:"auto_held"'));
 assert.ok(workerSource.includes('last_action:"manager_safety_hold"'));
 assert.ok(workerSource.includes('maxActions=3,limit=100'));
 assert.ok(workerSource.includes('runManagerOrchestrator(env,{maxActions:3,limit:100})'));
 assert.ok(workerSource.includes('limit:Number(body.limit??100)'));
}

// v0.46.0 dashboard state alignment
{
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(workerSource.includes("body:JSON.stringify({max_actions:2,limit:100})"));
 assert.ok(workerSource.includes("const safetyHeldCount=rows.filter(j=>j.manager_stage==='auto_held').length"));
 assert.ok(workerSource.includes("const heldApplicationCount=applicationHeldCount+safetyHeldCount"));
 assert.ok(workerSource.includes("지원/안전게이트 '+heldApplicationCount+'건은 Manager가 자동보류 중입니다."));
}

// v0.46.0 auto-hold diagnostics
{
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(workerSource.includes("const holdDiagnostics={qualification:0,attachment:0,independent_delivery:0,complex_scope:0,delivery_risk:0,other:0}"));
 assert.ok(workerSource.includes("if(j.manager_stage!=='auto_held')continue"));
 assert.ok(workerSource.includes("<b>자동보류 진단</b>"));
 assert.ok(workerSource.includes("고객환경의존 '+holdDiagnostics.independent_delivery"));
}

// v0.47.0 regression: client hosting/domain and synchronous handover are hard-held; auto-bid rechecks safety.
{
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(workerSource.includes('client_hosting_or_domain'), "client hosting/domain dependency gate missing");
 assert.ok(workerSource.includes('synchronous_handover_required'), "synchronous handover gate missing");
 assert.ok(workerSource.includes('prebid_safety_hold'), "pre-bid safety recheck missing");
}

// v0.47.1 regression: existing client sites and platform eligibility restrictions block auto-bid.
{
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(workerSource.includes("existing_client_site_change"));
 assert.ok(workerSource.includes("preferred_freelancer_required"));
 assert.ok(workerSource.includes("selected_freelancer_restriction"));
}

// v0.48.0 factory-first discovery regression.
{
 const sourceText=fs.readFileSync(new URL("./sources.js", import.meta.url),"utf8");
 const workerSource=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(sourceText.includes("const pages = 12"));
 assert.ok(sourceText.includes("strategy:\"realizable_revenue_v2\""));
 assert.ok(sourceText.includes("discoveryScore"));
 assert.ok(workerSource.includes('const APP_VERSION = "0.52.4"'));
}

// v0.49.0 realizable-revenue scoring regression.
{
 const judgeSource=fs.readFileSync(new URL("./judge.js", import.meta.url),"utf8");
 const sourceText=fs.readFileSync(new URL("./sources.js", import.meta.url),"utf8");
 assert.ok(judgeSource.includes("payout.score * 0.12"));
 assert.ok(judgeSource.includes("automation * 0.28"));
 assert.ok(judgeSource.includes("speed * 0.24"));
 assert.ok(judgeSource.includes("scale * 0.18"));
 assert.ok(judgeSource.includes('!["no_reward"].includes(payout.status)'));
 assert.ok(sourceText.includes('strategy:"realizable_revenue_v2"'));
 assert.ok(sourceText.includes("const items = all.filter"));
}

// v0.49.1 compliant multi-source channel registry.
{
 const sourceText=fs.readFileSync(new URL("./sources.js", import.meta.url),"utf8");
 assert.ok(sourceText.includes("REVENUE_CHANNEL_REGISTRY"));
 assert.ok(sourceText.includes('upwork_marketplace: { mode:"request", automation:"official_api_auth_required"'));
 assert.ok(sourceText.includes('kmong_services: { mode:"seller_service", automation:"manual_official_channel", scout:false, scraping:false }'));
 assert.ok(sourceText.includes('wishket_projects: { mode:"request", automation:"public_readonly_scout_manual_apply", scout:true'));
 assert.ok(sourceText.includes('soomgo_requests: { mode:"request", automation:"paid_quote_manual_review"'));
 assert.ok(sourceText.includes("revenueChannelStatus"));
}

// v0.50.0 subscription candidate memory regression.
{
 const schema=fs.readFileSync(new URL("./schema.sql", import.meta.url),"utf8");
 assert.ok(schema.includes("CREATE TABLE IF NOT EXISTS subscription_candidates"));
 assert.ok(schema.includes("signal_count INTEGER NOT NULL DEFAULT 0"));
 assert.ok(schema.includes("source_count INTEGER NOT NULL DEFAULT 0"));
 assert.ok(schema.includes("repeatability_score INTEGER NOT NULL DEFAULT 0"));
 assert.ok(schema.includes("autonomous_fit_score INTEGER NOT NULL DEFAULT 0"));
 assert.ok(schema.includes("subscription_score INTEGER NOT NULL DEFAULT 0"));
}

// v0.50.0 repeated-demand subscription miner.
{
 const worker=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(worker.includes("function subscriptionCategory(row)"));
 assert.ok(worker.includes("async function mineSubscriptionCandidates(env)"));
 assert.ok(worker.includes("signalCount<2"));
 assert.ok(worker.includes("repeatability*.55+autonomous*.45"));
 assert.ok(worker.includes("subscription_mining = await mineSubscriptionCandidates(env)"));
 assert.ok(worker.includes('const APP_VERSION = "0.52.4"'));
}

// v0.50.1 multi-platform connection center.
{
 const worker=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 for(const provider of ['provider:"upwork"','provider:"kmong"','provider:"wishket"','provider:"soomgo"']) assert.ok(worker.includes(provider));
 assert.ok(worker.includes("UPWORK_ACCESS_TOKEN"));
 assert.ok(worker.includes("공식 API 자격과 OAuth가 검증되기 전 검색·지원 자동화 비활성"));
 assert.ok(worker.includes("비공식 크롤링/자동게시 금지"));
 assert.ok(worker.includes('const APP_VERSION = "0.52.4"'));
}

// v0.51.0 Wishket public read-only micro-job scout.
{
 const sources=fs.readFileSync(new URL("./sources.js", import.meta.url),"utf8");
 const worker=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(sources.includes("export async function collectWishketProjects"));
 assert.ok(sources.includes("wishket_public_micro_v1"));
 assert.ok(sources.includes("wishket_projects: collectWishketProjects"));
 assert.ok(sources.includes('write_actions:false'));
 assert.ok(worker.includes('const APP_VERSION = "0.52.4"'));
 assert.ok(worker.includes("공개 프로젝트 읽기만 자동화"));
}

// v0.51.1 multi-platform external integration hard hold regression.
{
 const worker=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(worker.includes("multi_platform_marketplace_posting"));
 assert.ok(worker.includes("multi_platform_external_integration"));
 assert.ok(worker.includes("autotrader|ebay|gumtree|facebook marketplace|friday ad|drive mart"));
 assert.ok(worker.includes('const APP_VERSION = "0.52.4"'));
}

// v0.52.0 source diagnostics dashboard.
{
 const worker=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(worker.includes('id="sourceDiagnostics"'));
 assert.ok(worker.includes("위시켓 · 공개링크"));
 assert.ok(worker.includes("Micro 후보"));
 assert.ok(worker.includes('value="wishket_projects"'));
 assert.ok(worker.includes('const APP_VERSION = "0.52.4"'));
}

// v0.52.1 Freelancer budget runtime regression.
{
 const sources=fs.readFileSync(new URL("./sources.js", import.meta.url),"utf8");
 const worker=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(sources.includes("const b = x.budget || {};"));
 assert.ok(sources.includes("budget_min: num(b.minimum)"));
 assert.ok(sources.includes("budget_max: num(b.maximum)"));
 assert.ok(worker.includes('const APP_VERSION = "0.52.4"'));
}

// v0.52.2 runtime/build diagnostics.
{
 const worker=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(worker.includes('const BUILD_ID = "v0.52.4-scan-state-diagnostics-20261001"'));
 assert.ok(worker.includes('source:"runtime",diagnostic:{app_version:APP_VERSION,build_id:BUILD_ID'));
 assert.ok(worker.includes("실행코드 '+(d.app_version||'?')+' · 빌드"));
 assert.ok(worker.includes('const APP_VERSION = "0.52.4"'));
}

// v0.52.3 hourly Money Scout cadence.
{
 const cfg=fs.readFileSync(new URL("./wrangler.jsonc", import.meta.url),"utf8");
 const worker=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(cfg.includes('"17 * * * *"'));
 assert.ok(cfg.includes('"47 * * * *"'));
 assert.ok(!cfg.includes('"17 */6 * * *"'));
 assert.ok(worker.includes('const APP_VERSION = "0.52.4"'));
}

// v0.52.4: dashboard reads must not launch Scout; unfinished runs must not masquerade as completed zero-result scans.
{
 const worker=fs.readFileSync(new URL("./worker.js", import.meta.url),"utf8");
 assert.ok(worker.includes("WHERE finished_at<>'' ORDER BY started_at DESC LIMIT 1"));
 assert.ok(worker.includes("WHERE finished_at='' ORDER BY started_at DESC LIMIT 1"));
 assert.ok(worker.includes("Collection is cron-owned. Read-only dashboard requests must never create Scout runs."));
 assert.ok(worker.includes("const runtimeDiagnostic="));
 assert.ok(worker.includes("JSON.stringify([runtimeDiagnostic, ...collected.errors"));
 assert.ok(!worker.includes("collected.errors.unshift({source:\"runtime\""));
 assert.ok(worker.includes("Money Scout는 매시간 자동 수집됩니다."));
}
