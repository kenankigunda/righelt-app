import test from 'node:test';
import assert from 'node:assert/strict';
import {terminalPushFrame} from '../../src/terminal-push-frame.ts';
import {deterministicStateHash} from '../../src/hash.ts';
const point=(row,col)=>({row,col});
const fixture=()=>{
 const state={boardSize:10,sideToMove:'P2',turnIndex:4,outcome:{status:'ongoing'},pieces:[
  {id:'A',owner:'P1',kind:'unit',position:point(4,5),supplied:true,commanded:true,shifted:true},
  {id:'D',owner:'P2',kind:'unit',position:point(4,5),supplied:false,commanded:false,pushed:true,shifted:false},
 ],continuation:{type:'push',phase:'retreat',owner:'P2',attackerOwner:'P1',pushedPieceId:'D',followPoint:point(4,4),followGroupPieceIds:['A'],chainLength:1}};
 return {state,push:{decisionId:'saved-push',frameHash:deterministicStateHash(state),action:{type:'push',actorId:'A',targetId:'D',from:point(4,4),to:point(4,5)}}};
};
test('a proved terminal overlap has one ordinary occupant while preserving the exact defender and recorded frame',()=>{
 const {state,push}=fixture(),before=structuredClone(state),result=terminalPushFrame(state,{status:'p1_win',reason:'proof'},push);
 assert.equal(result.kind,'normalized');const frame=result.frame;
 assert.deepEqual(state,before);assert.deepEqual(frame.recorded,before);
 assert.deepEqual(frame.occupancy.pieces.map(p=>p.id),['A']);assert.equal(frame.occupancy.continuation,null);
 assert.deepEqual(frame.displacement.piece,before.pieces[1]);assert.equal(frame.displacement.decisionId,'saved-push');
 assert.deepEqual(frame.displacement.action,push.action);assert.notEqual(frame.displacement.action,push.action);assert.notEqual(frame.displacement.action.from,push.action.from);assert.notEqual(frame.displacement.action.to,push.action.to);
 const reopened=JSON.parse(JSON.stringify(frame));assert.deepEqual(reopened,frame);
 assert.deepEqual(reopened.recorded.pieces,before.pieces,'Undo/branch can restore the original acknowledged frame without invented retreat/removal');
 assert.equal('destroyedPieces' in frame,false);
});
test('missing, wrong and unsupported provenance stays unknown and recorded completed outcomes are untouched',()=>{
 const {state,push}=fixture();
 for(const proof of [undefined,{...push,decisionId:''},{...push,frameHash:'wrong'},{...push,action:{...push.action,targetId:'wrong'}},{...push,action:{...push.action,from:point(0,0)}}])assert.equal(terminalPushFrame(state,{status:'draw'},proof).kind,'unknown');
 const completed={...state,outcome:{status:'p2_win',reason:'historical'}};const before=structuredClone(completed);
 assert.equal(terminalPushFrame(completed,{status:'p1_win'},push).kind,'unknown');assert.deepEqual(completed,before);
 assert.equal(terminalPushFrame(state,{status:'ongoing'},push).kind,'unknown');
});
