import test from 'node:test';
import assert from 'node:assert/strict';
import packet from './fixtures/s05-effects-v1.json' with {type:'json'};
import executedStart from './fixtures/evaluation-developed-start.json' with {type:'json'};
import {expectedEvaluationStart,verifyEvaluationGameStart} from '../evaluation-start.mjs';
const developed=()=>({kind:'simple',startKind:'developed',initialState:structuredClone(packet.cases[0].rootState)});

test('authoritative developed identity binds the full initial rule state and executed root',()=>{
 const job=developed();job.startIdentity=expectedEvaluationStart(job);
 assert.equal(job.startIdentity.stateHash,'0092d30a97be55a630e1fddc9f9ac1dac70cdd40dbecffa66daca13d2ca6de0a');
 const game={rootState:executedStart,initialState:executedStart,warmupActions:[]};
 assert.deepEqual(verifyEvaluationGameStart(job,game),job.startIdentity);
 const other=packet.cases[1].rootState;
 assert.throws(()=>verifyEvaluationGameStart(job,{rootState:other,initialState:other,warmupActions:[]}),/differs from frozen/);
 assert.throws(()=>verifyEvaluationGameStart(job,{...game,rootState:other}),/differs from frozen/);
 assert.throws(()=>verifyEvaluationGameStart(job,{...game,warmupActions:[{type:'pass'}]}),/warmup/);
 const changed={...job,initialState:other};assert.notDeepEqual(expectedEvaluationStart(changed),job.startIdentity);
 assert.throws(()=>verifyEvaluationGameStart(changed,game),/identity mismatch/);
});

test('normal means the normal rules construction and rejects a custom board',()=>{
 const normal={kind:'normal',startKind:'normal'};
 assert.equal(expectedEvaluationStart(normal).kind,'normal');
 assert.throws(()=>expectedEvaluationStart({...normal,initialState:developed().initialState}),/normal\/custom/);
 assert.throws(()=>expectedEvaluationStart({...developed(),kind:'continuation'}),/normal\/custom/);
});
