import test from 'node:test';
import assert from 'node:assert/strict';
import {createResultTransitions,getGameResult} from '../shell/game-result.js';

const game=status=>({
  id:'g',player1:{identityId:'red'},player2:{identityId:'blue'},
  board:{state:{outcome:{status,reason:'p2_commander_unsupplied'}}},
});

test('confirmed terminal state preempts queued presentation and exposes the result on the same observation',()=>{
  const transitions=createResultTransitions();
  const playback={resets:0,reset(){this.resets++;}};
  assert.equal(transitions.observe(game('ongoing'),{},playback),false);

  assert.equal(transitions.observe(game('p1_win'),{},playback),true);
  const result=getGameResult(game('p1_win'),'red');
  assert.equal(result?.title,'You won');
  assert.equal(playback.resets,1);
  assert.equal(transitions.observe(game('p1_win'),{},playback),false,'terminal transition is consumed once');
  assert.equal(playback.resets,1,'repeated terminal observations do not reset playback again');
});

for(const option of ['inHistory','hidden','storyOpen'])test(`terminal playback retires without opening a result while ${option}`,()=>{
  const transitions=createResultTransitions(),playback={resets:0,reset(){this.resets++;}};
  transitions.observe(game('ongoing'),{},playback);
  assert.equal(transitions.observe(game('draw'),{[option]:true},playback),false);
  assert.equal(playback.resets,1);
});
