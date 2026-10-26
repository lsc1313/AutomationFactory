export async function reservePreviewQuota(db,{day=new Date().toISOString().slice(0,10),limit=1}={}){
 if(!db||typeof db.prepare!=="function")throw Error("D1 quota binding required");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isInteger(limit)||limit<1||limit>10)throw Error("invalid quota settings");
 const result=await db.prepare(`INSERT INTO theme_ai_daily_quota(day,used) VALUES (?1,1)
 ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used < ?2`).bind(day,limit).run();
 if(result?.success!==true)throw Error("quota storage failed");
 return Number(result.meta?.changes||0)===1;
}
