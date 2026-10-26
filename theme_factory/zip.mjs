import {verifyAsset} from "./image_qc.mjs";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,dirname,sep} from "node:path";
import {validateProduct,storefrontListing} from "./product.mjs";

const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0});
function crc32(data){let c=0xffffffff;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0}
function dosTime(){return {time:0,date:33}} // fixed 1980-01-01 for reproducibility
export function zipEntries(entries){
 const chunks=[],central=[];let offset=0;
 for(const [name,data] of entries){
  const filename=Buffer.from(name,"utf8"),payload=Buffer.isBuffer(data)?data:Buffer.from(data),crc=crc32(payload),{time,date}=dosTime();
  if(filename.length>65535||payload.length>0xffffffff)throw Error("ZIP entry too large");
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(time,10);local.writeUInt16LE(date,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(payload.length,18);local.writeUInt32LE(payload.length,22);local.writeUInt16LE(filename.length,26);
  chunks.push(local,filename,payload);
  const header=Buffer.alloc(46);header.writeUInt32LE(0x02014b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x800,8);header.writeUInt16LE(time,12);header.writeUInt16LE(date,14);header.writeUInt32LE(crc,16);header.writeUInt32LE(payload.length,20);header.writeUInt32LE(payload.length,24);header.writeUInt16LE(filename.length,28);header.writeUInt32LE(offset,42);
  central.push(header,filename);offset+=local.length+filename.length+payload.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 if(entries.length>65535||offset>0xffffffff)throw Error("ZIP too large");
 return Buffer.concat([...chunks,directory,end]);
}
export async function buildPackage(inputDir,outputFile){
 const base=resolve(inputDir),product=validateProduct(JSON.parse(await readFile(resolve(base,"product.json"),"utf8")));
 const entries=[];
 for(const asset of [...product.wallpapers,...product.icons]){
  const path=resolve(base,asset.file);
  if(!path.startsWith(base+sep))throw Error("asset outside input directory");
  const data=await verifyAsset(path,asset);
  const magicPng=data.length>=24&&data.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex"));
  const magicJpeg=data.length>=4&&data[0]===255&&data[1]===216&&data.at(-2)===255&&data.at(-1)===217;
  const magicWebp=data.length>=12&&data.toString("ascii",0,4)==="RIFF"&&data.toString("ascii",8,12)==="WEBP";
  if(!(magicPng||magicJpeg||magicWebp))throw Error("unsupported image content: "+asset.file);
  entries.push([asset.file,data]);
 }
 entries.push(["product.json",JSON.stringify(product,null,2)+"\n"],["listing.json",JSON.stringify(storefrontListing(product),null,2)+"\n"]);
 await mkdir(dirname(resolve(outputFile)),{recursive:true});await writeFile(outputFile,zipEntries(entries));
 return {output:resolve(outputFile),assets:entries.length-2};
}
