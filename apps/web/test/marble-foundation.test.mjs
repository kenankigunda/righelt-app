import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
