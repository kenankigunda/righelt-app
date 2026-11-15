import test from 'node:test';
import assert from 'node:assert/strict';
import {teacherExitFixture} from './teacher-exit-fixture.mjs';
import {verifyTeacherExit} from '../verify-teacher-exit.mjs';
import {legalActionMap,transition,terminalValue} from '../../../packages/computer-player/src/index.ts';
import {createInitialState,resolveToStability,deterministicStateHash} from '../../../packages/game-engine/src/index.ts';

test('actual zero-simulation terminal teacher policy is proved for its entire support',async()=>{
  const f=await teacherExitFixture();assert.equal(f.answer.reason,'immediate-win');assert.equal(f.answer.simulations,0);
  const proof=verifyTeacherExit({...f,milliseconds:5000});
  assert.equal(proof.actualSimulations,0);assert.equal(proof.support.length,f.answer.policy.filter(p=>p.probability>0).length);
  assert(proof.support.every(p=>p.kind==='terminal-win'));
});
test('a winning selected action cannot authorize a losing or unresolved policy-support action',async()=>{
  const f=await teacherExitFixture(),winner=f.position.controller==='P1'?1:-1;
  const other=[...legalActionMap(f.position.state)].find(([,action])=>terminalValue(transition(f.position.state,action))!==winner);
  assert(other);const answer=structuredClone(f.answer);
  answer.policy=[{index:answer.actionIndex,probability:.5},{index:other[0],probability:.5}];
  assert.throws(()=>verifyTeacherExit({...f,answer,milliseconds:5000}),/nonwinning terminal/);
});
test('a fabricated forced-win certificate cannot replace actual opponent-branch verification',()=>{
  const state=resolveToStability(createInitialState()),legal=legalActionMap(state),[index,action]=legal.entries().next().value;
  const position={state,stateHash:deterministicStateHash(state),controller:state.sideToMove,legal:[...legal.keys()]};
  const answer={reason:'forced-win',status:'ready',stopped:'complete',fallback:null,policyMask:true,
    legality:{complete:true,indices:position.legal},simulations:1,searchIdentity:{completedSimulations:1},
    actionIndex:index,action,policy:[{index,probability:1}],proof:{verified:true,omittedOpponentAlternatives:true}};
  assert.throws(()=>verifyTeacherExit({position,answer,milliseconds:5000}),/complete bounded win proof/);
});
test('spoofed root, controller, fallback, deadline and work counters cannot qualify early policy',async()=>{
  const f=await teacherExitFixture();
  for(const mutation of [x=>x.position.stateHash='0'.repeat(64),x=>x.position.controller=x.position.controller==='P1'?'P2':'P1',x=>x.answer.stopped='deadline',x=>x.answer.fallback={},x=>x.answer.searchIdentity.completedSimulations=1]){
    const changed=structuredClone(f);mutation(changed);assert.throws(()=>verifyTeacherExit({...changed,milliseconds:5000}));
  }
});
