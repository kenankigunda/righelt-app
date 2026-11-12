import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {FRIEND_STORY} from '../shell/opponent-stories.js';
test('the shared raster material stays static, opaque and inside its frozen delivery budget',()=>{
 const data=readFileSync(new URL('../assets/materials/marble-white-raster-v2.webp',import.meta.url));
 assert.ok(data.length<=96*1024,'material transfer ceiling fixed before generation');
 assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WEBP');
 let width,height,alpha=false;
 for(let offset=12;offset+8<=data.length;){
  const kind=data.toString('ascii',offset,offset+4),size=data.readUInt32LE(offset+4),start=offset+8;
  assert.ok(start+size<=data.length,'complete WebP chunk');
  assert.ok(!['ANIM','ANMF','ALPH','ICCP','EXIF','XMP '].includes(kind),'no animation, alpha or metadata payload');
  if(kind==='VP8 '){assert.ok(size>=10);assert.equal(data.subarray(start+3,start+6).toString('hex'),'9d012a');width=data.readUInt16LE(start+6)&0x3fff;height=data.readUInt16LE(start+8)&0x3fff;}
  if(kind==='VP8L'){assert.ok(size>=5);assert.equal(data[start],0x2f);const bits=data.readUInt32LE(start+1);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;alpha=Boolean(bits&0x10000000);}
  if(kind==='VP8X'){assert.ok(size>=10);alpha=Boolean(data[start]&0x10);}
  offset=start+size+(size%2);
 }
 assert.ok(width>0&&height>0&&width<=1024&&height<=1024,'bounded texture dimensions');
 assert.equal(alpha,false);assert.ok(width*height*4<=4*1024*1024,'decoded RGBA upper bound, not a measured heap claim');
});


test('only the exact fourteen approved delivery assets reach their mapped consumers',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../../docs/ai/marble/selected-assets.json',import.meta.url),'utf8'));
 assert.equal(manifest.assets.length,14);let bytes=0;
 for(const asset of manifest.assets){
  assert.match(asset.target,/^apps\/web\/assets\/opponents\/[a-z0-9-]+\.webp$/,'approved delivery artifact path only');
  const data=readFileSync(new URL(`../../../${asset.target}`,import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'),asset.sha256,asset.id);
  assert.equal(data.length,asset.bytes);bytes+=data.length;
 }
 assert.equal(bytes,2906220);
 const friend=manifest.assets.find(asset=>asset.id==='friend-introduction-selected');
 assert.equal(FRIEND_STORY.scenes.length,1);assert.equal(FRIEND_STORY.scenes[0][0],'friend-introduction');assert.equal(FRIEND_STORY.scenes[0][1],friend.alt);
 assert.equal(friend.target,'apps/web/assets/opponents/friend-introduction.webp');
 assert.equal(manifest.assets.find(asset=>asset.id==='friend-portrait').target,'apps/web/assets/opponents/friend-portrait.webp');
 assert.equal(manifest.friendMasterSha256,'49f1b9c6111d57b99e5decd8a83d2403aa888435d6bb8aa4466dc1761e6492ad');
});
