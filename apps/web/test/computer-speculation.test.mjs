import test from 'node:test';
import assert from 'node:assert/strict';
import {createComputerSpeculation} from '../shell/computer-speculation.js';
const state={pieces:[],sideToMove:'P1',turnIndex:0,outcome:{status:'ongoing'}};
const input={scope:'owner',gameId:'g',revision:2,generation:3,modelId:'model',state,request:{state}};
const game=()=>({id:'g',gameplayRevision:2,computer:{generation:3,modelId:'model'},board:{state:structuredClone(state)}});
test('candidate can be consumed only by exact acknowledged authority',async()=>{
 let computes=0;const speculation=createComputerSpeculation({compute:async()=>{computes++;return {result:{status:'ready'}};}});const candidate=speculation.start(input);
 assert.equal(speculation.take({...game(),gameplayRevision:1},'owner'),null);assert.equal(speculation.take(game(),'other'),null);
 assert.equal(speculation.take(game(),'owner'),candidate);await candidate.promise;assert.equal(computes,1);assert.equal(speculation.snapshot(),null);
});
test('discard before queued compute prevents obsolete worker startup',async()=>{
 let computes=0;const speculation=createComputerSpeculation({compute:async()=>{computes++;}}),candidate=speculation.start(input);speculation.discard();await candidate.promise;assert.equal(computes,0);
});
