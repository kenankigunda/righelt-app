import test from 'node:test';
import assert from 'node:assert/strict';
import {getGameResult} from '../shell/game-result.js';
import {createConfirmedResultOwner} from '../shell/confirmed-result.js';

const game=status=>({
  id:'g',terminalOutcome:{decisive:{actorIdentityId:'red',actorKind:'human'}},player1:{identityId:'red'},player2:{identityId:'blue'},
  board:{state:{outcome:{status,reason:'p2_commander_unsupplied'}}},
});

test('confirmed terminal state preempts queued presentation and exposes the result on the same observation',()=>{
  const transitions=createConfirmedResultOwner({getIdentityId:()=> 'red'});
  const playback={resets:0,reset(){this.resets++;}};
  assert.equal(transitions.observe(game('ongoing')).becameTerminal,false);

  if(transitions.observe(game('p1_win')).becameTerminal)playback.reset();
  assert.equal(transitions.evaluate('g',{current:true}).present,true);
  const result=getGameResult(game('p1_win'),'red');
  assert.equal(result?.title,'You won');
  assert.equal(playback.resets,1);
  assert.equal(transitions.observe(game('p1_win')).becameTerminal,false,'terminal transition is consumed once');
  assert.equal(transitions.evaluate('g',{current:true}).present,false);
  assert.equal(playback.resets,1,'repeated terminal observations do not reset playback again');
});

for(const option of ['inHistory','hidden','storyOpen'])test(`terminal playback retires and preserves deferred result ownership while ${option}`,()=>{
  const transitions=createConfirmedResultOwner(),playback={resets:0,reset(){this.resets++;}};
  transitions.observe(game('ongoing'));
  if(transitions.observe(game('draw')).becameTerminal)playback.reset();
  const options={current:true,visible:true,dialogOpen:false,inHistory:false};
  if(option==='hidden')options.visible=false;
  if(option==='storyOpen')options.dialogOpen=true;
  if(option==='inHistory')options.inHistory=true;
  assert.equal(transitions.evaluate('g',options).present,false);
  assert.equal(playback.resets,1);
});
