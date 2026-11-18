/**
 * Blog Editor domain data. Store only structured, escaped text and IDs of media
 * owned by the authenticated account. Never persist arbitrary HTML from a browser.
 */
import {randomBytes} from 'node:crypto';
export const blogId=()=>randomBytes(12).toString('hex');
export const blogTypes=Object.freeze(['paragraph','heading','subheading','image','quote','list','divider']);
const max=(value,length)=>String(value??'').replace(/\u0000/g,'').slice(0,length);
export function validateBlogPost(raw,media=[],old=null){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('블로그 글 데이터가 올바르지 않습니다.');
 const title=max(raw.title,140).trim(),summary=max(raw.summary,350).trim();
 if(!title)throw new Error('블로그 글 제목을 입력하세요.');
 const rawBlocks=raw.blocks;
 if(!Array.isArray(rawBlocks)||rawBlocks.length>120)throw new Error('본문은 최대 120개 블록까지 작성할 수 있습니다.');
 const blocks=rawBlocks.map((block,i)=>{
  if(!block||typeof block!=='object'||!blogTypes.includes(block.type))throw new Error('본문 '+(i+1)+'번째 블록 형식이 잘못됐습니다.');
  if(block.type==='image'){
   const item=media.find(x=>x.id===block.mediaId&&x.group==='image');
   if(!item)throw new Error('이미지는 로그인 계정에 업로드된 사진만 사용할 수 있습니다.');
   return {id:blogId(),type:'image',mediaId:item.id,alt:max(block.alt,180),caption:max(block.caption,300)};
  }
  if(block.type==='divider')return {id:blogId(),type:'divider'};
  return {id:blogId(),type:block.type,text:max(block.text,6000)};
 });
 const tags=Array.isArray(raw.tags)?raw.tags.slice(0,15).map(x=>max(x,30).trim()).filter(Boolean):[];
 const now=new Date().toISOString();
 return {id:old?.id||blogId(),title,summary,category:max(raw.category,60).trim(),tags:[...new Set(tags)],status:raw.status==='ready'?'ready':'draft',blocks,createdAt:old?.createdAt||now,updatedAt:now};
}
export function blogPostForList(post){
 return {id:post.id,title:post.title,status:post.status,category:post.category,tags:post.tags,updatedAt:post.updatedAt,createdAt:post.createdAt,blockCount:post.blocks.length};
}
