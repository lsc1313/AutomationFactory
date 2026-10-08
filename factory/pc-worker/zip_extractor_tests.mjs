import assert from "node:assert/strict";
import {extractDocument} from "./extractor.js";

function le16(n){return Uint8Array.of(n&255,(n>>8)&255)}
function le32(n){return Uint8Array.of(n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255)}
function cat(...p){const n=p.reduce((s,x)=>s+x.length,0),o=new Uint8Array(n);let i=0;for(const x of p){o.set(x,i);i+=x.length}return o}
function zipStored(files){const e=new TextEncoder(),locals=[],centrals=[];let off=0;for(const [name,data] of files){const n=e.encode(name),d=data instanceof Uint8Array?data:e.encode(data);const l=cat(le32(0x04034b50),le16(20),le16(0),le16(0),le16(0),le16(0),le32(0),le32(d.length),le32(d.length),le16(n.length),le16(0),n,d);locals.push(l);centrals.push(cat(le32(0x02014b50),le16(20),le16(20),le16(0),le16(0),le16(0),le16(0),le32(0),le32(d.length),le32(d.length),le16(n.length),le16(0),le16(0),le16(0),le16(0),le32(0),le32(off),n));off+=l.length}const cd=cat(...centrals);return cat(...locals,cd,le32(0x06054b50),le16(0),le16(0),le16(files.length),le16(files.length),le32(cd.length),le32(off),le16(0))}

const bundle=zipStored([["orders.csv","a,b\n1,2"],["note.txt","hello"]]);
const r=await extractDocument({name:"bundle.zip",bytes:bundle,mode:"archive"});
assert.equal(r.archive,true);
assert.equal(r.counts.entries,2);
assert.equal(r.counts.extracted,0);
assert.equal(r.counts.skipped,2);
assert.deepEqual(r.files,[]);
console.log("PC ZIP EXTRACTOR TESTS OK");
