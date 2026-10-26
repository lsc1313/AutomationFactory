import {readFile} from "node:fs/promises";
function sizePng(b){if(b.length<24||!b.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex"))||b.toString("ascii",12,16)!=="IHDR")throw Error("invalid PNG");return {width:b.readUInt32BE(16),height:b.readUInt32BE(20),format:"png"}}
function sizeWebp(b){
 if(b.length<30||b.toString("ascii",0,4)!=="RIFF"||b.toString("ascii",8,12)!=="WEBP")throw Error("invalid WebP");
 const t=b.toString("ascii",12,16);
 if(t==="VP8X")return {width:1+b.readUIntLE(24,3),height:1+b.readUIntLE(27,3),format:"webp"};
 if(t==="VP8L"){if(b[20]!==0x2f)throw Error("invalid WebP lossless");const v=b.readUInt32LE(21);return {width:1+(v&0x3fff),height:1+((v>>>14)&0x3fff),format:"webp"}}
 if(t==="VP8 "){if(b.length<30||b[23]!==0x9d||b[24]!==0x01||b[25]!==0x2a)throw Error("invalid WebP VP8");return {width:b.readUInt16LE(26)&0x3fff,height:b.readUInt16LE(28)&0x3fff,format:"webp"}}
 throw Error("unsupported WebP encoding");
}
function sizeJpeg(b){
 if(b.length<4||b[0]!==255||b[1]!==216)throw Error("invalid JPEG");
 let p=2;
 while(p+4<=b.length){
  if(b[p]!==255)throw Error("invalid JPEG marker");
  while(b[p]===255)p++;
  const marker=b[p++];
  if(marker===0xd9||marker===0xda)break;
  if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
  if(p+2>b.length)break;
  const len=b.readUInt16BE(p);if(len<2||p+len>b.length)throw Error("truncated JPEG");
  if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
   if(len<7)throw Error("invalid JPEG frame");
   return {width:b.readUInt16BE(p+5),height:b.readUInt16BE(p+3),format:"jpeg"};
  }
  p+=len;
 }
 throw Error("JPEG dimensions not found");
}
export function inspectImage(buffer,extension){
 const ext=extension.toLowerCase().replace(/^\./,"");
 const info=ext==="png"?sizePng(buffer):ext==="webp"?sizeWebp(buffer):["jpg","jpeg"].includes(ext)?sizeJpeg(buffer):null;
 if(!info||!info.width||!info.height||info.width>20000||info.height>20000)throw Error("invalid image dimensions or format");
 return info;
}
export async function verifyAsset(file,asset){
 const buffer=await readFile(file);
 if(buffer.length>40*1024*1024)throw Error("image exceeds 40 MB");
 const info=inspectImage(buffer,asset.file.split(".").at(-1));
 if(info.width!==asset.width||info.height!==asset.height)throw Error("image dimensions mismatch: "+asset.file);
 return buffer;
}
