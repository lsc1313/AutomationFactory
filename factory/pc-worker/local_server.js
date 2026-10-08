import {pathToFileURL} from "node:url";import http from "node:http";import {extractDocument,tesseractAvailable,popplerAvailable} from "./extractor.js";import {config,consumeTicket} from "./client.js";
const LIMITS={image:20*1024*1024,pdf:30*1024*1024,zip:50*1024*1024,other:8*1024*1024};
function limitFor(name=""){const e=String(name).toLowerCase().split(".").pop();return ["png","jpg","jpeg","webp"].includes(e)?LIMITS.image:e==="pdf"?LIMITS.pdf:e==="zip"?LIMITS.zip:LIMITS.other}
function allowedOrigin(req){const configured=String(process.env.PC_ALLOWED_ORIGIN||"").trim(),origin=String(req?.headers?.origin||"").trim();if(!origin)return "";if(!configured)return "";const allowed=configured.split(",").map(x=>x.trim()).filter(Boolean);return allowed.includes(origin)?origin:""}
function corsHeaders(req){const origin=allowedOrigin(req);return {"content-type":"application/json","cache-control":"no-store",...(origin?{"access-control-allow-origin":origin,"vary":"Origin"}:{}),"access-control-allow-headers":"content-type,x-upload-ticket","access-control-allow-methods":"GET,POST,OPTIONS"}}
function json(req,res,status,data){res.writeHead(status,corsHeaders(req));res.end(JSON.stringify(data))}
function auth(req){const token=String(process.env.PC_LOCAL_TOKEN||"");return token&&req.headers.authorization==="Bearer "+token}
async function body(req,maxBytes){const a=[];let n=0;for await(const c of req){n+=c.length;if(n>maxBytes)throw new Error("FILE_TOO_LARGE");a.push(c)}return new Uint8Array(Buffer.concat(a))}
export async function health(){return {ok:true,service:"exception-factory-pc",tesseract:await tesseractAvailable(),poppler:await popplerAvailable(),max_bytes_by_type:LIMITS}}
export function createLocalServer(){
 return http.createServer(async(req,res)=>{try{if(req.method==="OPTIONS"){if(req.headers.origin&&!allowedOrigin(req))return json(req,res,403,{ok:false,error:"origin_not_allowed"});res.writeHead(204,corsHeaders(req));return res.end()}
  if(req.url==="/health"&&req.method==="GET"){if(!auth(req))return json(req,res,401,{ok:false,error:"unauthorized"});return json(req,res,200,await health())}
  if(req.url?.startsWith("/extract")&&req.method==="POST"){if(req.headers.origin&&!allowedOrigin(req))return json(req,res,403,{ok:false,error:"origin_not_allowed"});const ticket=String(req.headers["x-upload-ticket"]||"");if(!ticket)return json(req,res,401,{ok:false,error:"upload_ticket_required"});let verified;try{verified=await consumeTicket(config(),ticket)}catch{return json(req,res,401,{ok:false,error:"upload_ticket_invalid"})}if(!verified?.ok)return json(req,res,401,{ok:false,error:verified?.error||"upload_ticket_invalid"});const u=new URL(req.url,"http://127.0.0.1"),name=u.searchParams.get("name")||"file",mode=u.searchParams.get("mode")||"ocr",bytes=await body(req,limitFor(name)),result=await extractDocument({name,bytes,mode});return json(req,res,result.error?422:200,{ok:!result.error,result})}
  return json(req,res,404,{ok:false,error:"not_found"});
 }catch(e){return json(req,res,e.message==="FILE_TOO_LARGE"?413:500,{ok:false,error:String(e?.message||e)})}})
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const port=Number(process.env.PC_LOCAL_PORT||8788),host=process.env.PC_LOCAL_HOST||"127.0.0.1";createLocalServer().listen(port,host,()=>console.log(`PC Local Intake listening http://${host}:${port}`))}
