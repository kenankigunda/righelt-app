import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createInitialState} from '../../../packages/game-engine/src/index.ts';
import {encodeState} from '../../../packages/computer-player/src/index.ts';
import {encodingHash} from '../production-corpus.mjs';
import {commanderFamily,encodedFamily,encodedDigest} from '../evaluation-protection.mjs';

test('state and encoding use the same exact commander family and Float32 digest',()=>{
 const state=createInitialState(),encoded=encodeState(state);
 assert.equal(encodedFamily(encoded),commanderFamily(state));
 assert.equal(encodedDigest(encoded),encodingHash(state));
 const changed=structuredClone(state);changed.pieces.find(p=>p.kind==='commander').position.row++;
 assert.notEqual(commanderFamily(changed),commanderFamily(state));
});

test('protected family rejects a real generation start before any model request',()=>{
 const state=createInitialState();
 const job={command:'generate',id:'family-protected',seed:107,partition:'train',kind:'normal',
  familyId:'normal-test',modelVersion:'test',budgetMs:1000,protectedFamilyIds:[commanderFamily(state)]};
 const result=spawnSync(process.execPath,['--import','tsx','tools/ai-trainer/engine-worker.mjs'],
  {input:JSON.stringify(job)+'\n',encoding:'utf8',timeout:5000});
 assert.equal(result.status,0,result.stderr);
 const messages=result.stdout.trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(messages.length,1);assert.equal(messages[0].type,'unavailable-start');
 assert.equal(messages[0].reason,'protected-evaluation-position');
});

test('malformed commander input fails closed',()=>{
 assert.throws(()=>encodedFamily(new Float32Array(4)),/size/);
 const values=encodeState(createInitialState());values.fill(1,0,100);
 assert.throws(()=>encodedFamily(values),/Duplicate/);
});
