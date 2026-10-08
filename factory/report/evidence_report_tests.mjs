import assert from "node:assert/strict";
import {runSupplierAudit} from "../audit/supplier_audit.js";
import {buildEvidenceReport,buildFreeScanSummary} from "./evidence_report.js";
const audit=runSupplierAudit({
 orders:[{order_id:"O1",sku:"A",quantity:2,unit_cost:10,status:"paid"},{order_id:"O2",sku:"B",quantity:1,unit_cost:20,status:"cancelled"}],
 invoices:[{invoice_id:"I1",order_id:"O1",sku:"A",quantity:2,unit_cost:12,total:24},{invoice_id:"I2",order_id:"O2",sku:"B",quantity:1,unit_cost:20,total:20},{invoice_id:"I3",sku:"AX",description:"odd",quantity:1,unit_cost:99,total:99}],
 priceList:[{sku:"A",unit_cost:10},{sku:"B",unit_cost:20}]
},{candidateThreshold:.2});
const report=buildEvidenceReport(audit,{currency:"USD"});
assert.equal(report.headline.transactions_checked,2);
assert.equal(report.headline.potential_money_exposure.amount,24);
assert.equal(report.headline.human_review_required,1);
assert.equal(report.controls.confirmed_matches_only,true);
assert.equal(report.controls.fuzzy_matches_excluded_from_money,true);
assert.ok(report.findings.every(x=>x.finding==="potential_discrepancy"));
assert.ok(report.findings.every(x=>x.recommendation==="review_recommended"));
assert.ok(report.disclaimer.includes("not definitive"));
const free=buildFreeScanSummary(report,{detailLimit:1});
assert.equal(free.sample_findings.length,1);assert.equal(free.hidden_finding_count,1);
console.log("EVIDENCE REPORT TESTS OK");
