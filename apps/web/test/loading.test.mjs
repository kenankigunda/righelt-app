import test from 'node:test';
import assert from 'node:assert/strict';
import {loadingPhase,loadingAttributes,loadingCue} from '../shell/loading.js';
test('loading thresholds describe waiting without inventing failures',()=>{
 assert.equal(loadingPhase(0),'quiet');assert.equal(loadingPhase(199),'quiet');assert.equal(loadingPhase(200),'visible');assert.equal(loadingPhase(4999),'visible');assert.equal(loadingPhase(5000),'slow');assert.equal(loadingPhase(60000),'slow');
});
test('loading metadata escapes markup and pieces are purely decorative',()=>{
 assert.match(loadingAttributes('a"b','<Retry>'),/a&quot;b/);assert.match(loadingAttributes('a','<Retry>'),/&lt;Retry&gt;/);assert.match(loadingCue(),/aria-hidden="true"/);assert.equal((loadingCue().match(/<i>/g)||[]).length,3);
});
