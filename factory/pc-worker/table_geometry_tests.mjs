import assert from "node:assert/strict";
import {tableFromTsvWords} from "./table_geometry.js";
const w=(text,left,line,conf=95,width=40)=>({text,left:String(left),width:String(width),line_num:String(line),page_num:"1",block_num:"1",par_num:"1",conf:String(conf)});

const words=[
 w("SKU",10,1),w("Qty",120,1),w("Unit",230,1),w("Cost",270,1),
 w("A1",10,2),w("2",120,2),w("10.50",250,2),
 w("B2",10,3),w("3",120,3),w("9.00",250,3)
];
words.push(w("INTENTIONAL",10,4),w("TEST",120,4),w("ANOMALIES",230,4));
const t=tableFromTsvWords(words);
assert.ok(t);
assert.equal(t.rows.length,2);
assert.equal(t.rows[0].SKU,"A1");
assert.equal(t.rows[0].Qty,"2");
assert.equal(t.rows[0]["Unit Cost"],"10.50");

const invoice=[
 w("order_id",10,1,95,80),w("sku",150,1),w("qty",260,1),w("unit_price",360,1,95,90),w("line_total",520,1,95,90),
 w("A1001",10,2,95,80),w("TISSUE-O1",150,2,95,80),w("2",260,2),w("11500",360,2,95,70),w("23000",520,2,95,70),
 w("A1002",10,3,95,80),w("WIPES-01",150,3,95,80),w("4",260,3),w("5000",360,3,95,70),w("20000",520,3,95,70)
];
const it=tableFromTsvWords(invoice);
assert.ok(it);
assert.equal(it.rows.length,2);
assert.equal(it.rows[0].qty,"2");
assert.equal(it.rows[0].unit_price,"11500");
assert.equal(it.rows[0].line_total,"23000");

assert.equal(tableFromTsvWords([w("hello",10,1),w("world",80,1)]),null);
console.log("TABLE GEOMETRY TESTS OK");
