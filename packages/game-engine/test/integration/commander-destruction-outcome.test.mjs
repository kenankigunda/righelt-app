import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAction,validateAction,listLegalActions} from '../../src/index.ts';
import {resolveToStability} from '../../src/resolve.ts';
import {commander,unit,makeState} from '../helpers/state-builders.mjs';
import {commanderOutcome} from '../../../shared-types/src/commander-outcome.js';
import {resolveToStability as browserResolve} from '../../../../apps/web/generated/packages/game-engine/src/resolve.js';
import {replayActions} from '../../src/replay.ts';

for(const artifactMode of ['minimal','full'])test(`an actual no-retreat push retains commander destruction as its terminal cause (${artifactMode})`,()=>{
 const state=makeState({pieces:[commander('C1','P1',3,6),commander('C2','P2',4,2),unit('A1','P1',4,1),unit('A2','P1',3,1),unit('B1','P1',3,2),unit('B2','P2',5,2),unit('B3','P1',4,3)]});
 const push={type:'push',actorId:'A1',from:{row:4,col:1},to:{row:4,col:2}};
 assert.equal(validateAction(state,push).ok,true);
 const events=[];
 const pushed=applyAction(state,push,{onRemoval:event=>events.push(event)}).state;
 assert.equal(pushed.pieces.some(piece=>piece.id==='C2'),false);
 assert.equal(events.find(event=>event.piece.id==='C2')?.reason,'no_retreat');
 let followed=pushed;
 for(let step=0;followed.continuation&&step<8;step++){
  const legal=listLegalActions(followed),next=legal.find(action=>action.type==='follow')??legal.find(action=>action.type==='end_turn'||action.type==='pass');
  assert(next,'the real sequence must expose a legal continuation');
  followed=resolveToStability(applyAction(followed,next).state,{artifactMode});
 }
 assert.equal(followed.continuation,null);
 const resolved=resolveToStability(structuredClone(followed),{artifactMode});
 assert.deepEqual(resolved.outcome,{status:'p1_win',reason:'p2_commander_destroyed'});
 assert.deepEqual(browserResolve(structuredClone(followed),{artifactMode}).outcome,resolved.outcome);
 assert.deepEqual(listLegalActions(resolved),[]);
});

test('draws preserve both actual commander defeat causes without changing outcome semantics',()=>{
 assert.deepEqual(commanderOutcome([]),{status:'draw',reason:'both_commanders_destroyed'});
 assert.deepEqual(commanderOutcome([commander('C1','P1',3,6,{supplied:false})]),{status:'draw',reason:'p1_commander_unsupplied_p2_destroyed'});
 assert.deepEqual(commanderOutcome([commander('C2','P2',6,3,{supplied:false})]),{status:'draw',reason:'p1_commander_destroyed_p2_unsupplied'});
});

test('retained terminal outcomes and replay checkpoints keep their original reason bytes',()=>{
 const saved=makeState({pieces:[commander('C1','P1',3,6)],outcome:{status:'p1_win',reason:'p2_commander_unsupplied'}});
 const before=structuredClone(saved);
 assert.deepEqual(resolveToStability(structuredClone(saved)).outcome,before.outcome);
 assert.deepEqual(browserResolve(structuredClone(saved)).outcome,before.outcome);
 assert.deepEqual(replayActions(saved,[],{includeTrace:true}).finalState.outcome,before.outcome);
 assert.deepEqual(saved,before);
});
