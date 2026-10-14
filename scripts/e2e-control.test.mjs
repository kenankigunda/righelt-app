import test from 'node:test';
import assert from 'node:assert/strict';
import {e2eControlPort} from './e2e-control.mjs';
test('gameplay controls never occupy the account browser stack port',()=>{
 assert.equal(e2eControlPort(9888),10088);
 assert.notEqual(e2eControlPort(9888),9988);
 assert.throws(()=>e2eControlPort('invalid'));
 assert.throws(()=>e2eControlPort(65535));
});
