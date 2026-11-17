'use strict';
/* Mobile surface, independent from PC editing layout. Every button controls the
 * existing AI/editor DOM and the same project; no duplicate editing state. */
(() => {
 const query=window.matchMedia('(max-width: 900px)');
 const tabs=['edit','media','ai','captions','sound'];
 const nav=document.getElementById('mobile-navigation');
 const buttons=[...nav.querySelectorAll('[data-mobile-tab]')];
 const preview=document.querySelector('.preview-wrap');
 const main=document.querySelector('.editor-main');
 let active='edit';
 const details=document.createElement('button');
 details.id='mobile-clip-details';
 details.type='button';
 details.textContent='클립 상세 설정 펼치기';
 details.setAttribute('aria-expanded','false');
 details.className='mobile-clip-details';
 const props=document.querySelector('.properties');
 props.before(details);
 function currentTab(value){
   active=tabs.includes(value)?value:'edit';
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
   const target=value==='media'?document.querySelector('.media-panel'):
      value==='ai'?document.getElementById('ai-workflow'):
      value==='sound'||value==='captions'?preview:main;
   // Reset the viewport to the tool currently being used.
   requestAnimationFrame(()=>target?.scrollIntoView({block:'start',behavior:'instant'}));
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
   if(query.matches)currentTab(active);
   else document.body.removeAttribute('data-mobile-view');
 }
 query.addEventListener?.('change',mediaChanged);
 mediaChanged();
 // Existing render is unchanged; place the mobile-details toggle beside the player.
 if(typeof positionEditorTools==='function')positionEditorTools();
 // Exposed for browser regression checks, without storing project or user data.
 window.StudioMobile={select,getTab:()=>active};
})();
