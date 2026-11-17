'use strict';
/* Mobile surface, independent from PC editing layout. Every button controls the
 * existing AI/editor DOM and the same project; no duplicate editing state. */
(() => {
 const query=window.matchMedia('(max-width: 900px)');
 const tabs=['project','media','ai','edit','captions','sound'];
 const nav=document.getElementById('mobile-navigation');
 const buttons=[...nav.querySelectorAll('[data-mobile-tab]')];
 const preview=document.querySelector('.preview-wrap');
 const main=document.querySelector('.editor-main');
 let active='project';
 const details=document.createElement('button');
 details.id='mobile-clip-details';
 details.type='button';
 details.textContent='클립 상세 설정 펼치기';
 details.setAttribute('aria-expanded','false');
 details.className='mobile-clip-details';
 const props=document.querySelector('.properties');
 props.before(details);
 const studio=document.getElementById('studio');
 const layout=studio.querySelector('.layout');
 const dock=document.createElement('section');
 dock.id='mobile-preview-dock';
 dock.className='mobile-preview-dock';
 dock.setAttribute('aria-label','고정 영상 미리보기');
 layout.before(dock);
 function positionPreview(){
  if(query.matches){
   if(preview.parentElement!==dock)dock.append(preview);
  }else if(preview.parentElement!==main)main.querySelector('.worktop').after(preview);
 }
 function syncPreviewFrame(){
  const frame=preview.querySelector('.phone-preview');
  if(!frame)return;
  const aspect=(frame.style.aspectRatio||'9 / 16').replace(/\s/g,'');
  document.body.dataset.previewRatio=aspect==='16/9'?'landscape':aspect==='1/1'?'square':'portrait';
  const scale=Math.max(.05,frame.clientWidth/720);
  const scene=typeof project!=='undefined'&&project?.scenes?.[typeof selected!=='undefined'?selected:0];
  const clips=typeof project!=='undefined'?project?.textClips||[]:[];
  const p=typeof playhead==='undefined'?0:playhead;
  const clip=clips.find(t=>p*1000>=t.startMs&&p*1000<t.endMs&&t.text);
  const base=document.getElementById('preview-caption');
  const overlay=document.getElementById('v2-live-overlay');
  if(base)base.style.setProperty('font-size',Math.max(8,Number(scene?.captionSize||56)*scale)+'px','important');
  if(overlay)overlay.style.setProperty('font-size',Math.max(8,Number(clip?.size||50)*scale)+'px','important');
 }
 positionPreview();
 const frame=preview.querySelector('.phone-preview');
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(syncPreviewFrame).observe(frame);
 new MutationObserver(syncPreviewFrame).observe(frame,{attributes:true,attributeFilter:['style']});
 document.addEventListener('input',e=>{if(e.target.closest('.v2-editor,.properties'))requestAnimationFrame(syncPreviewFrame)});
 document.addEventListener('change',e=>{if(e.target.closest('.v2-editor,.properties'))requestAnimationFrame(syncPreviewFrame)});
 function currentTab(value){
   active=tabs.includes(value)?value:'project';
   document.body.dataset.mobileView=active;
   buttons.forEach(b=>{
     const selected=b.dataset.mobileTab===active;
     b.setAttribute('aria-current',selected?'page':'false');
     b.setAttribute('aria-pressed',selected?'true':'false');
   });
   document.body.classList.remove('mobile-details-open');
   details.textContent='클립 상세 설정 펼치기';
   details.setAttribute('aria-expanded','false');
 }
 function select(value){
   if(!query.matches)return;
   currentTab(value);
   positionPreview();
   syncPreviewFrame();
   // Scroll only the tool pane. Scrolling the whole document used to push
   // the player behind the header and left mobile overlays above controls.
   requestAnimationFrame(()=>{
     const pane=value==='ai'?document.getElementById('ai-workflow'):document.querySelector('#studio>.layout');
     if(pane)pane.scrollTop=0;
   });
 }
 for(const button of buttons)button.addEventListener('click',()=>select(button.dataset.mobileTab));
 details.addEventListener('click',()=>{
   const open=!document.body.classList.contains('mobile-details-open');
   document.body.classList.toggle('mobile-details-open',open);
   details.textContent=open?'클립 상세 설정 접기':'클립 상세 설정 펼치기';
   details.setAttribute('aria-expanded',open?'true':'false');
 });
 document.addEventListener('click',event=>{
   if(!query.matches)return;
   // New media can be added from the compact upload surface; remain in media.
   if(event.target.closest('#ai-generate'))currentTab('ai');
 });
 function mediaChanged(){
   positionPreview();
   if(query.matches){currentTab(active);syncPreviewFrame();}
   else{document.body.removeAttribute('data-mobile-view');document.body.removeAttribute('data-preview-ratio');}
 }
 query.addEventListener?.('change',mediaChanged);
 mediaChanged();
 // Existing render is unchanged; place the mobile-details toggle beside the player.
 if(typeof positionEditorTools==='function')positionEditorTools();
 // Exposed for browser regression checks, without storing project or user data.
 window.StudioMobile={select,getTab:()=>active,syncPreviewFrame};
})();
