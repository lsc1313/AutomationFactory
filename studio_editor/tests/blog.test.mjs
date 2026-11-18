import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(os.tmpdir(),'studio-blog-'));
process.env.STUDIO_DATA_DIR=dir;
const {createStudioServer}=await import('../server.mjs');
const {validateBlogPost,validateBlogStyle,validateBlogImageLayout}=await import('../blog-engine.mjs');
test('blog body rejects unowned media, arbitrary HTML types and invalid content',()=>{
 assert.throws(()=>validateBlogPost({title:'글',blocks:[{type:'image',mediaId:'ab'.repeat(12)}]},[]),/업로드된 사진/);
 assert.throws(()=>validateBlogPost({title:'글',blocks:[{type:'script',text:'<script>'}]}),/형식/);
 const result=validateBlogPost({title:'글',tags:['정보','정보'],blocks:[{type:'paragraph',text:'<script>alert(1)</script>'}]});
 assert.equal(result.tags.length,1);
 assert.equal(result.blocks[0].text,'<script>alert(1)</script>','text stays data; UI must render it as textContent');
 assert.equal(result.status,'draft');
});
test('each blog text block sanitizes style and keeps independent typography',()=>{
 const blocks=[
  {type:'heading',text:'강조 제목',style:{font:'serif',size:32,color:'#AB12EF',bold:true,italic:false}},
  {type:'paragraph',text:'일반 본문',style:{font:'mono',size:18,color:'#224466',bold:false,italic:true}},
  {type:'quote',text:'별도 인용',style:{font:'__unsafe__',size:999,color:'red;position:fixed',bold:'yes',italic:true}}
 ];
 const post=validateBlogPost({title:'서식 확인',blocks},[]);
 assert.deepEqual(post.blocks[0].style,{font:'serif',size:32,color:'#AB12EF',bold:true,italic:false});
 assert.deepEqual(post.blocks[1].style,{font:'mono',size:18,color:'#224466',bold:false,italic:true});
 assert.deepEqual(post.blocks[2].style,{font:'system',size:48,color:'#25352F',bold:false,italic:true});
 assert.equal(validateBlogStyle({},'heading').size,28);
 assert.equal(validateBlogStyle({},'subheading').size,22);
 assert.equal(validateBlogStyle({},'paragraph').size,16);
});
test('blog image layout has compact defaults and rejects invalid size, alignment and spacing',()=>{
 assert.deepEqual(validateBlogImageLayout(),{width:65,align:'center',spacing:20});
 assert.deepEqual(validateBlogImageLayout({width:35,align:'left',spacing:8}),{width:35,align:'left',spacing:8});
 assert.deepEqual(validateBlogImageLayout({width:0,align:'position:absolute',spacing:-30}),{width:65,align:'center',spacing:20});
 assert.deepEqual(validateBlogImageLayout({width:500,align:'right',spacing:900}),{width:100,align:'right',spacing:64});
 const media=[{id:'ab'.repeat(12),group:'image'}];
 const post=validateBlogPost({title:'사진 배치',blocks:[{type:'image',mediaId:media[0].id,caption:'기존 캡션',layout:{width:40,align:'right',spacing:16}}]},media);
 assert.deepEqual(post.blocks[0].layout,{width:40,align:'right',spacing:16});
 assert.equal(post.blocks[0].caption,'기존 캡션');
});
test('blog posts save/update/load/delete only in authenticated account, with CSRF',async t=>{
 const server=createStudioServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const signup=async(email)=>{
  const r=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'SecureBlogPass_2026!'})});
  assert.equal(r.status,201,await r.clone().text());
  return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf};
 };
 const owner=await signup('blog-owner@example.com'),other=await signup('blog-other@example.com');
 const headers=u=>({'Content-Type':'application/json',Cookie:u.cookie,'X-CSRF-Token':u.csrf});
 const fresh=async(u,route)=>fetch(base+route,{headers:{Cookie:u.cookie}});
 let r=await fetch(base+'/api/blog/posts');
 assert.equal(r.status,401);
 r=await fetch(base+'/api/blog/posts',{method:'POST',headers:{'Content-Type':'application/json',Cookie:owner.cookie},body:'{}'});
 assert.equal(r.status,403);
 const item={title:'첫 번째 블로그 원고',category:'일상',tags:['테스트','편집'],status:'draft',blocks:[{type:'heading',text:'도입',style:{font:'serif',size:30,color:'#1155AA',bold:true,italic:false}},{type:'paragraph',text:'직접 작성한 원고',style:{font:'gothic',size:17,color:'#225533',bold:false,italic:true}}]};
 r=await fetch(base+'/api/blog/posts',{method:'POST',headers:headers(owner),body:JSON.stringify(item)});
 assert.equal(r.status,201,await r.clone().text());
 const saved=(await r.json()).post;assert.match(saved.id,/^[a-f0-9]{24}$/);
 assert.equal(saved.blocks[0].style.font,'serif');assert.equal(saved.blocks[1].style.italic,true);
 r=await fresh(other,'/api/blog/posts');assert.deepEqual((await r.json()).posts,[]);
 r=await fresh(other,'/api/blog/posts/'+saved.id);assert.equal(r.status,404);
 r=await fetch(base+'/api/blog/posts',{method:'POST',headers:headers(other),body:JSON.stringify({...item,id:saved.id})});
 assert.equal(r.status,404,'another account cannot update by id');
 r=await fetch(base+'/api/blog/posts',{method:'POST',headers:headers(owner),body:JSON.stringify({...saved,title:'수정한 글',status:'ready'})});
 assert.equal(r.status,200);
 const savedAgain=(await r.json()).post;assert.equal(savedAgain.status,'ready');assert.equal(savedAgain.blocks[0].style.color,'#1155AA');
 r=await fresh(owner,'/api/blog/posts');assert.equal((await r.json()).posts[0].title,'수정한 글');
 r=await fetch(base+'/api/blog/posts/'+saved.id+'/delete',{method:'POST',headers:headers(other),body:'{}'});
 assert.equal(r.status,404);
 r=await fetch(base+'/api/blog/posts/'+saved.id+'/delete',{method:'POST',headers:headers(owner),body:'{}'});
 assert.equal(r.status,200);
 r=await fresh(owner,'/api/blog/posts');assert.deepEqual((await r.json()).posts,[]);
});
test('blog photos are validated against the matching account and cannot be deleted while referenced',async t=>{
 const server=createStudioServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(r=>server.close(r));});
 const r=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'blog-photo@example.com',password:'SecureBlogPass_2026!'})});
 assert.equal(r.status,201);
 const user=await r.json(),cookie=r.headers.get('set-cookie').split(';')[0];
 const h={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':user.csrf};
 const accounts=JSON.parse(await readFile(path.join(dir,'accounts.json'),'utf8'));
 const id=accounts.find(x=>x.email==='blog-photo@example.com').id;
 const root=id==='owner'?dir:path.join(dir,'users',id),imageId='ab'.repeat(12);
 await mkdir(path.join(root,'media'),{recursive:true});
 await writeFile(path.join(root,'media',imageId+'.jpg'),Buffer.alloc(1600));
 await writeFile(path.join(root,'media.json'),JSON.stringify([{id:imageId,name:'내 사진',group:'image',ext:'jpg',bytes:1600}]));
 let result=await fetch(base+'/api/blog/posts',{method:'POST',headers:h,body:JSON.stringify({title:'사진 있는 글',blocks:[{type:'image',mediaId:imageId,caption:'직접 찍은 사진',layout:{width:35,align:'left',spacing:12}}]})});
 assert.equal(result.status,201,await result.clone().text());
 const withLayout=(await result.json()).post;
 assert.deepEqual(withLayout.blocks[0].layout,{width:35,align:'left',spacing:12});
 const reloaded=await fetch(base+'/api/blog/posts/'+withLayout.id,{headers:{Cookie:cookie}});
 assert.deepEqual((await reloaded.json()).post.blocks[0].layout,{width:35,align:'left',spacing:12});
 const project=await fetch(base+'/api/new',{method:'POST',headers:h,body:'{}'});
 const pid=(await project.json()).project.id;
 result=await fetch(base+'/api/media/remove',{method:'POST',headers:h,body:JSON.stringify({projectId:pid,mediaId:imageId,confirm:true})});
 assert.equal(result.status,409);
});
test('blog editor files and workspace switch are wired into app',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../public/blog.js',import.meta.url),'utf8');
 const css=await readFile(new URL('../public/blog.css',import.meta.url),'utf8');
 assert.match(html,/id="workspace-video"/);
 assert.match(html,/id="workspace-blog"/);
 assert.match(html,/id="blog-workspace"/);
 assert.match(html,/src="\/blog.js"/);
 assert.match(html,/href="\/blog.css"/);
 assert.match(js,/dataset\.workspace='blog'/);
 assert.match(js,/blog\/ai-draft/);
 assert.match(js,/textContent/);
 assert.match(css,/max-width:900px/);
});
