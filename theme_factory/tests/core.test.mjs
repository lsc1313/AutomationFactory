import test from "node:test";
import assert from "node:assert/strict";
import {createJob,transition,canSpend} from "../core.mjs";
test("creates isolated queued job",()=>{const j=createJob({concept:"Moon Dragon"});assert.equal(j.status,"queued");assert.equal(j.attempts,0)});
test("rejects empty concept",()=>assert.throws(()=>createJob({concept:" "}),/concept/));
test("enforces transitions and retry limits",()=>{let j=createJob({concept:"Moon"});for(let i=0;i<3;i++){j=transition(j,"running");j=transition(j,"queued")}assert.throws(()=>transition(j,"running"),/retry limit/);assert.throws(()=>transition(j,"completed"),/invalid transition/)});
test("zero-cost default blocks paid requests",()=>{const j=createJob({concept:"Moon"});assert.equal(canSpend(j,1),false);assert.equal(canSpend(j,0),true)});
