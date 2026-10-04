import assert from "node:assert/strict";
import {unzipEntries} from "./zip_reader.js";
function storedZip(name,content){
 const enc=new TextEncoder(),n=enc.encode(name),d=enc.encode(content),a=new Uint8Array(30+n.length+d.length);
 const dv=new DataView(a.buffer);dv.setUint32(0,0x04034b50,true);dv.setUint16(4,20,true);dv.setUint16(6,0,true);dv.setUint16(8,0,true);dv.setUint32(18,d.length,true);dv.setUint32(22,d.length,true);dv.setUint16(26,n.length,true);dv.setUint16(28,0,true);a.set(n,30);a.set(d,30+n.length);return a;
}
const z=storedZip("orders.csv","Order ID,SKU\nA1,S1");
const entries=await unzipEntries(z);
assert.equal(entries.length,1);assert.equal(entries[0].name,"orders.csv");
assert.match(new TextDecoder().decode(entries[0].data),/A1,S1/);
console.log("ZIP READER TESTS OK");
