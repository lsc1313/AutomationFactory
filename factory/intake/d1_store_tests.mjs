import assert from "node:assert/strict";
import {createIntakeJob,saveIntakeResult,confirmMapping} from "./d1_store.js";
class FakeStmt{
 constructor(db,sql){this.db=db;this.sql=sql;this.args=[]} bind(...a){this.args=a;return this}
 async run(){this.db.calls.push({sql:this.sql,args:this.args});return {success:true}}
 async first(){this.db.calls.push({sql:this.sql,args:this.args});return {total:1,ready:0,review:1}}
}
class FakeDB{constructor(){this.calls=[]}prepare(sql){return new FakeStmt(this,sql)}}
if(!globalThis.crypto?.randomUUID) throw new Error("randomUUID required");
const db=new FakeDB();
const job=await createIntakeJob(db,{files:[{name:"invoice.pdf",mime:"application/pdf",kind:"pdf"}]});
assert.match(job.intake_job_id,/^intake_/);assert.equal(job.files.length,1);
const summary=await saveIntakeResult(db,{job_id:job.intake_job_id,file_id:job.files[0].intake_file_id,plan:{status:"needs_review",confidence:.6,document:{document_type:"invoice"},issues:[{code:"PDF_EXTRACTION_LOW_CONFIDENCE"}]}});
assert.equal(summary.status,"needs_review");
assert.ok(db.calls.some(x=>x.sql.includes("intake_review_queue")));
await confirmMapping(db,{profile_key:"supplier:acme:invoice",document_type:"invoice",mapping:{sku:"Item No"}});
assert.ok(db.calls.some(x=>x.sql.includes("ON CONFLICT(profile_key)")));
console.log("D1 INTAKE STORE TESTS OK");
