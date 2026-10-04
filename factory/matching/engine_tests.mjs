import assert from "node:assert/strict";
import {matchRecord,matchDataset} from "./engine.js";
const targets=[
 {order_id:"ORD-100",sku:"ABC-123",description:"Blue Widget Large"},
 {order_id:"ORD-200",sku:"ZX-9",description:"Premium Cable 2m"},
 {order_id:"ORD-300",sku:"SUP-777",description:"Paper Roll"}
];
let r=matchRecord({order_id:"ORD100",sku:"ABC_123"},targets);
assert.equal(r.status,"confirmed");assert.equal(r.method,"exact_order_sku");
r=matchRecord({order_id:"",sku:"vendor777"},targets,{confirmedMappings:{vendor777:"SUP-777"}});
assert.equal(r.status,"confirmed");assert.equal(r.method,"confirmed_mapping");
r=matchRecord({order_id:"",sku:"ZX9X",description:"Premium Cable 2 meter"},targets,{candidateThreshold:.3});
assert.equal(r.status,"needs_review");assert.equal(r.auto_confirm_allowed,false);assert.equal(r.target,null);assert.ok(r.candidates.length>0);
r=matchRecord({order_id:"ORD-300",sku:"SUP-7O7"},targets);assert.equal(r.status,"confirmed");assert.equal(r.method,"exact_order_id_ocr_confusable_sku");\nr=matchRecord({order_id:"NOPE",sku:"NOTHING",description:"unknown"},targets);
assert.equal(r.status,"unmatched");
const ds=matchDataset([{order_id:"ORD-100",sku:"ABC-123"},{sku:"ZX9X",description:"Premium Cable 2 meter"}],targets,{candidateThreshold:.3});
assert.equal(ds.summary.confirmed,1);assert.equal(ds.summary.needs_review,1);
console.log("MATCHING ENGINE TESTS OK");
