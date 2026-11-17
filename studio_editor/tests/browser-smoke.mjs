/** Browser E2E smoke: AI storyboard UI remains present and v2 precision editor is usable. */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
const browser=['google-chrome','google-chrome-stable','chromium','chromium-browser'].find(cmd=>spawnSync('which',[cmd],{stdio:'ignore'}).status===0);
if(!browser){console.log('SKIP: Chromium/Chrome not available');process.exit(0)}
const temp=await mkdtemp(path.join(os.tmpdir(),'studio-browser-'));
process.env.STUDIO_DATA_DIR=temp;
const {createStudioServer}=await import('../server.mjs');
const server=createStudioServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const chrome=spawn(browser,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-allow-origins=*','--remote-debugging-port=9229','--user-data-dir='+path.join(temp,'chrome'),'about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws;const pending=new Map();let next=1;
async function waitUntil(fn,attempts=100){for(let i=0;i<attempts;i++){try{const v=await fn();if(v)return v}catch{}await sleep(200)}throw Error('browser timeout')}
function send(method,params={}){const id=next++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.error)throw Error(JSON.stringify(result.error));if(result.result?.exceptionDetails)throw Error(result.result.exceptionDetails.text);return result.result?.result?.value}
try{
 const pwd='studio_browser_test_password';
 let res=await fetch(base+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pwd})});assert.equal(res.status,201);
 res=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pwd})});assert.equal(res.status,200);
 const cookie=res.headers.get('set-cookie').split(';')[0],token=cookie.split('=')[1],csrf=(await res.json()).csrf;
 const image=path.join(temp,'test.jpg');
 const generated=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=s=640x360:d=1','-frames:v','1',image],{encoding:'utf8',timeout:20000});assert.equal(generated.status,0,generated.stderr);
 res=await fetch(base+'/api/upload?name=test.jpg',{method:'POST',headers:{'X-CSRF-Token':csrf,'Content-Type':'application/octet-stream',Cookie:cookie},body:await readFile(image)});assert.equal(res.status,201,await res.text());
 let page;
 await waitUntil(async()=>{const r=await fetch('http://127.0.0.1:9229/json/new?'+encodeURIComponent(base+'/app'),{method:'PUT'});if(!r.ok)return false;page=await r.json();return page.webSocketDebuggerUrl});
 ws=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
 ws.addEventListener('message',event=>{const response=JSON.parse(event.data);if(!response.id||!pending.has(response.id))return;const entry=pending.get(response.id);clearTimeout(entry.timer);pending.delete(response.id);entry.resolve(response)});
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Network.setCookie',{name:'studio_session',value:token,url:base+'/app',sameSite:'Strict'});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.__studioErrors=[];window.addEventListener("error",e=>window.__studioErrors.push(e.message));'});
 await send('Page.navigate',{url:base+'/app'});
 await waitUntil(async()=>await evaluate('Boolean(document.getElementById("v2-editor")&&document.querySelector("#media-list .media-item")&&window.__studioErrors?.length===0&&document.getElementById("studio").hidden===false)'));
 assert.equal(await evaluate('document.querySelectorAll("#media-list .media-item").length'),1);
 assert.equal(await evaluate('project.scenes.length'),0);
 await evaluate('document.querySelector("#media-list .media-item").click()');
 assert.equal(await evaluate('project.scenes.length'),0,'thumbnail click must not add a scene');
 assert.equal(await evaluate('document.getElementById("selected-media-panel").hidden'),false);
 await evaluate('document.getElementById("add-selected-scene").click()');
 assert.equal(await evaluate('project.scenes.length'),1);
 assert.equal(await evaluate('project.schemaVersion'),2);
 await evaluate('document.getElementById("v2-add-text").click()');
 assert.equal(await evaluate('project.textClips.length'),1);
 await evaluate('document.getElementById("v2-ratio").value="16:9";document.getElementById("v2-ratio").dispatchEvent(new Event("change"))');
 assert.equal(await evaluate('project.ratio'),'16:9');
 assert.equal(await evaluate('document.getElementById("preview-full")!==null'),true);
 assert.equal(await evaluate('document.getElementById("ai-generate")!==null'),true);
 await evaluate('document.getElementById("v2-duration").value="1.5";document.getElementById("v2-duration").dispatchEvent(new Event("change"))');
 await evaluate('document.getElementById("v2-playhead").value="500";document.getElementById("v2-playhead").dispatchEvent(new Event("input"))');
 await evaluate('document.getElementById("v2-split").click()');
 assert.equal(await evaluate('project.scenes.length'),2,'split makes two editable clips');
 await evaluate('document.getElementById("v2-repeat").click()');
 assert.equal(await evaluate('project.scenes.length'),3,'duplicate makes another clip');
 await evaluate('window.confirm=()=>true;document.getElementById("v2-remove").click()');
 assert.equal(await evaluate('project.scenes.length'),2,'delete removes only selected clip');
 await evaluate('document.getElementById("voice").value="off";document.getElementById("voice").dispatchEvent(new Event("change"))');
 await evaluate('document.getElementById("preview-full").click()');
 await waitUntil(async()=>await evaluate('document.getElementById("export-status").textContent.includes("제작 완료")'),180);
 assert.equal(await evaluate('document.getElementById("full-review").hidden'),false);
 assert.equal(await evaluate('Boolean(document.getElementById("full-video").src)'),true);
 res=await fetch(base+'/api/export/status',{headers:{Cookie:cookie}});
 const exportState=await res.json();assert.equal(exportState.status,'done');
 res=await fetch(base+'/api/export/'+exportState.filename,{headers:{Cookie:cookie,Range:'bytes=0-1023'}});
 assert.equal(res.status,206,'MP4 player supports partial content');assert.equal((await res.arrayBuffer()).byteLength,1024);
 assert.deepEqual(await evaluate('window.__studioErrors'),[]);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
 await send('Page.reload',{ignoreCache:true});
 await waitUntil(async()=>await evaluate('Boolean(document.getElementById("v2-editor")&&document.getElementById("studio")?.hidden===false)'));
 assert.equal(await evaluate('document.body.dataset.mobileView'),'project');
 assert.equal(await evaluate('getComputedStyle(document.getElementById("mobile-navigation")).display!=="none"'),true);
 assert.equal(await evaluate('getComputedStyle(document.getElementById("project-settings")).display!=="none"'),true);
 assert.equal(await evaluate('document.getElementById("project-settings").parentElement.classList.contains("layout")'),true,'project settings are not nested inside timeline');
 assert.equal(await evaluate('getComputedStyle(document.getElementById("project-settings")).overflowY'),"visible",'project settings must not have an inner scroll');

 assert.equal(await evaluate('getComputedStyle(document.querySelector(".media-panel")).display'),"none");
 await evaluate('document.querySelector("[data-mobile-tab=edit]").click()');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".editor-main")).display!=="none"'),true);
 assert.equal(await evaluate('document.querySelector(".v2-actions").getBoundingClientRect().right<=innerWidth+1'),true,'edit action grid fits viewport');
 assert.equal(await evaluate('document.querySelector(".v2-actions").scrollWidth<=document.querySelector(".v2-actions").clientWidth+1'),true,'edit buttons do not overflow');

 assert.equal(await evaluate('document.querySelector(".preview-wrap").parentElement.id'),"mobile-preview-dock");
 assert.equal(await evaluate('getComputedStyle(document.getElementById("mobile-preview-dock")).display!=="none"'),true);
 await evaluate('document.querySelector("[data-mobile-tab=media]").click()');
 assert.equal(await evaluate('document.body.dataset.mobileView'),'media');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".media-panel")).display!=="none"'),true);
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".editor-main")).display'),"none");
 await evaluate('document.querySelector("[data-mobile-tab=ai]").click()');
 assert.equal(await evaluate('getComputedStyle(document.getElementById("ai-workflow")).display!=="none"'),true);
 assert.equal(await evaluate('document.querySelector("#ai-generate")!==null'),true,'original AI stays available');
 await evaluate('document.querySelector("[data-mobile-tab=captions]").click()');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".v2-subtitle-track")).display!=="none"'),true);
 await evaluate('document.querySelector("[data-mobile-tab=sound]").click()');
 assert.equal(await evaluate('getComputedStyle(document.getElementById("project-settings")).display'),"none",'project settings must not appear under sound tracks');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".v2-audio-track")).display!=="none"'),true);
 assert.equal(await evaluate('document.getElementById("voice").closest("#mobile-sound-settings")!==null'),true,'sound tab owns real voice picker');
 assert.equal(await evaluate('document.getElementById("bgm").closest("#mobile-sound-settings")!==null'),true,'sound tab owns real BGM picker');
 assert.equal(await evaluate('getComputedStyle(document.getElementById("mobile-sound-settings")).display!=="none"'),true);
 await evaluate('document.querySelector("[data-mobile-tab=edit]").click()');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".properties")).display'),"none");
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".v2-clip-settings")).display'),"none");
 await evaluate('document.getElementById("mobile-clip-details").click()');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".properties")).display!=="none"'),true);
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".v2-clip-settings")).display!=="none"'),true);
 assert.equal(await evaluate('window.__studioErrors.length'),0);
 console.log('PASS Chrome: desktop AI and editor; full MP4; six workflow tabs, docked preview, detailed controls and 390px layout.');
}finally{
 try{ws?.close()}catch{}
 chrome.kill('SIGTERM');await new Promise(resolve=>server.close(resolve));
 await rm(temp,{recursive:true,force:true}).catch(()=>{});
}