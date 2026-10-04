const SAFE=/[^a-zA-Z0-9._-]+/g;
export function hasObjectStorage(env){return Boolean(env?.FACTORY_FILES&&typeof env.FACTORY_FILES.put==="function")}
export function objectKey({jobId,fileId,name}){return ["intake",String(jobId||"unassigned"),String(fileId||crypto.randomUUID()),String(name||"file").replace(SAFE,"_").slice(-160)].join("/")}
export async function storeSource(env,{jobId,fileId,file}){
 if(!hasObjectStorage(env))return {stored:false,reason:"OBJECT_STORAGE_NOT_CONFIGURED"};
 const key=objectKey({jobId,fileId,name:file.name});await env.FACTORY_FILES.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type||"application/octet-stream"},customMetadata:{originalName:file.name||"file"}});
 return {stored:true,key,size:file.size,type:file.type||"application/octet-stream"};
}
export async function readSource(env,key){if(!hasObjectStorage(env))return null;return await env.FACTORY_FILES.get(key)}
export async function deleteSource(env,key){if(!hasObjectStorage(env)||!key)return false;await env.FACTORY_FILES.delete(key);return true}
