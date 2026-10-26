import test from "node:test";
import assert from "node:assert/strict";
import {createLocalCommandProvider} from "../local_provider.mjs";
test("local provider passes task through environment and captures stdout",async()=>{
 const provider=createLocalCommandProvider({command:process.execPath,args:["-e","process.stdout.write(process.env.THEME_PROMPT+'|'+process.env.THEME_WIDTH)"]});
 const result=await provider.generate({id:"wallpaper-01",prompt:"Silver moon",width:1440,height:3200});
 assert.equal(result.bytes.toString(),"Silver moon|1440");
 assert.equal(provider.costCents,0);
});
test("local provider rejects nonzero exit",async()=>{
 const provider=createLocalCommandProvider({command:process.execPath,args:["-e","process.exit(2)"]});
 await assert.rejects(provider.generate({id:"a",prompt:"b",width:1,height:1}),/exited 2/);
});
