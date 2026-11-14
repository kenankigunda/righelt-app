import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './fixtures/tactical-learning-v1.json' with {type:'json'};
import {transition,legalActionMap} from '../../../packages/computer-player/src/index.ts';
import certificate from './fixtures/turn-defense-v1.json' with {type:'json'};
import {verifyWitness,verifyTurnDefense} from '../tactical-evidence.mjs';
const c=id=>fixture.cases.find(c=>c.id===id);
const check=(row,actions,expectedOutcome,maxActions=32)=>verifyWitness({state:row.state,stateHash:row.stateHash,actions,expectedOutcome,maxActions,milliseconds:5000,maxOperations:10000});
test('G54 no-retreat capture settles only after the five-action legal Red completion',async()=>{
 const row=c('G54-no-retreat-push');
 const short=await check(row,row.winningLine,'p1_win',4);
 assert.equal(short.disposition,'action-horizon'); assert.equal(short.outcome,'ongoing');assert.equal(short.terminalValueP1,null);
 const proof=await check(row,row.winningLine,'p1_win');
 assert.equal(proof.winningContinuation,true); assert.equal(proof.completedActions,5);assert.equal(proof.outcome,'p1_win');
 assert(proof.steps.every(s=>s.controller==='P1'));assert.equal(proof.globalShortestProven,false);
});
test('G64 projection and G74 corner finish win while nearby endpoint moves do not',async()=>{
 for(const id of ['G64-project-barrier','G74-finish-near-miss']) {
  const row=c(id),outcome=id==='G64-project-barrier'?'p1_win':'p2_win';
  assert.equal((await check(row,row.winningLine,outcome)).winningContinuation,true);
  const contrast=await check(row,row.nonwinningLine??[row.observedAlternative,{type:'end_turn'}],'ongoing');
  assert.equal(contrast.outcome,'ongoing');assert.equal(contrast.winningContinuation,false);assert.equal(contrast.globalSafetyProven,false);
 }
});
test('multi-rush completion, forced responses and opponent reply witnesses stay distinct',async()=>{
 const row=c('S03-24-four-rush-finish');assert.equal((await check(row,row.winningLine,'p2_win')).winningContinuation,true);
 const forced=c('S07-18-already-forced-loss');
 assert.equal(forced.completeLegalActionInventory.length,10);
 for(const p of forced.proofs){const proof=await check(forced,[p.action,...p.winningReply],'p1_win');assert.equal(proof.outcome,'p1_win');assert.equal(proof.winningContinuation,false);}
});
test('tampered roots, wrong controllers and horizon exhaustion cannot manufacture proof',async()=>{
 const row=c('G54-no-retreat-push');
 await assert.rejects(verifyWitness({state:row.state,stateHash:'0'.repeat(64),actions:row.winningLine,maxActions:32,milliseconds:10,maxOperations:1000}),/root identity/);
 await assert.rejects(check(row,[{type:'retreat',actorId:'C2',from:{row:7,col:3},to:{row:6,col:3}}],'p1_win'),/not legal/);
 const proof=await verifyWitness({state:row.state,stateHash:row.stateHash,actions:row.winningLine,expectedOutcome:'p1_win',maxActions:32,milliseconds:5000,maxOperations:1});
 assert.equal(proof.disposition,'incomplete');assert.equal(proof.winningContinuation,false);
});

test('friendly blocker escape is a local retreat predicate; commander advance still exposes a counterpush',async()=>{
 const escape=c('G53-vacate-friendly-blocker');let state=escape.state;
 for(const action of escape.blueSequence)state=transition(state,action);
 state=transition(state,c('G54-no-retreat-push').winningLine[0]);
 const retreats=[...legalActionMap(state).values()].filter(a=>a.type==='retreat');
 assert(retreats.some(a=>a.to.row===8&&a.to.col===3));
 const preparation=c('G35-commander-preparation');state=preparation.state;
 for(const action of preparation.variation)state=transition(state,action);
 assert([...legalActionMap(state).values()].some(a=>a.type==='push'&&a.from.row===2&&a.from.col===7&&a.to.row===2&&a.to.col===6));
 const proof=await check(preparation,preparation.variation,'ongoing');assert.equal(proof.winningContinuation,false);assert.equal(proof.rootOptimalValueP1,null);
});

test('one-turn defense checks all opponent alternatives and rejects fabricated closure',async()=>{
 const result=await verifyTurnDefense(certificate,{milliseconds:5000,maxNodes:10000});
 assert.equal(result.disposition,'complete');assert.equal(result.verifiedNodes,798);assert.equal(result.globalSafetyProven,false);assert.equal(result.terminalValueP1,null);
 const incomplete=structuredClone(certificate);incomplete.nodes.find(n=>n.kind==='choice'&&n.controller==='P1'&&n.edges.length>1).edges.pop();
 await assert.rejects(verifyTurnDefense(incomplete,{milliseconds:5000,maxNodes:10000}),/missing opponent alternative/);
 const falseBoundary=structuredClone(certificate);const root=falseBoundary.nodes.find(n=>n.id===falseBoundary.proofRoot);root.kind='turn-boundary';root.edges=[];
 await assert.rejects(verifyTurnDefense(falseBoundary,{milliseconds:5000,maxNodes:10000}),/false complete-opponent-turn boundary/);
 const bounded=await verifyTurnDefense(certificate,{milliseconds:5000,maxNodes:1});assert.equal(bounded.disposition,'incomplete');
});
