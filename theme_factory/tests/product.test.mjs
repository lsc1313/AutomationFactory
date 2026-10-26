import test from "node:test";
import assert from "node:assert/strict";
import {validateProduct,storefrontListing} from "../product.mjs";
const sample={slug:"moon-dragon",title:"Moon Dragon",description:"Dark fantasy mobile wallpapers",wallpapers:[{file:"assets/wallpaper-01.png",width:1440,height:3200}]};
test("valid product produces unpublished listing",()=>{const p=validateProduct(sample);assert.equal(p.slug,"moon-dragon");assert.equal(storefrontListing(p).publicationStatus,"draft")});
test("blocks traversal",()=>assert.throws(()=>validateProduct({...sample,wallpapers:[{...sample.wallpapers[0],file:"../secret.png"}]})));
test("blocks duplicates",()=>assert.throws(()=>validateProduct({...sample,icons:[sample.wallpapers[0]]})));
test("rejects empty wallpapers",()=>assert.throws(()=>validateProduct({...sample,wallpapers:[]})));
