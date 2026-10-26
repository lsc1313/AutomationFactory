import { randomUUID } from "node:crypto";
export const STATES = Object.freeze(["queued","running","completed","failed","cancelled"]);
export function createJob(input, now = new Date().toISOString()) {
  if (!input || typeof input !== "object") throw new TypeError("input must be an object");
  const concept = String(input.concept ?? "").trim();
  if (!concept || concept.length > 160) throw new Error("concept must be 1-160 characters");
  const provider = String(input.provider ?? "manual").trim();
  if (!/^[a-z0-9_-]{1,40}$/i.test(provider)) throw new Error("invalid provider");
  return { id: randomUUID(), concept, provider, status: "queued", attempts: 0,
    maxAttempts: 3, costCents: 0, createdAt: now, updatedAt: now, error: null };
}
export function transition(job, next, now = new Date().toISOString()) {
  const allowed = {queued:["running","cancelled"],running:["completed","failed","queued"],failed:["queued","cancelled"],completed:[],cancelled:[]};
  if (!allowed[job.status]?.includes(next)) throw new Error(`invalid transition ${job.status} -> ${next}`);
  if (next === "running" && job.attempts >= job.maxAttempts) throw new Error("retry limit reached");
  return {...job,status:next,attempts:job.attempts+(next==="running"?1:0),updatedAt:now};
}
export function canSpend(job, additionalCents, capCents=0) {
  return Number.isInteger(additionalCents) && additionalCents >= 0 &&
    Number.isInteger(capCents) && capCents >= 0 &&
    job.costCents + additionalCents <= capCents;
}
