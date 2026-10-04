const ext=n=>String(n||"").toLowerCase().split(".").pop();
export async function extractDocument({name,bytes,mode}){
 const e=ext(name);
 if(mode==="text"&&e==="txt")return {text:new TextDecoder().decode(bytes),confidence:1,headers:[],rows:[]};
 if(["pdf","png","jpg","jpeg","webp"].includes(e))return {error:"OCR_ENGINE_NOT_CONFIGURED",needs_setup:true,recommended:"Install/configure local OCR provider; do not guess extraction."};
 return {error:"LOCAL_EXTRACTOR_UNSUPPORTED",needs_setup:true};
}
