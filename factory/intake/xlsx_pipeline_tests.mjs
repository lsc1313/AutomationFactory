import assert from "node:assert/strict";
import {ingestXlsx} from "./xlsx_pipeline.js";

function le16(n){return Uint8Array.of(n&255,(n>>8)&255)}
function le32(n){return Uint8Array.of(n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255)}
function cat(...parts){const len=parts.reduce((s,p)=>s+p.length,0),out=new Uint8Array(len);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0}
function zipStored(files){
 const enc=new TextEncoder();const locals=[],centrals=[];let offset=0;
 for(const [name,body] of files){
  const n=enc.encode(name),d=enc.encode(body),crc=crc32(d);
  const local=cat(le32(0x04034b50),le16(20),le16(0),le16(0),le16(0),le16(0),le32(crc),le32(d.length),le32(d.length),le16(n.length),le16(0),n,d);
  locals.push(local);
  const central=cat(le32(0x02014b50),le16(20),le16(20),le16(0),le16(0),le16(0),le16(0),le32(crc),le32(d.length),le32(d.length),le16(n.length),le16(0),le16(0),le16(0),le16(0),le32(0),le32(offset),n);
  centrals.push(central);offset+=local.length;
 }
 const cd=cat(...centrals),eocd=cat(le32(0x06054b50),le16(0),le16(0),le16(files.length),le16(files.length),le32(cd.length),le32(offset),le16(0));
 return cat(...locals,cd,eocd);
}
const sheet=`<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>주문번호</t></is></c><c r="B1" t="inlineStr"><is><t>상품코드</t></is></c><c r="C1" t="inlineStr"><is><t>주문수량</t></is></c><c r="D1" t="inlineStr"><is><t>공급가</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>A-100</t></is></c><c r="B2" t="inlineStr"><is><t>SKU-9</t></is></c><c r="C2"><v>3</v></c><c r="D2"><v>12500</v></c></row>
</sheetData></worksheet>`;
const xlsx=zipStored([["xl/worksheets/sheet1.xml",sheet]]);
const result=await ingestXlsx({name:"customer_orders.xlsx",mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},xlsx);
assert.equal(result.workbook.sheet_count,1);
assert.equal(result.sheets[0].normalized_rows[0].order_id,"A-100");
assert.equal(result.sheets[0].normalized_rows[0].sku,"SKU-9");
assert.equal(result.sheets[0].normalized_rows[0].quantity,3);
assert.equal(result.sheets[0].normalized_rows[0].unit_cost,12500);
assert.equal(result.status,"needs_review");
assert.ok(result.sheets[0].plan.issues.some(x=>x.code==="DOCUMENT_TYPE_LOW_CONFIDENCE"));
assert.equal(result.sheets[0].mapping.confidence,1);
console.log("XLSX END-TO-END TESTS OK");
