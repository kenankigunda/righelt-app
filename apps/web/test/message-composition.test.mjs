import test from 'node:test';
import assert from 'node:assert/strict';
import {partitionMessageActions,rushMessageContext} from '../board/message-composition.js';

test('grammatical actions remain inline while replay and status retain order below their message',()=>{
 const pass={id:'pass',label:'Pass'}, replay={id:'replay-computer',label:'Show me again'}, status={id:'obligatory',label:'Obligatory'}, end={id:'end-turn',label:'End turn'};
 assert.deepEqual(partitionMessageActions([replay,pass,status,end]),{inline:[pass,end],detached:[replay,status]});
});
test('actual explicit or automatic selection replaces the whole rush obligation',()=>{
 for(const selectedPieceId of ['explicit','automatic'])assert.equal(rushMessageContext({selectedPieceId,requiredPieceIds:['a','b']}),'piece');
 assert.equal(rushMessageContext({selectedPieceId:'a',selectedTarget:{row:1,col:2},requiredPieceIds:['a','b']}),'destination');
});
test('hover without actual piece selection preserves obligation and clearing selection restores it',()=>{
 assert.equal(rushMessageContext({selectedTarget:{row:1,col:2},requiredPieceIds:['a','b']}),'obligation');
 assert.equal(rushMessageContext({requiredPieceIds:['b']}),'obligation');
 assert.equal(rushMessageContext({}),'routine');
});

test('fixed prompt height uses both fonts and ignores changing context content',async()=>{
 const {messageHeightTarget}=await import('../board/message-composition.js');
 assert.equal(messageHeightTarget({primaryRoutine:70,fallbackRoutine:75,current:160}),75);
 assert.equal(messageHeightTarget({primaryRoutine:70,fallbackRoutine:75,current:40}),75);
});
test('height has no content animation and defers metric changes during native presses',async()=>{
 const {messageHeightTransition:transition}=await import('../board/message-composition.js');
 assert.deepEqual(transition({from:83,to:140}),{kind:'snap',height:140});
 assert.deepEqual(transition({from:113,to:75}),{kind:'snap',height:75});
 for(const flag of ['initial','metricChange','reducedMotion'])assert.deepEqual(transition({from:83,to:140,[flag]:true}),{kind:'snap',height:140});
 assert.deepEqual(transition({from:83,to:140,pressing:true}),{kind:'defer',height:83,target:140});
 assert.deepEqual(transition({from:83,to:83,pressing:true}),{kind:'snap',height:83});
});
