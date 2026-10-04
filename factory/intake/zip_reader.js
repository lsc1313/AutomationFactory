// Minimal ZIP reader for Universal Intake.
// Supports stored (method 0) entries directly and delegates DEFLATE (method 8)
// to the Web-standard DecompressionStream available in Workers.
function u16(v,o){return v[o]|(v[o+1]<<8)}
function u32(v,o){return (v[o]|(v[o+1]<<8)|(v[o+2]<<16)|(v[o+3]<<24))>>>0}
function text(v){return new TextDecoder("utf-8",{fatal:false}).decode(v)}
async function inflateRaw(bytes){
  if(typeof DecompressionStream==="undefined") throw new Error("DEFLATE_UNAVAILABLE");
  const ds=new DecompressionStream("deflate-raw");
  const out=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}
export async function unzipEntries(input,{maxEntries=200,maxUncompressedBytes=25*1024*1024}={}){
  const v=input instanceof Uint8Array?input:new Uint8Array(input);
  const out=[]; let p=0,total=0;
  while(p+30<=v.length){
    const sig=u32(v,p);
    if(sig!==0x04034b50) break;
    const flags=u16(v,p+6),method=u16(v,p+8),compressedSize=u32(v,p+18),uncompressedSize=u32(v,p+22);
    const nameLen=u16(v,p+26),extraLen=u16(v,p+28);
    if(flags&0x08) throw new Error("ZIP_DATA_DESCRIPTOR_UNSUPPORTED");
    const nameStart=p+30,dataStart=nameStart+nameLen+extraLen,dataEnd=dataStart+compressedSize;
    if(dataEnd>v.length) throw new Error("ZIP_TRUNCATED");
    const name=text(v.slice(nameStart,nameStart+nameLen));
    const directory=name.endsWith("/");
    let data=new Uint8Array();
    if(!directory){
      const packed=v.slice(dataStart,dataEnd);
      if(method===0)data=packed;
      else if(method===8)data=await inflateRaw(packed);
      else throw new Error("ZIP_METHOD_UNSUPPORTED:"+method);
      total+=data.length;
      if(total>maxUncompressedBytes) throw new Error("ZIP_UNCOMPRESSED_LIMIT");
    }
    out.push({name,directory,compressed_size:compressedSize,uncompressed_size:uncompressedSize||data.length,data});
    if(out.length>maxEntries) throw new Error("ZIP_ENTRY_LIMIT");
    p=dataEnd;
  }
  return out;
}
