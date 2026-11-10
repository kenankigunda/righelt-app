import test from 'node:test';
import assert from 'node:assert/strict';
import { mandatoryFollowAction } from '../shell/forced-follow.js';
import { followGame } from './support/forced-follow.mjs';

test('real engine mandatory follow is automatic only when it is the sole legal action', () => {
  const game = followGame(), before = structuredClone(game);
  assert.equal(game.legalActions.length,1); assert.equal(mandatoryFollowAction(game).actorId,'F1');
  assert.equal(mandatoryFollowAction(followGame({multiple:true})),null);
  assert.equal(mandatoryFollowAction({...game,legalActions:[...game.legalActions,{type:'end_turn'}]}),null);
  assert.equal(mandatoryFollowAction({...game,legalActions:[]}),null);
  assert.equal(mandatoryFollowAction({...game,board:{state:{...game.board.state,continuation:{type:'rush'}}}}),null);
  assert.equal(mandatoryFollowAction({...game,board:{state:{...game.board.state,outcome:{status:'p1_win'}}}}),null);
  assert.deepEqual(game,before);
});
