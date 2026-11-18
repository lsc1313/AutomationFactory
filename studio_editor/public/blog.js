'use strict';
/* Studio Blog Editor: account-scoped block editor, portable exports and AI drafts.
 * All user content is inserted as text, never as executable HTML.
 */
(()=>{
const $=id=>document.getElementById(id);
const types={paragraph:'본문',heading:'큰 제목',subheading:'소제목',image:'사진',quote:'인용',list:'목록',divider:'구분선'};
let post=null,items=[],loaded=false,dirty=false,photoTarget=-1,previewVisible=true;
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
  if(block.type==='heading')container.append(text('h2',content));
  else if(block.type==='subheading')container.append(text('h3',content));
  else if(block.type==='paragraph')container.append(text('p',content));
  else if(block.type==='quote')container.append(text('blockquote',content));
  else if(block.type==='divider')container.append(document.createElement('hr'));
  else if(block.type==='list'){
   const ul=document.createElement('ul');
   for(const line of content.split('\n').map(x=>x.trim()).filter(Boolean))ul.append(text('li',line));
   container.append(ul);
  }else if(block.type==='image'&&block.mediaId){
   const figure=document.createElement('figure');
   figure.append(photo(block.mediaId,block.alt||''));
   if(block.caption)figure.append(text('figcaption',block.caption));
   container.append(figure);
  }
 }
 if(post.tags.length)container.append(text('p',post.tags.map(t=>'#'+t).join(' '),'blog-preview-tags'));
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
  }else if(block.type!=='divider'){
   const field=text('textarea');field.value=block.text||'';
   field.rows=block.type==='paragraph'?5:block.type==='list'?4:2;
   field.maxLength=6000;field.placeholder=block.type==='list'?'한 줄에 목록 항목 하나씩 입력하세요':(types[block.type]||'본문')+' 내용';
   field.oninput=()=>{block.text=field.value;markDirty();};
   card.append(field);
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
   b.onclick=()=>{post.blocks[photoTarget]={type:'image',mediaId:m.id,alt:m.name,caption:''};dialog.close();markDirty();renderBlocks();};
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
 post.blocks[photoTarget]={type:'image',mediaId:image.id,alt:image.name,caption:''};
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
   blocks.push(format==='html'?'<figure><img src="'+src+'" alt="'+escapeHtml(b.alt||'')+'"><figcaption>'+escapeHtml(b.caption||'')+'</figcaption></figure>':'!['+(b.alt||'').replace(/[\[\]]/g,'')+']('+src+')\n\n'+(b.caption||''));
  }else if(format==='html'){
   const tags={paragraph:'p',heading:'h2',subheading:'h3',quote:'blockquote'};
   if(b.type==='divider')blocks.push('<hr>');
   else if(b.type==='list')blocks.push('<ul>'+String(b.text||'').split('\n').filter(x=>x.trim()).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')+'</ul>');
   else if(tags[b.type])blocks.push('<'+tags[b.type]+'>'+body+'</'+tags[b.type]+'>');
  }else {
   const prefix={paragraph:'',heading:'## ',subheading:'### ',quote:'> '};
   if(b.type==='divider')blocks.push('---');
   else if(b.type==='list')blocks.push((b.text||'').split('\n').filter(x=>x.trim()).map(x=>'- '+x).join('\n'));
   else if(prefix[b.type]!==undefined)blocks.push(prefix[b.type]+(b.text||''));
  }
 }
 if(format==='html'){
  const html='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHtml(post.title)+'</title><style>body{max-width:760px;margin:50px auto;padding:0 20px;font:17px/1.8 system-ui,"Malgun Gothic",sans-serif;color:#252b30}h1{font-size:2em}h2{margin-top:2em}p,blockquote{white-space:pre-wrap}img{width:100%;height:auto}figure{margin:32px 0}figcaption{color:#777;font-size:14px}blockquote{border-left:4px solid #aaa;padding-left:20px;color:#555}</style></head><body><article><h1>'+escapeHtml(post.title)+'</h1><p>'+escapeHtml(post.summary||'')+'</p>'+blocks.join('\n')+'<p>'+post.tags.map(t=>'#'+escapeHtml(t)).join(' ')+'</p></article></body></html>';
  download(fileName()+'.html',html,'text/html;charset=utf-8');
 }else download(fileName()+'.md','# '+post.title+'\n\n'+(post.summary||'')+'\n\n'+blocks.join('\n\n')+'\n\n'+post.tags.map(t=>'#'+t).join(' '),'text/markdown;charset=utf-8');
 notify('파일을 내보냈습니다. HTML은 사진이 포함된 독립 파일입니다.');
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
