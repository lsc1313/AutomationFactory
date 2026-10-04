import assert from "node:assert/strict";
import {scanUploadedFiles} from "./scan.js";

function le16(n){return Uint8Array.of(n&255,(n>>8)&255)}
function le32(n){return Uint8Array.of(n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255)}
function cat(...p){const n=p.reduce((s,x)=>s+x.length,0),o=new Uint8Array(n);let i=0;for(const x of p){o.set(x,i);i+=x.length}return o}
function zipStored(files){const e=new TextEncoder(),locals=[],centrals=[];let off=0;for(const [name,body] of files){const n=e.encode(name),d=e.encode(body);const l=cat(le32(0x04034b50),le16(20),le16(0),le16(0),le16(0),le16(0),le32(0),le32(d.length),le32(d.length),le16(n.length),le16(0),n,d);locals.push(l);centrals.push(cat(le32(0x02014b50),le16(20),le16(20),le16(0),le16(0),le16(0),le16(0),le32(0),le32(d.length),le32(d.length),le16(n.length),le16(0),le16(0),le16(0),le16(0),le32(0),le32(off),n));off+=l.length}const cd=cat(...centrals);return cat(...locals,cd,le32(0x06054b50),le16(0),le16(0),le16(files.length),le16(files.length),le32(cd.length),le32(off),le16(0))}

const fd=new FormData();
fd.append("files",new File(["order id,sku,qty,cost,status\nO1,A,2,10,cancelled"],"orders.csv",{type:"text/csv"}));
fd.append("files",new File(["order id,sku,qty,cost,total\nO1,A,2,12,24"],"invoice.csv",{type:"text/csv"}));
fd.append("roles",JSON.stringify({"orders.csv":"orders","invoice.csv":"invoices"}));
const r=await scanUploadedFiles(new Request("https://local/scan",{method:"POST",body:fd}));
assert.equal(r.ok,true);
assert.ok(r.scan.report);
assert.equal(r.scan.report.headline.input_lines,1);

const bundle=zipStored([
 ["orders.csv","order id,sku,qty,unit price,status\nZ1,SKU1,2,10,paid"],
 ["supplier_invoice.csv","order id,sku,qty,unit cost,total\nZ1,SKU1,2,12,24"],
 ["supplier_price_list.csv","sku,supplier unit cost\nSKU1,10"]
]);
const zfd=new FormData();
zfd.append("files",new File([bundle],"customer_bundle.zip",{type:"application/zip"}));
zfd.append("roles","{}");
const zr=await scanUploadedFiles(new Request("https://local/scan",{method:"POST",body:zfd}));
assert.equal(zr.ok,true);
assert.ok(zr.scan.report);
assert.equal(zr.scan.assembled.counts.orders,1);
assert.equal(zr.scan.assembled.counts.invoices,1);
assert.equal(zr.scan.assembled.counts.priceList,1);
assert.equal(zr.scan.report.headline.transactions_checked,1);
assert.equal(zr.scan.report.headline.potential_discrepancies,1);
assert.equal(zr.scan.report.headline.potential_money_exposure.amount,4);

console.log("SCAN API TESTS OK");
