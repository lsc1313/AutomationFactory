import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,stat,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {id,normalizeTimeline,sourceClip,clipMs,timelineDuration,splitClip,splitAtPlayhead,moveClip,duplicateClip,renderPlan,locateClip,clipAss,visualFilter,renderTimeline} from '../timeline-v2.mjs';
const assetA={id:'a'.repeat(24),group:'image',ext:'jpg',name:'photo'};
const assetB={id:'b'.repeat(24),group:'video',ext:'mp4',name:'video',duration:3,hasAudio:true};
const media=[assetA,assetB];
const photo=sourceClip({id:'1'.repeat(24),mediaId:assetA.id,duration:4,repeats:3,audioMode:'mute',caption:'사진 설명'},media);
const video=sourceClip({id:'2'.repeat(24),mediaId:assetB.id,sourceIn:.5,sourceOut:2.5,speed:2,audioMode:'original',caption:'카메라'},media);
test('still image repeat and video trim with speed determine exact timeline time',()=>{
 assert.equal(clipMs(photo),12000);assert.equal(clipMs(video),1000);
 assert.equal(timelineDuration({scenes:[photo,video]}),13000);
 const p=renderPlan({ratio:'16:9',scenes:[photo,video]});
 assert.equal(p.entries.length,4);assert.equal(p.durationMs,13000);assert.equal(p.canvas.width,1280);
 assert.equal(locateClip([photo,video],12500).index,1);
});
test('non-destructive video split maintains source time, removes no source data',()=>{
 const initial=structuredClone(video),out=splitClip([video],0,.4);
 assert.equal(out.length,2);
 assert.equal(out[0].sourceOut,1.3);
 assert.equal(out[1].sourceIn,1.3);
 assert.equal(clipMs(out[0])+clipMs(out[1]),clipMs(video));
 assert.deepEqual(video,initial);
 assert.notEqual(out[0].id,out[1].id);
});
test('image split and playhead split, duplicate/reorder preserve source',()=>{
 const f={...photo,repeats:1};const two=splitAtPlayhead([f],1750);
 assert.equal(two.scenes.length,2);assert.equal(clipMs(two.scenes[0]),1750);
 assert.equal(clipMs(two.scenes[1]),2250);
 const copies=duplicateClip([f],0);assert.equal(copies.length,2);
 assert.equal(copies[0].mediaId,copies[1].mediaId);
 assert.notEqual(copies[0].id,copies[1].id);
 assert.equal(moveClip([f,video],0,1)[0].mediaId,video.mediaId);
});
test('canvas, caption timing and audio preservation validated without touching media',()=>{
 const p=normalizeTimeline({scenes:[{...video,captionStart:.2,captionEnd:.5,fit:'fit',transition:'fade'}],ratio:'1:1'},media);
 assert.equal(p.schemaVersion,2);assert.equal(p.ratio,'1:1');
 assert.equal(p.scenes[0].audioMode,'original');assert.equal(p.scenes[0].transition,'fade');
 const ass=clipAss(p.scenes[0],1,{width:720,height:720});
 assert.match(ass,/0:00:00.20/);assert.match(ass,/0:00:00.50/);
 assert.match(ass,/&HFF000000/);
 const visual=visualFilter(p.scenes[0],{width:720,height:720},24);
 assert.match(visual,/pad=720:720/);assert.match(visual,/fade=t=in/);
});
test('reject out of range clip source and too-long timelines',()=>{
 assert.throws(()=>normalizeTimeline({scenes:[{...video,sourceOut:8}]},media),/원본 길이/);
 assert.throws(()=>splitClip([video],0,.02),/양 끝/);
 assert.throws(()=>normalizeTimeline({scenes:Array(161).fill(photo)},media),/160/);
});
test('FFmpeg smoke renders mixed photo+video preserving source audio into H.264 MP4',async t=>{
 if(spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status!==0){t.skip('FFmpeg not installed');return;}
 const root=await mkdtemp(path.join(os.tmpdir(),'studio-v2-media-'));
 const inputs=path.join(root,'media'),outputs=path.join(root,'out');await mkdir(inputs);await mkdir(outputs);
 t.after(()=>rm(root,{recursive:true,force:true}));
 const ff=(args)=>{const x=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{encoding:'utf8',timeout:90000});assert.equal(x.status,0,x.stderr)};
 ff(['-f','lavfi','-i','color=c=orange:s=320x240:d=1','-frames:v','1',path.join(inputs,assetA.id+'.jpg')]);
 ff(['-f','lavfi','-i','testsrc2=s=320x240:r=24:d=2','-f','lavfi','-i','sine=f=440:d=2','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path.join(inputs,assetB.id+'.mp4')]);
 const scenes=[sourceClip({mediaId:assetA.id,duration:.4,caption:'사진',audioMode:'mute'},media),sourceClip({mediaId:assetB.id,sourceIn:.2,sourceOut:1.1,speed:1.5,caption:'촬영',audioMode:'original'},media)];
 const output=await renderTimeline({schemaVersion:2,ratio:'1:1',scenes,voice:'off'},media,{mediaDir:inputs,outputDir:outputs});
 assert.ok((await stat(path.join(outputs,output.filename))).size>10000);
 const x=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_type','-of','csv=p=0',path.join(outputs,output.filename)],{encoding:'utf8'});
 assert.equal(x.status,0);assert.match(x.stdout,/video/);assert.match(x.stdout,/audio/);
 assert.ok(output.duration>.9&&output.duration<1.3);
 const musicId='c'.repeat(24);
 ff(['-f','lavfi','-i','sine=f=880:d=2','-c:a','libmp3lame',path.join(inputs,musicId+'.mp3')]);
 const withMusic=[...media,{id:musicId,group:'music',ext:'mp3',duration:2,hasAudio:true}];
 const second=await renderTimeline({schemaVersion:2,ratio:'16:9',scenes,
  voice:'off',audioClips:[{mediaId:musicId,startMs:200,durationMs:700,volume:.3}],
  bgmId:musicId,bgmVolume:.1},withMusic,{mediaDir:inputs,outputDir:outputs});
 assert.ok((await stat(path.join(outputs,second.filename))).size>10000);

});

test('text and audio overlay tracks are normalized, and text events have independent timing',()=>{
 const music={id:'c'.repeat(24),group:'music',ext:'mp3'};
 const p=normalizeTimeline({ratio:'9:16',scenes:[{...photo,repeats:1}],
  textClips:[{text:'별도 자막',startMs:500,endMs:1200,position:'top',size:47}],
  audioClips:[{mediaId:music.id,startMs:1000,durationMs:1400,volume:.5}]},[...media,music]);
 assert.equal(p.textClips.length,1);assert.equal(p.audioClips.length,1);
 const ass=clipAss(p.scenes[0],4,{width:720,height:1280},[{...p.textClips[0],startMs:500,endMs:1200}]);
 assert.match(ass,/Dialogue: 1,0:00:00.50,0:00:01.20/);
 assert.match(ass,/별도 자막/);
});
test('caption font, transparent color and outline are preserved in ASS without a box',()=>{
 const clip=sourceClip({mediaId:assetA.id,duration:3,caption:'노란색 자막',captionStyle:'clean',captionColor:'#12AB34',captionFont:'Batang',captionOutline:5},media);
 const ass=clipAss(clip,3,{width:720,height:1280});
 assert.match(ass,/Style: Caption,Batang,56,&H0034AB12/);
 assert.match(ass,/&HFF000000/);
 assert.match(ass,/,1,5,1,2,/);
});