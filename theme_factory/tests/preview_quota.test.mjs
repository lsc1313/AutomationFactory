import test from "node:test";
import assert from "node:assert/strict";
import {reservePreviewQuota} from "../preview_quota.mjs";
test("quota allows a single reservation and blocks next",async()=>{
 let used=0;
 const db={prepare(){return {bind(){return {async run(){if(used<1){used++;return {success:true,meta:{changes:1}}}return {success:true,meta:{changes:0}}}}}}}};
 assert.equal(await reservePreviewQuota(db),true);
 assert.equal(await reservePreviewQuota(db),false);
});
test("quota fails closed without database",async()=>await assert.rejects(reservePreviewQuota(null),/required/));
