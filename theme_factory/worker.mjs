// Theme Factory production entrypoint. AI preview is disabled unless explicitly enabled.
import previewWorker from "./worker_preview.mjs";
export default {
 async fetch(request,env,ctx){
  return previewWorker.fetch(request,env,ctx);
 }
};
