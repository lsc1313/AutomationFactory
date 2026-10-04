function now(){return new Date().toISOString()}
function id(prefix){return prefix+"_"+crypto.randomUUID()}
export async function createIntakeJob(db,{opportunity_id="",files=[]}={}){
  const jobId=id("intake");const ts=now();
  await db.prepare("INSERT INTO intake_jobs (intake_job_id,opportunity_id,status,file_count,ready_count,review_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(jobId,String(opportunity_id||""),"received",files.length,0,0,ts,ts).run();
  const created=[];
  for(const file of files){
    const fileId=id("file");
    await db.prepare("INSERT INTO intake_files (intake_file_id,intake_job_id,file_name,mime_type,file_kind,document_type,extraction_status,confidence,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(fileId,jobId,String(file.name||""),String(file.mime||""),String(file.kind||"unknown"),String(file.document_type||"unknown"),String(file.status||"pending"),Number(file.confidence||0),JSON.stringify(file.metadata||{}),ts,ts).run();
    created.push({intake_file_id:fileId,...file});
  }
  return {intake_job_id:jobId,status:"received",files:created};
}
export async function saveIntakeResult(db,{job_id,file_id,plan,metadata={}}){
  const ts=now(),status=plan?.status||"needs_review",confidence=Number(plan?.confidence||0),doc=String(plan?.document?.document_type||"unknown");
  await db.prepare("UPDATE intake_files SET document_type=?,extraction_status=?,confidence=?,metadata_json=?,updated_at=? WHERE intake_file_id=? AND intake_job_id=?")
    .bind(doc,status,confidence,JSON.stringify(metadata),ts,file_id,job_id).run();
  for(const issue of plan?.issues||[]){
    await db.prepare("INSERT INTO intake_review_queue (review_id,intake_job_id,intake_file_id,reason_code,candidates_json,status,resolution_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id("review"),job_id,file_id,String(issue.code||"REVIEW_REQUIRED"),"[]","pending","{}",ts,ts).run();
  }
  const row=await db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN extraction_status='ready' THEN 1 ELSE 0 END) AS ready, SUM(CASE WHEN extraction_status='needs_review' THEN 1 ELSE 0 END) AS review FROM intake_files WHERE intake_job_id=?").bind(job_id).first();
  const total=Number(row?.total||0),ready=Number(row?.ready||0),review=Number(row?.review||0);
  const jobStatus=review?"needs_review":ready===total&&total>0?"ready":"processing";
  await db.prepare("UPDATE intake_jobs SET status=?,ready_count=?,review_count=?,updated_at=? WHERE intake_job_id=?").bind(jobStatus,ready,review,ts,job_id).run();
  return {intake_job_id:job_id,status:jobStatus,total,ready,review};
}
export async function confirmMapping(db,{profile_key,document_type="unknown",source_signature="",mapping={}}){
  const ts=now(),profileId=id("map");
  await db.prepare("INSERT INTO mapping_profiles (mapping_profile_id,profile_key,document_type,source_signature,mapping_json,confirmed,use_count,created_at,updated_at) VALUES (?,?,?,?,?,1,1,?,?) ON CONFLICT(profile_key) DO UPDATE SET document_type=excluded.document_type,source_signature=excluded.source_signature,mapping_json=excluded.mapping_json,confirmed=1,use_count=mapping_profiles.use_count+1,updated_at=excluded.updated_at")
    .bind(profileId,String(profile_key),String(document_type),String(source_signature),JSON.stringify(mapping),ts,ts).run();
  return {profile_key,confirmed:true};
}
