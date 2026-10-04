import assert from "node:assert/strict";
import {parseDelimited,parseJson,parseXmlFlat,parsePlainText,ingestParsedFile} from "./parsers.js";

const csv=parseDelimited("주문번호,상품코드,주문수량,공급가\nA1,S1,2,1000\nA2,S2,1,2500",{name:"orders.csv"});
assert.deepEqual(csv.headers,["주문번호","상품코드","주문수량","공급가"]);
assert.equal(csv.rows[0]["상품코드"],"S1");

const quoted=parseDelimited('Order ID,Description,Qty\nA1,"Widget, Large",2',{name:"orders.csv"});
assert.equal(quoted.rows[0].Description,"Widget, Large");

const tsv=parseDelimited("SKU\tQty\tUnit Cost\nS1\t3\t12.5",{name:"x.tsv"});
assert.equal(tsv.delimiter,"\t");
assert.equal(tsv.rows[0]["Unit Cost"],"12.5");

const json=parseJson('[{"Order ID":"A1","SKU":"S1","Qty":2,"Supplier Cost":10}]');
assert.equal(json.rows.length,1);
assert.ok(json.headers.includes("SKU"));

const xml=parseXmlFlat("<root><order><Order_ID>A1</Order_ID><SKU>S1</SKU><Qty>2</Qty></order></root>");
assert.equal(xml.rows[0].SKU,"S1");

const txt=parsePlainText("Invoice Number: INV-1\nSupplier: ACME\nTotal: 123.45");
assert.equal(txt.rows[0]["Invoice Number"],"INV-1");

const ingested=ingestParsedFile({name:"orders.csv",mime:"text/csv"},"Order ID,SKU,Qty,Supplier Cost\nA1,S1,2,10");
assert.equal(ingested.adapter_required,false);
assert.equal(ingested.normalized_rows[0].order_id,"A1");
assert.equal(ingested.normalized_rows[0].sku,"S1");
assert.equal(ingested.normalized_rows[0].quantity,"2");
assert.equal(ingested.normalized_rows[0].unit_cost,"10");

const supplier=ingestParsedFile({name:"supplier_price_list.csv",mime:"text/csv"},`sku,supplier_unit_cost\nS1,10`);assert.equal(supplier.normalized_rows[0].unit_cost,"10");\n\nconst pdf=ingestParsedFile({name:"invoice.pdf",mime:"application/pdf"},null,{extractedText:"Invoice Number INV-1 Amount Due"});
assert.equal(pdf.adapter_required,true);
assert.equal(pdf.plan.document.document_type,"invoice");

console.log("UNIVERSAL INTAKE PARSER TESTS OK");
