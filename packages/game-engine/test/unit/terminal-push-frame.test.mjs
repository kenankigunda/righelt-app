import test from 'node:test';
import assert from 'node:assert/strict';
import {terminalPushFrame} from '../../src/terminal-push-frame.ts';
import {deterministicStateHash} from '../../src/hash.ts';
import {serializeState,deserializeState} from '../../src/serialize.ts';
import {createInitialState} from '../../src/state.ts';
import {normalizeState} from '../../src/deterministic.ts';
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

test('states without terminal metadata retain their actual-ba5 hash and new states round-trip canonically',()=>{
 const initial=createInitialState();
 assert.equal(deterministicStateHash(initial),'2eff44a43854b2f89d77c0fe4a02729444f06f8abe4e4cf87947fe4f6c8ed7a4');
 assert.equal('terminalDisplacement' in deserializeState(serializeState(initial)),false);
 const {state,push}=fixture(),result=terminalPushFrame(state,{status:'p1_win'},push);
 const normalized=normalizeState(result.frame.occupancy);assert.deepEqual(normalized.terminalDisplacement,result.frame.displacement);assert.notEqual(normalized.terminalDisplacement,result.frame.displacement);
 const encoded=serializeState(result.frame.occupancy),restored=deserializeState(encoded);
 assert.equal(serializeState(restored),encoded);assert.deepEqual(restored.terminalDisplacement,result.frame.displacement);
 assert.notEqual(restored.terminalDisplacement,result.frame.displacement);assert.notEqual(restored.terminalDisplacement.action,result.frame.displacement.action);
 const changed=structuredClone(restored);changed.terminalDisplacement.decisionId='different-acknowledged-push';
 assert.notEqual(deterministicStateHash(changed),deterministicStateHash(restored));
});
test('terminal displacement cannot smuggle an occupant, ongoing obligation or recursive frame through serialization',()=>{
 const {state,push}=fixture(),good=terminalPushFrame(state,{status:'draw'},push).frame.occupancy;
 const invalid=[];
 for(const mutate of [s=>{s.outcome.status='ongoing';},s=>{s.continuation=state.continuation;},s=>{s.pieces.push(structuredClone(s.terminalDisplacement.piece));},s=>{s.terminalDisplacement.action.targetId='wrong';},s=>{s.terminalDisplacement.frameHash='unproven';},s=>{s.terminalDisplacement.recorded=state;},s=>{s.terminalDisplacement.piece.position.row=99;}]){const value=structuredClone(good);mutate(value);invalid.push(value);}
 for(const value of invalid){assert.throws(()=>serializeState(value),/Invalid terminal displacement/);assert.throws(()=>deserializeState(JSON.stringify(value)),/Invalid terminal displacement/);}
 for(const mutate of [s=>{s.terminalDisplacement.action.from.extra={nested:{payload:'unknown'}};},s=>{s.terminalDisplacement.action.to.extra='unknown';},s=>{s.terminalDisplacement.piece.position.extra='unknown';},s=>{s.pieces.push({...s.pieces[0],id:'collision'});},s=>{s.pieces.push({...s.pieces[0],id:'other-pushed',position:point(1,1),pushed:true});}]){
  const value=structuredClone(good);mutate(value);assert.throws(()=>serializeState(value),/Invalid terminal displacement/);assert.throws(()=>deserializeState(JSON.stringify(value)),/Invalid terminal displacement/);
 }
 const recursive=structuredClone(good);recursive.terminalDisplacement.action.from.extra=recursive.terminalDisplacement.action.from;
 assert.throws(()=>serializeState(recursive),/Invalid terminal displacement/,'reject a recursive coordinate before semantic hashing');
 assert.equal(good.pieces.some(piece=>piece.id==='D'),false);
});
