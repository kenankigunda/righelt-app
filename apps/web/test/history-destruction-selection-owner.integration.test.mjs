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
  const animation=createHistoryDestructionAnimationOwner();
  const claims=[];
  let actions;
  actions=createHistorySelectionActions({
    transition,
    onPendingChange:episode=>pendingChanges.push(episode?.key??null),
    onPresentationReady:episode=>{
      const claimed=animation.claim(game,episode,true);
      claims.push(claimed);
      if(claimed)actions.consumePresentation(episode.key);
    },
  });
  const transport=deferred();
  const game={id:'game',inHistoryMode:true,historyTurnIndex:16};

  const selection=actions.run({
    scope:'game:turn:17',
    select:()=>transport.promise,
    accepted:()=>game.historyTurnIndex===17,
  });
  game.historyTurnIndex=17;
  assert.equal(actions.presentation(),null,'the matching transport render is not authoritative before acceptance');
  assert.equal(animation.claim(game,actions.presentation(),true),false);
  transport.resolve({accepted:true});
  assert.deepEqual(await selection,{accepted:true,value:{accepted:true}});
  assert.deepEqual(pendingChanges.map(value=>value===null?null:value.replace(/^history-selection:\d+:/,'history-selection:N:')),[
    'history-selection:N:game:turn:17',null,
  ]);

  assert.deepEqual(claims,[true]);
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
  assert.equal(actions.presentation(),null,'neither stale nor newer pending intent is animation authority');
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

test('rejected same-turn pending selection cannot animate an intervening matching render',async()=>{
  const transition=createHistorySelectionTransition({reducedMotion:()=>true});
  const actions=createHistorySelectionActions({transition});
  const animation=createHistoryDestructionAnimationOwner();
  const transport=deferred();
  const game={id:'game',inHistoryMode:true,historyTurnIndex:17};
  const selection=actions.run({scope:'game:turn:17',select:()=>transport.promise,accepted:()=>false});

  assert.equal(actions.presentation(),null);
  assert.equal(animation.claim(game,actions.presentation(),true),false,'same-turn render while pending remains silent');
  transport.resolve('rejected');
  assert.deepEqual(await selection,{accepted:false,value:'rejected'});
  assert.equal(actions.presentation(),null,'rejection cannot retain the unaccepted intent');
});
