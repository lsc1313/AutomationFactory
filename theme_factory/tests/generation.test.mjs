import test from "node:test";
import assert from "node:assert/strict";
import {makeGenerationPlan,runGeneration} from "../generation.mjs";
test("plan has wallpaper, lockscreen and icon tasks",()=>{
 const p=makeGenerationPlan({slug:"moon-dragon",concept:"silver dragon over moon",wallpapers:2,icons:1});
 assert.deepEqual(p.tasks.map(t=>t.type),["wallpaper","wallpaper","lockscreen","icon"]);
 assert.equal(p.tasks[0].width,1440);
});
test("zero-cost mode refuses paid provider",async()=>{
 const p=makeGenerationPlan({slug:"moon",concept:"moon"});
 await assert.rejects(runGeneration(p,{costCents:1,generate:async()=>({bytes:Buffer.from("x")})}),/zero-cost/);
});
test("retries transient failure",async()=>{
 const p=makeGenerationPlan({slug:"moon",concept:"moon",wallpapers:1});
 let calls=0;
 const result=await runGeneration(p,{costCents:0,generate:async()=>{calls++;if(calls===1)throw Error("temporary");return {bytes:Buffer.from("image")}}});
 assert.equal(result.length,2);assert.equal(calls,3);
});
