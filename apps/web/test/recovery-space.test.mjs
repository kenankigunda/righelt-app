import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverySpaceGeometry} from '../shell/recovery-space.js';
test('recovery follows the real header with eight pixels of clearance',()=>{
 for(const headerBottom of [44,68,120,175.5])assert.deepEqual(recoverySpaceGeometry({headerBottom,viewportHeight:844}),{top:headerBottom+8,viewportBottom:844});
});
test('offscreen headers and visual viewport offsets retain a visible top clearance',()=>{
 assert.deepEqual(recoverySpaceGeometry({headerBottom:-52,viewportHeight:844}),{top:8,viewportBottom:844});
 assert.deepEqual(recoverySpaceGeometry({headerBottom:0,viewportTop:24,viewportHeight:400}),{top:32,viewportBottom:424});
 assert.deepEqual(recoverySpaceGeometry({headerBottom:NaN,viewportTop:NaN,viewportHeight:NaN}),{top:8,viewportBottom:0});
});
