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
 const desktopOrder=await evaluate(`(()=>{
  const main=document.querySelector('.editor-main');
  const children=[...main.children];
  const where=id=>children.findIndex(el=>el.matches(id));
  return [where('.timeline-wrap'),where('#v2-clip-settings'),where('#v2-editor')];
 })()`);
 assert.ok(desktopOrder[0]>=0&&desktopOrder[0]<desktopOrder[1]&&desktopOrder[1]<desktopOrder[2],
  'desktop scenes precede clip properties and precision timeline: '+desktopOrder);
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
 const mobileOrder=await evaluate(`(()=>{
  const main=document.querySelector('.editor-main');
  return ['.timeline-wrap','#mobile-clip-details','.properties','#v2-clip-settings','#v2-editor']
   .map(selector=>[...main.children].findIndex(x=>x.matches(selector)));
 })()`);
 assert.ok(mobileOrder.every((value,i)=>value>=0&&(i===0||value>mobileOrder[i-1])),
  'mobile scenes precede detail controls and precision timeline: '+mobileOrder);

 assert.equal(await evaluate('document.getElementById("guest-link-btn")===null'),true,'temporary invite button removed');
 assert.equal(await evaluate('document.getElementById("studio-user-email").textContent.length>0'),true);
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
 // Long AI results place the real Apply/Cancel controls before the scenes,
 // instead of hiding the actions beneath the persistent bottom menu.
 await evaluate(`(()=>{
   const review=document.getElementById("ai-draft-review");
   review.hidden=false;
   document.getElementById("ai-review-scenes").innerHTML="<p>긴 기획 결과 확인</p>".repeat(65);
 })()`);
 const aiLayout=await evaluate(`(()=>{
   const actions=document.querySelector("#ai-draft-review>.ai-controls");
   const scenes=document.getElementById("ai-review-scenes");
   const draft=document.getElementById("ai-draft-review");
   return {
     actionsOrder:Number(getComputedStyle(actions).order),
     scenesOrder:Number(getComputedStyle(scenes).order),
     actionsPosition:getComputedStyle(actions).position,
     reviewDisplay:getComputedStyle(draft).display,
     actionWidth:actions.getBoundingClientRect().width,
     containerWidth:draft.getBoundingClientRect().width,
     bottomPadding:parseFloat(getComputedStyle(document.getElementById("ai-workflow")).paddingBottom)
   };
 })()`);
 assert.equal(aiLayout.reviewDisplay,'flex');
 assert.ok(aiLayout.actionsOrder<aiLayout.scenesOrder,'AI actions precede long scene list');
 assert.equal(aiLayout.actionsPosition,'sticky','AI action bar stays available while reading scenes');
 assert.ok(aiLayout.actionWidth<=aiLayout.containerWidth+1,'AI actions fit mobile width');
 assert.ok(aiLayout.bottomPadding>=100,'AI section leaves space above fixed nav');
 await evaluate('document.getElementById("ai-draft-review").hidden=true');

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
 assert.equal(await evaluate('getComputedStyle(document.querySelector("#studio>.layout")).overflowY'),"visible",'mobile tool pane must not have a nested scrollbar');
 assert.equal(await evaluate('getComputedStyle(document.documentElement).overflowY'),"auto",'document owns mobile scroll');
 assert.ok(await evaluate('document.documentElement.scrollHeight')>844,'tool content grows below viewport');
 await evaluate('window.scrollTo(0,500)');
 await new Promise(r=>setTimeout(r,200));
 const dockTop=await evaluate('document.getElementById("mobile-preview-dock").getBoundingClientRect().top');
 assert.ok(Math.abs(dockTop)<6,'sticky preview remains pinned, top='+dockTop);
 await evaluate('document.querySelector("[data-mobile-tab=captions]").click()');
 await new Promise(r=>setTimeout(r,150));
 assert.ok(await evaluate('window.scrollY')<6,'switching tools returns to beginning');
 // Integrated second workspace: edit a blog draft, save it, reload it and
 // return to the original video editor without destroying video state.
 await evaluate('document.getElementById("workspace-blog").click()');
 await waitUntil(async()=>await evaluate('document.getElementById("blog-workspace").hidden===false&&Boolean(document.querySelector("#blog-blocks textarea"))'));
 // Save a handwritten style example, select it, reload from API, and keep editor operational.
 await waitUntil(async()=>await evaluate('Boolean(document.getElementById("blog-style-picker"))'));
 await evaluate(`(()=>{
  const sample='내가 쓰는 글은 거창하지 않다. 직접 본 것을 담백하게 적고 나중에 다시 읽어도 어색하지 않으면 된다. '.repeat(8);
  document.getElementById('blog-style-name').value='나의 일상 말투';
  document.getElementById('blog-style-content').value=sample;
  document.getElementById('blog-style-save').click();
 })()`);
 await waitUntil(async()=>await evaluate('document.getElementById("blog-style-status").textContent.includes("저장했습니다")'));
 const sampleState=await evaluate(`(()=>{
  const select=document.getElementById('blog-style-picker');
  return {count:select.options.length,selected:select.value,custom:select.selectedOptions[0].textContent};
 })()`);
 assert.equal(sampleState.count,2);
 assert.match(sampleState.selected,/^[0-9a-f]{24}$/);
 assert.equal(sampleState.custom,'나의 일상 말투');
 const samplesResult=await fetch(base+'/api/blog/writing-samples',{headers:{Cookie:cookie}});
 assert.equal(samplesResult.status,200);
 assert.equal((await samplesResult.json()).samples[0].id,sampleState.selected);

 assert.equal(await evaluate('document.getElementById("mobile-navigation").getBoundingClientRect().height'),0);
 await evaluate('document.getElementById("blog-title").value="스튜디오 블로그 시험 글";document.getElementById("blog-title").dispatchEvent(new Event("input",{bubbles:true}))');
 await evaluate('document.querySelector("#blog-blocks textarea").value="사진과 영상 프로젝트를 보존하면서 글을 작성합니다.";document.querySelector("#blog-blocks textarea").dispatchEvent(new Event("input",{bubbles:true}))');
 await evaluate(`(()=>{
  const toolbar=document.querySelector('#blog-blocks .blog-style-toolbar');
  const font=toolbar.querySelector('select[aria-label="글씨체"]');font.value='serif';font.dispatchEvent(new Event('change'));
  const size=toolbar.querySelector('select[aria-label="글자 크기"]');size.value='24';size.dispatchEvent(new Event('change'));
  const color=toolbar.querySelector('input[type="color"]');color.value='#aa1144';color.dispatchEvent(new Event('input'));
  toolbar.querySelector('button[title="굵게"]').click();
  toolbar.querySelector('button[title="기울임"]').click();
  toolbar.querySelector('.blog-emoji-toggle').click();
  toolbar.querySelector('.blog-emoji-palette button').click();
  document.querySelector('[data-blog-add="heading"]').click();
  const heading=document.querySelectorAll('#blog-blocks textarea')[1];heading.value='별도의 제목 스타일';
  heading.dispatchEvent(new Event('input',{bubbles:true}));
 })()`);
 const blogStyle=await evaluate(`(()=>{
  const p=document.querySelector('#blog-preview p:not(.blog-preview-summary)');
  const h=document.querySelector('#blog-preview h2');
  const first=document.querySelector('#blog-blocks .blog-style-toolbar');
  return {size:getComputedStyle(p).fontSize,color:getComputedStyle(p).color,weight:getComputedStyle(p).fontWeight,
   italic:getComputedStyle(p).fontStyle,headingSize:getComputedStyle(h).fontSize,
   paletteClosed:first.querySelector('.blog-emoji-palette').hidden,hasEmoji:p.textContent.includes('😀')};
 })()`);
 assert.equal(blogStyle.size,'24px');
 assert.equal(blogStyle.color,'rgb(170, 17, 68)');
 assert.equal(blogStyle.weight,'700');
 assert.equal(blogStyle.italic,'italic');
 assert.equal(blogStyle.headingSize,'28px','other blocks keep their own default');
 assert.equal(blogStyle.hasEmoji,true);
 assert.equal(blogStyle.paletteClosed,true);
 await evaluate('document.querySelector(\'[data-blog-add="image"]\').click()');
 await waitUntil(async()=>await evaluate('document.querySelector("#blog-image-dialog").open&&document.querySelectorAll(".blog-image-option").length>0'));
 await evaluate('document.querySelector(".blog-image-option").click()');
 await evaluate(`(()=>{
  const row=document.querySelector('.blog-image-layout-controls');
  const width=row.querySelector('input[aria-label="사진 크기"]');
  const align=row.querySelector('select[aria-label="사진 정렬"]');
  const spacing=row.querySelector('input[aria-label="사진 여백"]');
  width.value='35';width.dispatchEvent(new Event('input',{bubbles:true}));
  align.value='right';align.dispatchEvent(new Event('change',{bubbles:true}));
  spacing.value='12';spacing.dispatchEvent(new Event('input',{bubbles:true}));
 })()`);
 const photoLayout=await evaluate(`(()=>{
  const figure=document.querySelector('#blog-preview figure');
  return {width:figure.style.width,left:figure.style.marginLeft,right:figure.style.marginRight,spacing:figure.style.marginTop};
 })()`);
 assert.deepEqual(photoLayout,{width:'35%',left:'auto',right:'0px',spacing:'12px'});
 assert.equal(await evaluate('document.getElementById("blog-preview").textContent.includes("스튜디오 블로그 시험 글")'),true);
 await evaluate('document.getElementById("blog-save").click()');
 await waitUntil(async()=>await evaluate('document.getElementById("blog-status").textContent.includes("저장됐습니다")'));
 const result=await fetch(base+'/api/blog/posts',{headers:{Cookie:cookie}});
 assert.equal(result.status,200);
 const blogList=(await result.json()).posts;
 assert.equal(blogList[0].title,'스튜디오 블로그 시험 글');
 const savedBlog=await fetch(base+'/api/blog/posts/'+blogList[0].id,{headers:{Cookie:cookie}});
 const savedBody=(await savedBlog.json()).post;
 assert.equal(savedBody.blocks[0].style.font,'serif');
 assert.equal(savedBody.blocks[0].style.size,24);
 assert.equal(savedBody.blocks[0].style.bold,true);
 assert.equal(savedBody.blocks[0].style.italic,true);
 assert.equal(savedBody.blocks[1].style.size,28);
 assert.deepEqual(savedBody.blocks[2].layout,{width:35,align:'right',spacing:12});
 await evaluate(`(()=>{
  window.__blogExportBlob=null;
  const create=URL.createObjectURL;
  URL.createObjectURL=function(blob){window.__blogExportBlob=blob;return create.call(URL,blob);};
  document.getElementById('blog-export-html').click();
 })()`);
 await waitUntil(async()=>await evaluate('window.__blogExportBlob instanceof Blob'));
 const imageExport=await evaluate('window.__blogExportBlob.text()');
 assert.match(imageExport,/width:35%;max-width:100%;margin:12px 0 12px auto;/);
 assert.match(imageExport,/<img src="data:image\//);

 // Naver publishing helper must preserve text/photo order, never auto-publish.
 await evaluate(`(()=>{
  window.__naverCopied=null;window.__naverDownloaded=null;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__naverCopied=value}}});
  const old=URL.createObjectURL;
  URL.createObjectURL=function(blob){window.__naverDownloaded=blob;return old.call(URL,blob);};
  document.getElementById('blog-naver-open').click();
 })()`);
 await waitUntil(async()=>await evaluate('document.getElementById("blog-naver-dialog").open'));
 assert.equal(await evaluate('document.querySelectorAll("#blog-naver-steps .blog-naver-step").length'),3);
 assert.equal(await evaluate('document.querySelectorAll("#blog-naver-steps .blog-naver-photo-row").length'),1);
 assert.equal(await evaluate('document.querySelectorAll("#blog-naver-steps .blog-naver-content").length'),2);
 await evaluate('document.getElementById("blog-naver-all-copy").click()');
 await waitUntil(async()=>await evaluate('Boolean(window.__naverCopied)'));
 const transferred=await evaluate('window.__naverCopied');
 assert.match(transferred,/사진과 영상 프로젝트를 보존/);
 assert.match(transferred,/\[사진 1 첨부 위치/);
 assert.match(transferred,/별도의 제목 스타일/);
 assert.ok(transferred.indexOf('별도의 제목 스타일')<transferred.indexOf('[사진 1 첨부 위치'), 'photo marker follows second text block');
 await evaluate('document.querySelector("#blog-naver-steps .blog-naver-download").click()');
 await waitUntil(async()=>await evaluate('window.__naverDownloaded instanceof Blob'));
 assert.ok(await evaluate('window.__naverDownloaded.size>500'));
 assert.equal(await evaluate('document.getElementById("blog-naver-status").textContent.includes("다운로드")'),true);
 await evaluate('document.getElementById("blog-naver-close").click()');
 assert.equal(await evaluate('document.getElementById("blog-naver-dialog").open'),false);


 await evaluate('document.getElementById("workspace-video").click()');
 assert.equal(await evaluate('document.getElementById("blog-workspace").hidden'),true);
 assert.equal(await evaluate('document.getElementById("studio").hidden'),false);
 assert.equal(await evaluate('window.__studioErrors.length'),0);
 console.log('PASS Chrome: desktop AI/video editor, MP4, mobile preview/tabs, and mobile blog editing and saving.');
}finally{
 try{ws?.close()}catch{}
 chrome.kill('SIGTERM');await new Promise(resolve=>server.close(resolve));
 await rm(temp,{recursive:true,force:true}).catch(()=>{});
}