function now(){return new Date().toISOString()}
export async function enqueueExtraction(db,{intake_job_id="",intake_file_id="",provider="pc_ocr",mode="ocr",source_ref=""}={}){
 const id=crypto.randomUUID(),ts=now();await db.prepare("INSERT INTO extraction_jobs (extraction_job_id,intake_job_id,intake_file_id,provider,mode,status,source_ref,result_json,error_text,created_at,updated_at) VALUES (?,?,?,?,?,'queued',?,'{}','',?,?)").bind(id,intake_job_id,intake_file_id,provider,mode,source_ref,ts,ts).run();return {extraction_job_id:id,status:"queued"};
}
export async function claimExtraction(db,{provider="pc_ocr"}={}){
 const row=await db.prepare("SELECT * FROM extraction_jobs WHERE provider=? AND status='queued' ORDER BY created_at LIMIT 1").bind(provider).first();if(!row)return null;const ts=now();await db.prepare("UPDATE extraction_jobs SET status='claimed',claimed_at=?,updated_at=? WHERE extraction_job_id=? AND status='queued'").bind(ts,ts,row.extraction_job_id).run();return {...row,status:"claimed",claimed_at:ts};
}
export async function completeExtraction(db,{id,result,error=""}){
 const ts=now(),status=error?"failed":"completed";await db.prepare("UPDATE extraction_jobs SET status=?,result_json=?,error_text=?,completed_at=?,updated_at=? WHERE extraction_job_id=?").bind(status,JSON.stringify(result||{}),String(error||""),ts,ts,id).run();return {id,status};
}
