import test from "node:test";
import assert from "node:assert/strict";
import {inspectImage} from "../image_qc.mjs";
const png=Buffer.from("89504e470d0a1a0a0000000d49484452000005a000000c8008060000", "hex");
test("PNG dimensions",()=>assert.deepEqual(inspectImage(png,"png"),{width:1440,height:3200,format:"png"}));
test("wrong format rejected",()=>assert.throws(()=>inspectImage(png,"jpg")));
test("truncated PNG rejected",()=>assert.throws(()=>inspectImage(png.subarray(0,12),"png")));
