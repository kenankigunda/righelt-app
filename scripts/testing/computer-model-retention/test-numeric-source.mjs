// UNEXECUTED synthetic app-source metadata only. No numeric model or proof file reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNumericApp} from './manifest.mjs';
const app={checkout:'/synthetic-prospective',sourceRevision:'a'.repeat(40),tree:'b'.repeat(40)};
test('numeric proof must bind exactly the prospective app checkout, revision and tree',()=>assert.doesNotThrow(()=>assertNumericApp({app:{...app}},app)));
for(const key of ['checkout','sourceRevision','tree'])test(`numeric proof rejects another app ${key}`,()=>{const other={...app,[key]:key==='checkout'?'/different-checkout':'c'.repeat(40)};assert.throws(()=>assertNumericApp({app:other},app),new RegExp(`app mismatch: ${key}`));});
test('numeric proof cannot omit app identity',()=>assert.throws(()=>assertNumericApp({},app),/lacks its actual app source/));
