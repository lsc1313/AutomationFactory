import http from "node:http";import {extractDocument,tesseractAvailable,popplerAvailable} from "./extractor.js";
const MAX=8*1024*1024;
function json(res,status,data){res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(data))}
function auth(req){const token=String(process.env.PC_LOCAL_TOKEN||"");return token&&req.headers.authorization==="Bearer "+token}
async function body(req){const a=[];let n=0;for await(const c of req){n+=c.length;if(n>MAX)throw new Error("FILE_TOO_LARGE");a.push(c)}return new Uint8Array(Buffer.concat(a))}
export async function health(){return {ok:true,service:"exception-factory-pc",tesseract:await tesseractAvailable(),poppler:await popplerAvailable(),max_bytes:MAX}}
export function createLocalServer(){
 return http.createServer(async(req,res)=>{try{
  if(req.url==="/health"&&req.method==="GET"){if(!auth(req))return json(res,401,{ok:false,error:"unauthorized"});return json(res,200,await health())}
  if(req.url?.startsWith("/extract")&&req.method==="POST"){if(!auth(req))return json(res,401,{ok:false,error:"unauthorized"});const u=new URL(req.url,"http://127.0.0.1"),name=u.searchParams.get("name")||"file",mode=u.searchParams.get("mode")||"ocr",bytes=await body(req),result=await extractDocument({name,bytes,mode});return json(res,result.error?422:200,{ok:!result.error,result})}
  return json(res,404,{ok:false,error:"not_found"});
 }catch(e){return json(res,e.message==="FILE_TOO_LARGE"?413:500,{ok:false,error:String(e?.message||e)})}})
}
if(import.meta.url===`file://${process.argv[1]?.replaceAll("\\","/")}`){const port=Number(process.env.PC_LOCAL_PORT||8788),host=process.env.PC_LOCAL_HOST||"127.0.0.1";createLocalServer().listen(port,host,()=>console.log(`PC Local Intake listening http://${host}:${port}`))}
