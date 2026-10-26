import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createJob, transition } from "./core.mjs";
const file = resolve(process.cwd(), "theme_factory/.local/jobs.json");
async function readJobs() { try { const value=JSON.parse(await readFile(file,"utf8")); if (!Array.isArray(value)) throw Error("Invalid jobs store"); return value; } catch(e) { if(e.code==="ENOENT") return []; throw e; } }
async function saveJobs(jobs) { await mkdir(dirname(file),{recursive:true}); const tmp=file+".tmp"; await writeFile(tmp,JSON.stringify(jobs,null,2)); await rename(tmp,file); }
const [cmd,...args]=process.argv.slice(2);
try {
 const jobs=await readJobs();
 if(cmd==="create") { const job=createJob({concept:args.join(" ")}); jobs.push(job); await saveJobs(jobs); console.log(JSON.stringify(job,null,2)); }
 else if(cmd==="list") console.log(JSON.stringify(jobs,null,2));
 else if(["start","complete","retry","cancel"].includes(cmd)) {
   const i=jobs.findIndex(x=>x.id===args[0]); if(i<0) throw Error("Job not found");
   const next={start:"running",complete:"completed",retry:"queued",cancel:"cancelled"}[cmd];
   jobs[i]=transition(jobs[i],next); await saveJobs(jobs); console.log(JSON.stringify(jobs[i],null,2));
 } else { console.log("Usage: node theme_factory/cli.mjs create <concept> | list | start|complete|retry|cancel <id>"); if(cmd) process.exitCode=1; }
} catch(e) { console.error(e.message); process.exitCode=1; }
