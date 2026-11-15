import assert from 'node:assert/strict';
import test from 'node:test';
import {createHistorySelectionActions} from '../shell/history-selection-actions.js';
import {createHistoryDestructionAnimationOwner} from '../shell/history-preview.js';
import {createHistorySelectionTransition} from '../shell/history-selection-transition.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise,resolve};
};

test('accepted socket-backed turn selection remains claimable until one matching render consumes it',async()=>{
  const transition=createHistorySelectionTransition({reducedMotion:()=>true});
  const pendingChanges=[];
  const actions=createHistorySelectionActions({transition,onPendingChange:episode=>pendingChanges.push(episode?.key??null)});
  const animation=createHistoryDestructionAnimationOwner();
  const transport=deferred();
  const game={id:'game',inHistoryMode:true,historyTurnIndex:16};

  const selection=actions.run({
    scope:'game:turn:17',
    select:()=>transport.promise,
    accepted:()=>game.historyTurnIndex===17,
  });
  game.historyTurnIndex=17;
  transport.resolve({accepted:true});
  assert.deepEqual(await selection,{accepted:true,value:{accepted:true}});
  assert.deepEqual(pendingChanges.map(value=>value===null?null:value.replace(/^history-selection:\d+:/,'history-selection:N:')),[
    'history-selection:N:game:turn:17',null,
  ]);

  const episode=actions.presentation();
  assert.equal(episode.scope,'game:turn:17','transport settlement cannot retire the deliberate presentation before render');
  assert.equal(animation.claim(game,episode,true),true);
  assert.equal(actions.consumePresentation(episode.key),true);
  assert.equal(actions.presentation(),null);
  assert.equal(animation.claim(game,actions.presentation(),true),false,'quiet refresh cannot replay the consumed episode');
});

test('superseded selections stay silent and a same-turn deliberate reselection creates a fresh episode',async()=>{
  const transition=createHistorySelectionTransition({reducedMotion:()=>true});
  const actions=createHistorySelectionActions({transition});
  const first=deferred(),second=deferred();
  const game={id:'game',inHistoryMode:true,historyTurnIndex:16};
  const run=(pending,turn)=>actions.run({scope:`game:turn:${turn}`,select:()=>pending.promise,accepted:()=>game.historyTurnIndex===turn});

  const stale=run(first,17);
  const current=run(second,18);
  game.historyTurnIndex=17;first.resolve('stale');
  assert.deepEqual(await stale,{accepted:false,value:'stale'});
  assert.equal(actions.presentation().scope,'game:turn:18','the stale settlement cannot replace the newer pending owner');
  assert.equal(createHistoryDestructionAnimationOwner().claim(game,actions.presentation(),true),false,'the newer owner cannot animate stale selected state');
  game.historyTurnIndex=18;second.resolve('current');
  assert.deepEqual(await current,{accepted:true,value:'current'});
  const original=actions.presentation();
  actions.consumePresentation(original.key);

  const reselection=deferred();
  const selectedAgain=run(reselection,18);
  reselection.resolve('again');
  assert.deepEqual(await selectedAgain,{accepted:true,value:'again'});
  assert.notEqual(actions.presentation().key,original.key);
  actions.retire();
  assert.equal(actions.presentation(),null,'navigation or background retirement cannot leave a latent replay owner');
});
