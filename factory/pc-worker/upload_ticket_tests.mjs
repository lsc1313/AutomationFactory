import assert from "node:assert/strict";import {issueUploadTicket} from "./upload_ticket.js";
const rows=[];const db={prepare(sql){return {bind(...a){return {async first(){if(sql.startsWith("SELECT COUNT"))return {n:rows.filter(x=>x.worker_id===a[0]&&!x.used_at&&x.expires_at>a[1]).length};return null},async run(){if(sql.startsWith("INSERT")){rows.push({ticket_id:a[0],worker_id:a[1],file_name:a[2],expires_at:a[3],created_at:a[4],used_at:null});return {meta:{changes:1}}}return {meta:{changes:0}}}}}}};
for(let i=0;i<12;i++)await issueUploadTicket(db,{file_name:"f"+i});
await assert.rejects(()=>issueUploadTicket(db,{file_name:"blocked"}),e=>e?.code==="TOO_MANY_ACTIVE_TICKETS");
rows[0].used_at=new Date().toISOString();const t=await issueUploadTicket(db,{file_name:"allowed"});assert.ok(t.ticket_id);
console.log("PC UPLOAD TICKET TESTS OK");