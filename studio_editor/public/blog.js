'use strict';
/* Studio Blog Editor: account-scoped block editor, portable exports and AI drafts.
 * All user content is inserted as text, never as executable HTML.
 */
(()=>{
const $=id=>document.getElementById(id);
const types={paragraph:'본문',heading:'큰 제목',subheading:'소제목',image:'사진',quote:'인용',list:'목록',divider:'구분선'};
let post=null,items=[],loaded=false,dirty=false,photoTarget=-1,previewVisible=true;

const fontOptions=[['system','기본'],['gothic','고딕'],['serif','명조'],['rounded','둥근 글씨'],['mono','고정폭']];
const fontFamilies={system:'system-ui, sans-serif',gothic:'"Malgun Gothic", "Noto Sans KR", sans-serif',serif:'"Batang", "Noto Serif KR", serif',rounded:'"Arial Rounded MT Bold", "Malgun Gothic", sans-serif',mono:'ui-monospace, Consolas, monospace'};
const emojis=['😀','😊','😍','👍','❤️','✨','🎉','🔥','✅','📌','💡','⭐','🌸','☕','📷','✈️'];
const defaultStyle=()=>({font:'system',size:16,color:'#25352F',bold:false,italic:false});
const styleOf=block=>{
 const raw=block.style||{},size=Number(raw.size);
 return {font:Object.hasOwn(fontFamilies,raw.font)?raw.font:'system',size:Number.isFinite(size)?Math.min(48,Math.max(12,Math.round(size))):block.type==='heading'?28:block.type==='subheading'?22:block.type==='quote'?18:16,color:/^#[0-9a-fA-F]{6}$/.test(raw.color||'')?raw.color:'#25352F',bold:raw.bold===true,italic:raw.italic===true};
};
const styleString=block=>{
 const st=styleOf(block);
 return 'font-family:'+fontFamilies[st.font]+';font-size:'+st.size+'px;color:'+st.color+';font-weight:'+(st.bold?'700':'400')+';font-style:'+(st.italic?'italic':'normal')+';';
};
const applyBlockStyle=(element,block)=>{
 const style=styleOf(block);
 element.style.fontFamily=fontFamilies[style.font];
 element.style.fontSize=style.size+'px';
 element.style.color=style.color;
 element.style.fontWeight=style.bold?'700':'400';
 element.style.fontStyle=style.italic?'italic':'normal';
 return element;
};
const blank=()=>({id:null,title:'',summary:'',category:'',tags:[],status:'draft',blocks:[{type:'paragraph',text:''}]});
const text=(tag,content,cls)=>{const n=document.createElement(tag);if(content!==undefined)n.textContent=content;if(cls)n.className=cls;return n;};
const escapeHtml=str=>String(str??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notify=(message,error=false)=>{const label=$('blog-status');label.textContent=message;label.dataset.error=error?'true':'false';};
const applyMeta=()=>{
 $('blog-title').value=post.title||'';
 $('blog-summary').value=post.summary||'';
 $('blog-category').value=post.category||'';
 $('blog-tags').value=(post.tags||[]).join(', ');
 $('blog-state').value=post.status==='ready'?'ready':'draft';
};
const capture=()=>{
 if(!post)return;
 post.title=$('blog-title').value;
 post.summary=$('blog-summary').value;
 post.category=$('blog-category').value;
 post.tags=$('blog-tags').value.split(',').map(t=>t.trim()).filter(Boolean).slice(0,15);
 post.status=$('blog-state').value;
};
const markDirty=()=>{dirty=true;notify('저장되지 않은 변경사항이 있습니다.');refreshPreview();};
const readMedia=async()=>{
 const x=await api('/api/library');
 return (x.media||[]).filter(m=>m.group==='image');
};
const imageLayout=block=>{
 const raw=block.layout||{},width=Number(raw.width),spacing=Number(raw.spacing);
 return {width:Number.isFinite(width)&&width>0?Math.max(20,Math.min(100,Math.round(width/5)*5)):65,
  align:['left','center','right'].includes(raw.align)?raw.align:'center',
  spacing:Number.isFinite(spacing)&&spacing>=0?Math.max(0,Math.min(64,Math.round(spacing/4)*4)):20};
};
const figureStyle=block=>{
 const layout=imageLayout(block);
 const left=layout.align==='center'?'auto':layout.align==='right'?'auto':'0';
 const right=layout.align==='center'?'auto':layout.align==='left'?'auto':'0';
 return 'width:'+layout.width+'%;max-width:100%;margin:'+layout.spacing+'px '+right+' '+layout.spacing+'px '+left+';';
};
const applyFigureStyle=(figure,block)=>{
 const layout=imageLayout(block);
 figure.style.width=layout.width+'%';
 figure.style.maxWidth='100%';
 figure.style.marginTop=layout.spacing+'px';
 figure.style.marginBottom=layout.spacing+'px';
 figure.style.marginLeft=layout.align==='left'?'0':'auto';
 figure.style.marginRight=layout.align==='right'?'0':'auto';
 return figure;
};
function photo(mediaId,alt=''){
 const img=document.createElement('img');
 img.src='/api/media/'+mediaId;img.alt=alt;img.loading='lazy';
 return img;
}
function refreshPreview(){
 if(!post)return;
 capture();
 const container=$('blog-preview');container.replaceChildren();
 container.append(text('h1',post.title||'제목을 입력하세요'));
 if(post.summary)container.append(text('p',post.summary,'blog-preview-summary'));
 for(const block of post.blocks){
  const content=block.text||'';
  if(block.type==='heading')container.append(applyBlockStyle(text('h2',content),block));
  else if(block.type==='subheading')container.append(applyBlockStyle(text('h3',content),block));
  else if(block.type==='paragraph')container.append(applyBlockStyle(text('p',content),block));
  else if(block.type==='quote')container.append(applyBlockStyle(text('blockquote',content),block));
  else if(block.type==='divider')container.append(document.createElement('hr'));
  else if(block.type==='list'){
   const ul=document.createElement('ul');
   for(const line of content.split('\n').map(x=>x.trim()).filter(Boolean))ul.append(text('li',line));
   container.append(applyBlockStyle(ul,block));
  }else if(block.type==='image'&&block.mediaId){
   const figure=document.createElement('figure');
   figure.append(photo(block.mediaId,block.alt||''));
   if(block.caption)figure.append(text('figcaption',block.caption));
   container.append(applyFigureStyle(figure,block));
  }
 }
 if(post.tags.length)container.append(text('p',post.tags.map(t=>'#'+t).join(' '),'blog-preview-tags'));
}
function createStyleBar(block,field){
 const st=styleOf(block);
 block.style=st;
 const toolbar=text('div',undefined,'blog-style-toolbar');
 toolbar.setAttribute('aria-label','이 글 블록의 서식');
 const font=text('select');
 font.title='글씨체';font.setAttribute('aria-label','글씨체');
 for(const [value,label] of fontOptions){const option=text('option',label);option.value=value;font.append(option);}
 font.value=st.font;
 const size=text('select');size.title='글자 크기';size.setAttribute('aria-label','글자 크기');
 for(const n of [12,14,16,18,20,24,28,32,36,40,48]){const option=text('option',n+'px');option.value=n;size.append(option);}
 if(![...size.options].some(option=>Number(option.value)===st.size)){const extra=text('option',st.size+'px');extra.value=st.size;size.append(extra);}
 size.value=String(st.size);
 const color=text('input');color.type='color';color.value=st.color;color.title='글자색';color.setAttribute('aria-label','글자색');
 const bold=text('button','B');bold.type='button';bold.className='blog-style-toggle';bold.title='굵게';bold.setAttribute('aria-pressed',String(st.bold));
 const italic=text('button','I');italic.type='button';italic.className='blog-style-toggle blog-italic';italic.title='기울임';italic.setAttribute('aria-pressed',String(st.italic));
 const emoji=text('button','😀 이모지');emoji.type='button';emoji.className='blog-emoji-toggle';
 const palette=text('div',undefined,'blog-emoji-palette');palette.hidden=true;
 const update=()=>{
  applyBlockStyle(field,block);
  bold.setAttribute('aria-pressed',String(block.style.bold));
  italic.setAttribute('aria-pressed',String(block.style.italic));
  markDirty();
 };
 font.onchange=()=>{block.style.font=font.value;update();};
 size.onchange=()=>{block.style.size=Number(size.value);update();};
 color.oninput=()=>{block.style.color=color.value;update();};
 bold.onclick=()=>{block.style.bold=!block.style.bold;update();};
 italic.onclick=()=>{block.style.italic=!block.style.italic;update();};
 emoji.onclick=()=>{palette.hidden=!palette.hidden;};
 for(const symbol of emojis){
  const button=text('button',symbol);button.type='button';button.title='이모지 '+symbol;
  button.onclick=()=>{
   const start=field.selectionStart??field.value.length,end=field.selectionEnd??start;
   field.setRangeText(symbol,start,end,'end');
   block.text=field.value;palette.hidden=true;
   field.focus();markDirty();
  };
  palette.append(button);
 }
 toolbar.append(font,size,color,bold,italic,emoji,palette);
 return toolbar;
}
function renderBlocks(){
 const root=$('blog-blocks');root.replaceChildren();
 post.blocks.forEach((block,i)=>{
  const card=text('div',undefined,'blog-block');
  const row=text('div',undefined,'blog-block-top');
  row.append(text('strong',types[block.type]||'본문'));
  const actions=text('div',undefined,'blog-block-actions');
  const control=(caption,fn)=>{const b=text('button',caption);b.type='button';b.onclick=fn;actions.append(b);};
  control('↑',()=>move(i,-1));control('↓',()=>move(i,1));
  control('삭제',()=>{post.blocks.splice(i,1);markDirty();renderBlocks();});
  row.append(actions);card.append(row);
  if(block.type==='image'){
   const thumbnail=text('div',undefined,'blog-block-image');
   if(block.mediaId)thumbnail.append(photo(block.mediaId,block.alt||'사진'));
   const pick=text('button',block.mediaId?'사진 변경':'사진 선택');pick.type='button';
   pick.onclick=()=>showPhotos(i);
   card.append(thumbnail,pick);
   const alt=text('input');alt.placeholder='사진 설명(대체 텍스트)';alt.maxLength=180;alt.value=block.alt||'';
   alt.oninput=()=>{block.alt=alt.value;markDirty();};
   const cap=text('input');cap.placeholder='사진 아래 설명';cap.maxLength=300;cap.value=block.caption||'';
   cap.oninput=()=>{block.caption=cap.value;markDirty();};
   card.append(alt,cap);
   const layout=imageLayout(block);block.layout=layout;
   const controls=text('div',undefined,'blog-image-layout-controls');
   const sizeLabel=text('label','사진 크기 · '+layout.width+'%');
   const size=text('input');size.type='range';size.min='20';size.max='100';size.step='5';size.value=String(layout.width);size.setAttribute('aria-label','사진 크기');size.className='blog-image-width';
   size.oninput=()=>{block.layout.width=Number(size.value);sizeLabel.firstChild.textContent='사진 크기 · '+size.value+'%';markDirty();};
   sizeLabel.append(size);
   const alignLabel=text('label','사진 정렬');
   const align=text('select');align.setAttribute('aria-label','사진 정렬');
   for(const [value,title] of [['left','왼쪽'],['center','가운데'],['right','오른쪽']]){const option=text('option',title);option.value=value;align.append(option);}
   align.value=layout.align;align.onchange=()=>{block.layout.align=align.value;markDirty();};
   alignLabel.append(align);
   const spacingLabel=text('label','위아래 여백 · '+layout.spacing+'px');
   const space=text('input');space.type='range';space.min='0';space.max='64';space.step='4';space.value=String(layout.spacing);space.setAttribute('aria-label','사진 여백');
   space.oninput=()=>{block.layout.spacing=Number(space.value);spacingLabel.firstChild.textContent='위아래 여백 · '+space.value+'px';markDirty();};
   spacingLabel.append(space);
   controls.append(sizeLabel,alignLabel,spacingLabel);
   card.append(controls);
  }else if(block.type!=='divider'){
   const field=text('textarea');field.value=block.text||'';
   field.rows=block.type==='paragraph'?5:block.type==='list'?4:2;
   field.maxLength=6000;field.placeholder=block.type==='list'?'한 줄에 목록 항목 하나씩 입력하세요':(types[block.type]||'본문')+' 내용';
   field.oninput=()=>{block.text=field.value;markDirty();};
   applyBlockStyle(field,block);
   card.append(createStyleBar(block,field));card.append(field);
  }else card.append(text('p','글 사이에 구분선을 표시합니다.','blog-help'));
  root.append(card);
 });
 refreshPreview();
}
function move(index,by){
 const newIndex=index+by;if(newIndex<0||newIndex>=post.blocks.length)return;
 [post.blocks[index],post.blocks[newIndex]]=[post.blocks[newIndex],post.blocks[index]];
 markDirty();renderBlocks();
}
function openPost(value){post=structuredClone(value);dirty=false;applyMeta();renderBlocks();notify('글을 편집할 수 있습니다.');}
function askDiscard(){return !dirty||confirm('저장하지 않은 글의 변경사항이 있습니다. 이동할까요?');}
async function loadList(){
 const x=await api('/api/blog/posts');items=x.posts||[];
 const root=$('blog-post-list');root.replaceChildren();
 if(!items.length)root.append(text('p','아직 저장한 글이 없습니다.','blog-help'));
 for(const item of items){
  const b=text('button',undefined,'blog-post-entry');
  b.type='button';b.append(text('strong',item.title),text('small',(item.status==='ready'?'완료':'작성 중')+' · '+new Date(item.updatedAt).toLocaleDateString('ko-KR')));
  if(item.id===post?.id)b.classList.add('active');
  b.onclick=async()=>{if(!askDiscard())return;try{const x=await api('/api/blog/posts/'+item.id);openPost(x.post);loadList().catch(()=>{});}catch(e){notify(e.message,true);}};
  root.append(b);
 }
}
async function showPhotos(index){
 photoTarget=index;
 const list=$('blog-image-list');list.replaceChildren();
 const dialog=$('blog-image-dialog');dialog.showModal();
 try{
  const media=await readMedia();
  if(!media.length)list.append(text('p','사진이 없습니다. 아래에서 업로드하세요.'));
  media.forEach(m=>{
   const b=text('button',undefined,'blog-image-option');b.type='button';b.append(photo(m.id,m.name),text('small',m.name));
   b.onclick=()=>{post.blocks[photoTarget]={type:'image',mediaId:m.id,alt:m.name,caption:'',layout:imageLayout(post.blocks[photoTarget]||{})};dialog.close();markDirty();renderBlocks();};
   list.append(b);
  });
 }catch(e){list.append(text('p','사진 목록 오류: '+e.message));}
}
async function uploadPhoto(file){
 if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('JPG, PNG, WEBP 사진만 업로드할 수 있습니다.');
 if(file.size>30_000_000)throw Error('사진은 30MB 이하로 업로드하세요.');
 const res=await fetch('/api/upload?name='+encodeURIComponent(file.name),{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':csrf,'Content-Type':'application/octet-stream'},body:file});
 const body=await res.json();if(!res.ok)throw Error(body.error||'사진 업로드 실패');
 const image=body.media;
 post.blocks[photoTarget]={type:'image',mediaId:image.id,alt:image.name,caption:'',layout:imageLayout(post.blocks[photoTarget]||{})};
 $('blog-image-dialog').close();markDirty();renderBlocks();
}
function download(filename,body,type){
 const link=document.createElement('a');
 const url=URL.createObjectURL(new Blob([body],{type}));
 link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
const fileName=()=>((post.title||'블로그-원고').replace(/[\\/:*?"<>|]/g,'').slice(0,55)||'blog')+'-'+new Date().toISOString().slice(0,10);
async function imageData(id){
 const res=await fetch('/api/media/'+id,{credentials:'same-origin'});
 if(!res.ok)throw Error('내보낼 이미지 파일을 불러올 수 없습니다.');
 const blob=await res.blob();
 return await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(blob);});
}
async function exportArticle(format){
 capture();
 if(!post.title.trim())throw Error('제목을 먼저 작성하세요.');
 const blocks=[];
 for(const b of post.blocks){
  const body=escapeHtml(b.text||'').replace(/\n/g,'<br>');
  if(b.type==='image'&&b.mediaId){
   const src=await imageData(b.mediaId);
   blocks.push(format==='html'?'<figure style="'+figureStyle(b)+'"><img src="'+src+'" alt="'+escapeHtml(b.alt||'')+'"><figcaption>'+escapeHtml(b.caption||'')+'</figcaption></figure>':'!['+(b.alt||'').replace(/[\[\]]/g,'')+']('+src+')\n\n'+(b.caption||''));
  }else if(format==='html'){
   const tags={paragraph:'p',heading:'h2',subheading:'h3',quote:'blockquote'};
   const style=' style="'+escapeHtml(styleString(b))+'"';
   if(b.type==='divider')blocks.push('<hr>');
   else if(b.type==='list')blocks.push('<ul'+style+'>'+String(b.text||'').split('\n').filter(x=>x.trim()).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>');
   else if(tags[b.type])blocks.push('<'+tags[b.type]+style+'>'+body+'</'+tags[b.type]+'>');
  }else {
   const prefix={paragraph:'',heading:'## ',subheading:'### ',quote:'> '};
   const st=styleOf(b);
   const emphasize=value=>st.bold&&st.italic?'***'+value+'***':st.bold?'**'+value+'**':st.italic?'*'+value+'*':value;
   if(b.type==='divider')blocks.push('---');
   else if(b.type==='list')blocks.push((b.text||'').split('\n').filter(x=>x.trim()).map(x=>'- '+emphasize(x)).join('\n'));
   else if(prefix[b.type]!==undefined)blocks.push(prefix[b.type]+emphasize(b.text||''));
  }
 }
 if(format==='html'){
  const html='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHtml(post.title)+'</title><style>body{max-width:760px;margin:50px auto;padding:0 20px;font:17px/1.8 system-ui,"Malgun Gothic",sans-serif;color:#252b30}h1{font-size:2em}h2{margin-top:2em}p,blockquote{white-space:pre-wrap}img{display:block;max-width:100%;width:100%;height:auto}figure{box-sizing:border-box;max-width:100%}figcaption{color:#777;font-size:14px}blockquote{border-left:4px solid #aaa;padding-left:20px;color:#555}</style></head><body><article><h1>'+escapeHtml(post.title)+'</h1><p>'+escapeHtml(post.summary||'')+'</p>'+blocks.join('\n')+'<p>'+post.tags.map(t=>'#'+escapeHtml(t)).join(' ')+'</p></article></body></html>';
  download(fileName()+'.html',html,'text/html;charset=utf-8');
 }else download(fileName()+'.md','# '+post.title+'\n\n'+(post.summary||'')+'\n\n'+blocks.join('\n\n')+'\n\n'+post.tags.map(t=>'#'+t).join(' '),'text/markdown;charset=utf-8');
 notify(format==='html'?'HTML로 내보냈습니다. 글 서식과 사진 크기·정렬·여백이 유지됩니다.':'Markdown으로 내보냈습니다. 굵기·기울임은 유지되며 글꼴·크기·색상은 HTML만 지원합니다.');
}
async function save(){
 capture();
 const x=await api('/api/blog/posts','POST',post);
 post=x.post;dirty=false;applyMeta();renderBlocks();await loadList();notify('글이 계정에 저장됐습니다.');
}
async function aiDraft(){
 const topic=$('blog-ai-topic').value.trim(),facts=$('blog-ai-facts').value,tone=$('blog-ai-tone').value;
 if(topic.length<5){notify('AI 초안의 글 주제를 5자 이상 입력해 주세요.',true);return;}
 if(!askDiscard())return;
 const button=$('blog-ai-generate');button.disabled=true;notify('Gemini에서 실제 블로그 초안을 생성하고 있습니다.');
 try{
  const x=await api('/api/blog/ai-draft','POST',{topic,facts,tone});
  openPost({...x.draft,id:null});dirty=true;
  notify('AI 초안이 준비됐습니다. 내용을 검토하고 필요한 부분을 수정한 뒤 저장하세요.');
 }catch(e){notify('AI 초안 실패: '+e.message,true);}finally{button.disabled=false;}
}
function setup(){
 $('workspace-video').onclick=()=>{if(!askDiscard())return;document.body.dataset.workspace='video';$('blog-workspace').hidden=true;$('workspace-video').setAttribute('aria-pressed','true');$('workspace-blog').setAttribute('aria-pressed','false');};
 $('workspace-blog').onclick=async()=>{
  document.body.dataset.workspace='blog';$('blog-workspace').hidden=false;
  $('workspace-video').setAttribute('aria-pressed','false');$('workspace-blog').setAttribute('aria-pressed','true');
  if(!loaded){loaded=true;openPost(blank());try{await loadList();}catch(e){notify('블로그 목록 오류: '+e.message,true);}}
 };
 for(const id of ['blog-title','blog-summary','blog-category','blog-tags','blog-state'])$(id).addEventListener('input',markDirty);
 document.querySelectorAll('[data-blog-add]').forEach(button=>button.onclick=()=>{
  const type=button.dataset.blogAdd;
  post.blocks.push(type==='image'?{type,mediaId:null,alt:'',caption:''}:type==='divider'?{type}:{type,text:''});
  markDirty();renderBlocks();
  if(type==='image')showPhotos(post.blocks.length-1);
 });
 $('blog-new').onclick=()=>{if(askDiscard())openPost(blank());};
 $('blog-save').onclick=()=>save().catch(e=>notify('저장 실패: '+e.message,true));
 $('blog-delete').onclick=async()=>{
  if(!post.id){openPost(blank());return;}
  if(!confirm('이 블로그 글을 정말 삭제할까요?'))return;
  try{await api('/api/blog/posts/'+post.id+'/delete','POST',{});openPost(blank());await loadList();notify('글을 삭제했습니다.');}catch(e){notify(e.message,true);}
 };
 $('blog-ai-generate').onclick=aiDraft;
 $('blog-preview-toggle').onclick=()=>{previewVisible=!previewVisible;$('blog-preview-panel').hidden=!previewVisible;$('blog-preview-toggle').textContent=previewVisible?'미리보기 숨기기':'미리보기';};
 $('blog-export-html').onclick=()=>exportArticle('html').catch(e=>notify(e.message,true));
 $('blog-export-md').onclick=()=>exportArticle('md').catch(e=>notify(e.message,true));
 $('blog-image-close').onclick=()=>$('blog-image-dialog').close();
 $('blog-upload').onchange=async e=>{
  const f=e.target.files?.[0];if(!f)return;
  notify('사진을 업로드하고 있습니다.');
  try{await uploadPhoto(f);notify('사진을 본문에 추가했습니다.');}catch(err){notify(err.message,true);}finally{e.target.value='';}
 };
}
setup();
})();
