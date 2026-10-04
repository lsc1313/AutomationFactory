import assert from "node:assert/strict";
import {handleFactoryApi} from "./handler.js";
let r=await handleFactoryApi(new Request("https://x/api/factory/health"),"/api/factory/health");assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
r=await handleFactoryApi(new Request("https://x/api/factory/audit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({orders:[{order_id:"O1",sku:"A",quantity:1,unit_cost:10}],invoices:[{invoice_id:"I1",order_id:"O1",sku:"A",quantity:1,unit_cost:12,total:12}],priceList:[{sku:"A",unit_cost:10}],currency:"USD"})}),"/api/factory/audit");
const j=await r.json();assert.equal(r.status,200);assert.equal(j.ok,true);assert.equal(j.report.headline.potential_money_exposure.amount,2);
r=await handleFactoryApi(new Request("https://x/api/factory/audit",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}),"/api/factory/audit");assert.equal(r.status,400);
console.log("FACTORY API TESTS OK");
