import test from 'node:test';
import assert from 'node:assert/strict';
import {createTutorialController} from '../shell/tutorial.js';
import {createTutorialBoardHost} from '../board/hosts/tutorial-host.js';
import {validateAction} from '../generated/packages/game-engine/src/legal.js';
const timers={setTimeout:()=>0,clearTimeout:()=>{}};
const solve=c=>{const e=c.current().exercise;if(e.action)return c.handleAction(e.action);if(e.endTurn)return c.handleEndTurn();return c.inspect({selectedPieceId:e.inspect,overlay:{phase:'supplyCommand'}});};
test('every lesson action is engine legal, with real destruction, rush and victory',()=>{
 const c=createTutorialController({timers});c.start();let count=0;
 while(c.current().phase!=='complete'){
  const {exercise:e,state}=c.current();if(e.action)assert.equal(validateAction(state,e.action).ok,true,e.id);
  solve(c);assert.equal(c.current().phase,'success',e.id);
  if(e.id==='command')assert.equal(c.current().state.pieces.find(p=>p.id==='A').commanded,false);
  if(e.id==='destroy')assert.equal(c.current().state.pieces.some(p=>p.id==='D'),false);
  if(e.id==='rush-open'){assert.equal(c.current().state.pieces.find(p=>p.id==='U2-4').displaySupplied,false);assert.equal(validateAction(c.current().state,{type:'pass'}).ok,false);}
  if(e.id==='rush-connect')assert.equal(c.current().state.pieces.find(p=>p.id==='U2-4').displaySupplied,true);
  if(e.id==='retreat')assert.equal(c.current().state.sideToMove,'P1');
  c.next();count++;
 }assert.equal(count,15);assert.equal(c.current().state.outcome.status,'p1_win');c.destroy();
});

test('all teachers share engine exercises through the local board host',async()=>{
 for(const hostName of ['horus','babs','tau']){
  const c=createTutorialController({timers});c.start({host:hostName});const host=createTutorialBoardHost(c);
  while(c.current().phase!=='complete'){
   const e=c.current().exercise;const {state,legalActions}=await host.loadInitialState();
   if(e.action){assert.equal(validateAction(state,e.action).ok,true);assert.equal((await host.applyAction(structuredClone(state),e.action)).accepted,true);}
   else if(e.endTurn)assert.equal((await host.endTurn()).accepted,true);
   else {const moves=await host.loadPieceMoves(state,e.inspect);assert.ok(Array.isArray(moves.actions));solve(c);}
   assert.ok(Array.isArray(legalActions));c.next();
  }
  assert.equal(c.current().state.outcome.status,'p1_win');c.destroy();
 }
});
