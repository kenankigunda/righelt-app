import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {FRIEND_STORY} from '../shell/opponent-stories.js';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('the first document canvas and stylesheet fallbacks use the same quiet white base',()=>{
 const index=read('../index.html'),critical=index.match(/<style id="document-canvas">([^<]+)<\/style>/)?.[1];
 assert.ok(critical,'canvas is independent of optional texture readiness');
 assert.match(critical,/background:#f7f8f8/);assert.ok(index.indexOf('id="document-canvas"')<index.indexOf('rel="stylesheet"'));
 assert.match(read('../design-tokens.css'),/--surface-foundation: #f7f8f8;/);
 assert.match(read('../styles.css'),/--bg: #f7f8f8;/);
 assert.doesNotMatch(read('../shell/shell.css'),/radial-gradient\(circle at 12% 8%/);
});

test('marble materials are small static vector resources without interactive or animated owners',()=>{
 for(const name of ['marble-face','marble-canvas']){
  const asset=read(`../assets/materials/${name}.svg`);
  assert.ok(Buffer.byteLength(asset)<4096,'bounded reusable material, not a page screenshot');
  assert.match(asset,/<svg[^>]+viewBox=/);assert.match(asset,/<path /);
  assert.doesNotMatch(asset,/<(?:script|foreignObject|image|filter|animate|set)\b|onload=|https?:\/\/(?!www.w3.org)/i);
 }
 const css=read('../shell/refresh.css');
 assert.match(css,/body \{background-color:var\(--surface-foundation\);background-image:var\(--marble-canvas\)/);
 assert.match(css,/@media\(forced-colors:active\) \{body\{background-image:none;\}\}/);
});


test('only the exact fourteen approved delivery assets reach their mapped consumers',()=>{
 const manifest=JSON.parse(read('../../../docs/ai/marble/selected-assets.json'));
 assert.equal(manifest.assets.length,14);let bytes=0;
 for(const asset of manifest.assets){
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
