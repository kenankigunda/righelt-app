import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {replayProductionDecision} from '../production-corpus.mjs';
import {deterministicStateHash} from '../../../packages/game-engine/src/index.ts';
import {proveRelevantContinuation} from '../../../packages/game-engine/src/early-ending-proof.ts';
import {transitionArchivedAction} from '../archived-action.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/automatic-rush-settlement.json',import.meta.url)));

test('historical optional traversal diagnostics do not change verified finality or rewrite records',()=>{
 const next=transitionArchivedAction(fixture.before,fixture.action,fn=>fn());
 const live=proveRelevantContinuation(next,next.continuation.owner);
 assert.equal(live.kind,'proven-terminal');assert.equal(live.optionalEndpointCount,0);
 assert.equal(fixture.expectedCause.optionalEndpointCount,8835);
 const retained=JSON.stringify(fixture);
 const replayed=replayProductionDecision(fixture.before,fixture.action,fixture.after,fn=>fn(),undefined,{expectedCause:fixture.expectedCause});
 assert.equal(deterministicStateHash(replayed.state),fixture.expectedHash);
 assert.equal(JSON.stringify(fixture),retained);
});

test('recorded automatic rush finality replays the exact board without inventing End Turn',()=>{
 const before=structuredClone(fixture.before),action=structuredClone(fixture.action);
 const replayed=replayProductionDecision(before,action,fixture.after,fn=>fn(),undefined,{expectedCause:fixture.expectedCause});
 assert.equal(replayed.state.outcome.status,'p2_win');assert.equal(deterministicStateHash(replayed.state),fixture.expectedHash);
 assert.equal(replayed.automaticEnding.kind,'proven-terminal');assert(replayed.automaticEnding.visitedNodes>0);
 assert.deepEqual(before,fixture.before);assert.deepEqual(action,fixture.action);
});
test('unknown continuation proof, wrong recorded board or outcome never admits terminal value',()=>{
 assert.throws(()=>replayProductionDecision(fixture.before,fixture.action,fixture.after,fn=>fn(),undefined,{maxExpansions:1,expectedCause:fixture.expectedCause}),/Unverified/);
 const wrong=structuredClone(fixture.after,fn=>fn(),undefined,{expectedCause:fixture.expectedCause});wrong.pieces[0].position.row=(wrong.pieces[0].position.row+1)%10;
 assert.throws(()=>replayProductionDecision(fixture.before,fixture.action,wrong,fn=>fn(),undefined,{expectedCause:fixture.expectedCause}),/mismatch/);
 const outcome=structuredClone(fixture.after,fn=>fn(),undefined,{expectedCause:fixture.expectedCause});outcome.outcome.status='p1_win';assert.throws(()=>replayProductionDecision(fixture.before,fixture.action,outcome,fn=>fn(),undefined,{expectedCause:fixture.expectedCause}),/Unverified/);
});

test('recorded cause must match independently enumerated finality',()=>{
 for(const expectedCause of [{...fixture.expectedCause,endpointCount:0},{...fixture.expectedCause,kind:'invented'}])
  assert.throws(()=>replayProductionDecision(fixture.before,fixture.action,fixture.after,fn=>fn(),undefined,{expectedCause}),/cause/);
});
