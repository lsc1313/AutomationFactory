import {inspectImage} from "./image_qc.mjs";

// Optional Sharp dependency is loaded only when the image normalization stage is used.
export async function normalizeImage(bytes,task,{sharpLoader=()=>import("sharp")}={}){
 if(!Buffer.isBuffer(bytes)||!bytes.length)throw Error("empty image");
 if(!task||!Number.isInteger(task.width)||!Number.isInteger(task.height))throw Error("invalid target dimensions");
 const module=await sharpLoader();
 const sharp=module.default||module;
 const output=await sharp(bytes,{limitInputPixels:50_000_000})
  .resize(task.width,task.height,{fit:"cover",position:"attention",withoutEnlargement:false})
  .png().toBuffer();
 const actual=inspectImage(output,"png");
 if(actual.width!==task.width||actual.height!==task.height)throw Error("normalization failed: incorrect dimensions");
 return output;
}
