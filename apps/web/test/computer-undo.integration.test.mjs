import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {createViewingIntent} from '../shell/viewing-state.js';
import {resolveInitialSelectionHydration} from '../shell/selection-hydration.js';

const source = readFileSync(new URL('../shell/app.js', import.meta.url), 'utf8');
const start = source.indexOf('  if (action === "revert-to-move" || action === "undo-last-move")');
const end = source.indexOf('  if (action === "join-viewer"', start);
assert.ok(start > 0 && end > start);
const undo = new vm.Script(`(async () => {${source.slice(start, end)}})()`);
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

const undoHarness = () => {
  const calls = [], feedback = [], returns = [], viewingIntent = createViewingIntent();
  const game = { gameplayRevision: 1, moves: [{moveId:'move',undone:false}], computer: {manual:true}, canControlComputer:true };
  const context = vm.createContext({
    action:'undo-last-move',actionEl:{getAttribute:name=>name==='data-game-id'?'original':'move'},
    account:{snapshot:()=>({generation:context.generation})},generation:1,
    viewedGame:'original',getCurrentViewedGameId:()=>context.viewedGame,
    viewingIntent,viewingScope:()=>String(context.generation),
    maybeReturnAfterUndo:id=>{if(viewingIntent.observeUndo(id,game,String(context.generation)))returns.push(id);},
    setUndoRequestFeedback:(id,message)=>feedback.push({id,message}),
  });
  context.transport={getGameViewModel:()=>game,requestRevertToMove:()=>{calls.push('revert');return{committed:Promise.resolve()};}};
  context.computerSession={withMutation:async work=>{calls.push('mutation');return work();},action:async action=>{calls.push(action);},tick:async()=>{calls.push('tick');}};
  return{context,game,calls,feedback,returns,viewingIntent};
};

for(const boundary of ['mutation','pause'])test(`a rejected ${boundary} clears undo intent and reports failure before any revert request`,async()=>{
  const {context,game,calls,feedback,returns,viewingIntent}=undoHarness();
  let token;const begin=viewingIntent.beginUndo.bind(viewingIntent);
  viewingIntent.beginUndo=(...args)=>(token=begin(...args));
  if(boundary==='mutation')context.computerSession.withMutation=async()=>{calls.push('mutation');throw Error('lease unavailable');};
  else context.computerSession.action=async action=>{calls.push(action);throw Error('pause rejected');};
  await assert.doesNotReject(undo.runInContext(context));
  assert.deepEqual(calls,boundary==='mutation'?['mutation']:['mutation','pause']);
  assert.deepEqual(feedback,[{id:'original',message:'Undo could not finish'}]);
  // Even a later matching authoritative restoration cannot revive a canceled
  // pre-request token and unexpectedly move the user back to live play.
  viewingIntent.commitUndo('original',token);
  game.gameplayRevision=2;game.moves[0].undone=true;
  assert.equal(viewingIntent.observeUndo('original',game,'1'),false);
  assert.deepEqual(returns,[]);
});

for(const boundary of ['tick','resume'])test(`accepted undo remains accepted when subsequent ${boundary} recovery rejects`,async()=>{
  const {context,game,calls,feedback,returns}=undoHarness();
  const committed=deferred(),requested=deferred();
  context.transport.requestRevertToMove=()=>{calls.push('revert');requested.resolve();return{committed:committed.promise};};
  if(boundary==='tick')context.computerSession.tick=async()=>{calls.push('tick');throw Error('lease reacquisition rejected');};
  else context.computerSession.action=async action=>{calls.push(action);if(action==='resume')throw Error('resume rejected');};
  const result=undo.runInContext(context);
  await requested.promise;
  assert.deepEqual(calls,['mutation','pause','revert']);
  game.gameplayRevision=2;game.moves[0].undone=true;committed.resolve();
  await assert.doesNotReject(result);
  // Let rejection handlers drain. node:test also fails on any unhandled
  // rejection escaping the actual extracted application event handler.
  await new Promise(setImmediate);
  assert.deepEqual(calls,boundary==='tick'?['mutation','pause','revert','tick']:['mutation','pause','revert','tick','resume']);
  assert.deepEqual(returns,['original']);assert.deepEqual(feedback,[]);
  assert.equal(game.gameplayRevision,2);assert.equal(game.moves[0].undone,true);
});

for(const boundary of ['mutation','committed'])test(`a stale ${boundary} rejection cannot cancel a newer same-game undo after an authority switch`,async()=>{
  const {context,game,calls,feedback,returns}=undoHarness();
  const old=deferred(),oldReached=deferred(),fresh=deferred(),freshReached=deferred();
  if(boundary==='mutation')context.computerSession.withMutation=async()=>{oldReached.resolve();await old.promise;};
  else context.transport.requestRevertToMove=()=>{oldReached.resolve();return{committed:old.promise};};
  const stale=undo.runInContext(context);await oldReached.promise;
  context.generation++;
  context.transport={getGameViewModel:()=>game,requestRevertToMove:()=>{freshReached.resolve();return{committed:fresh.promise};}};
  context.computerSession={withMutation:async work=>work(),action:async action=>calls.push(action),tick:async()=>calls.push('tick')};
  const current=undo.runInContext(context);await freshReached.promise;
  old.reject(Error('old authority failed'));await assert.doesNotReject(stale);
  assert.deepEqual(feedback,[]);
  game.gameplayRevision=2;game.moves[0].undone=true;fresh.resolve();
  await assert.doesNotReject(current);await new Promise(setImmediate);
  assert.deepEqual(returns,['original'],'Only the fresh authority owns the surviving undo intent');
  assert.deepEqual(feedback,[]);
});

for (const boundary of ['mutation', 'pause', 'committed', 'acquire']) {
  test(`undo never continues in a different game or account after ${boundary}`, async () => {
    for (const change of ['game', 'account', 'transport', 'none']) {
      const held = deferred(), reached = deferred(), calls = [];
      const wait = async point => { if (point === boundary) { reached.resolve(); await held.promise; } };
      const game = { computer: { manual: true, lease: { deviceId: 'other-valid-lease' } }, canControlComputer: true };
      const transport = { getGameViewModel: () => game, requestRevertToMove: () => { calls.push('revert'); return { committed: wait('committed') }; } };
      const context = vm.createContext({
        action: 'undo-last-move', actionEl: { getAttribute: name => name === 'data-game-id' ? 'original' : 'move' },
        transport, account: { snapshot: () => ({ generation: context.generation }) }, generation: 1,
        viewedGame: 'original', getCurrentViewedGameId: () => context.viewedGame,
        viewingIntent:createViewingIntent(),viewingScope:()=>String(context.generation),maybeReturnAfterUndo:()=>{},
        computerSession: { withMutation: async work => { await wait('mutation'); return work(); }, action: async action => { calls.push(action); await wait(action); }, tick: async () => { calls.push('tick'); await wait('acquire'); } },
      });
      const result = undo.runInContext(context);
      await reached.promise;
      if (change === 'game') context.viewedGame = 'another-owned-game';
      if (change === 'account') context.generation++;
      if (change === 'transport') context.transport = { ...transport };
      held.resolve(); await result;
      assert.equal(calls.includes('resume'), change === 'none');
      if (change === 'none') assert.deepEqual(calls, ['pause', 'revert', 'tick', 'resume']);
      else if (boundary === 'mutation') assert.deepEqual(calls, []);
      else if (boundary === 'pause') assert.deepEqual(calls, ['pause']);
      else if (boundary === 'committed') assert.deepEqual(calls, ['pause', 'revert']);
      else assert.deepEqual(calls, ['pause', 'revert', 'tick']);
    }
  });
}

// Use the actual return handler and both mount hydration paths: clearing the
// runtime alone must not restore the undone target on the following render.
const slice = (from, to) => {
  const start=source.indexOf(from),end=source.indexOf(to,start);
  assert.ok(start>=0 && end>start,`Undo hydration source boundary: ${from}`);
  return source.slice(start,end);
};
const undoSelectionScript = new vm.Script(`
  ${slice('const getSelectionHydrationGame =','const isPlayerRole =')}
  ${slice('const maybeReturnAfterUndo =','const syncConfirmedPlayback =')}
  globalThis.returnAfterUndo = () => maybeReturnAfterUndo('g');
  globalThis.hydrate = () => {
    const game = transport.getAuthoritativeGame('g');
    const snapshot = game.board.state, effectiveLegalActions = game.legalActions;
    ${slice('  const selectionHydrationGame =','  if (!snapshot) {')}
    return {scenario:scenarioSelectionHydration,initial:initialSelectionHydration};
  };
`);
function hydrationHarness(continuation=null) {
  const action={type:continuation?.type==='push'?'retreat':continuation?'rush':'move',actorId:'C1',from:{row:2,col:5},to:{row:2,col:6}};
  const state={sideToMove:'P1',turnIndex:0,continuation,pieces:[{id:'C1',position:action.from}]};
  const game={id:'g',gameplayRevision:2,moves:[{moveId:'m',undone:true}],lastRestoration:{decisionId:'m',at:'restore-1'},board:{state},
    inHistoryMode:false,canRecordMove:true,legalActions:[action],initialSelectionAction:action,
    pendingScenarioSelection:{source:action.from,target:action.to,actorSide:'P1',turnIndex:0}};
  const viewingIntent=createViewingIntent(),token=viewingIntent.beginUndo('g',{targetMoveId:'m',revision:1,scope:'a'});
  viewingIntent.commitUndo('g',token);
  const calls=[],context=vm.createContext({
    currentRoute:{name:'game',gameId:'g'},viewingIntent,viewingScope:()=> 'a',
    consumedInitialSelectionActionKeyByGameId:new Map(),
    toStableKey:JSON.stringify,resolveInitialSelectionHydration,
    transport:{getAuthoritativeGame:()=>game,returnToLive:()=>calls.push('live')},
    boardRuntime:{clearSelection:()=>calls.push('clear')},mountedOverlayKey:'old',
    getShellLayoutMode:()=> 'wide',
  });
  undoSelectionScript.runInContext(context);
  return {context,game,action,calls,viewingIntent};
}
test('accepted ordinary undo clears both legal old previews before the next board render',()=>{
  const h=hydrationHarness();
  const restoration=h.game.lastRestoration;
  h.game.lastRestoration=null;
  assert.deepEqual(h.context.hydrate().initial.selectionAction,h.action,'An independent branch seed still hydrates');
  assert.deepEqual(h.context.hydrate().scenario.selectionAction,h.action);
  h.game.lastRestoration=restoration;
  h.context.returnAfterUndo();
  assert.deepEqual(h.calls,['clear','live']);
  for(let i=0;i<2;i++) {
    const hydration=h.context.hydrate();
    assert.equal(hydration.initial.selectionAction,null);
    assert.equal(hydration.scenario.selectionAction,null);
    assert.equal(hydration.scenario.selectionState,null);
  }
  assert.deepEqual(h.game.initialSelectionAction,h.action,'The authoritative restored record stays untouched');
  assert.deepEqual(h.game.pendingScenarioSelection.target,h.action.to);
  h.game.initialSelectionAction=null;
  assert.deepEqual(h.context.hydrate().scenario.selectionAction,h.action,'A newly loaded scenario seed is independent of the consumed undo preview');
});
for(const continuation of [{type:'rush'},{type:'push',phase:'retreat'}]) test(`undo preserves currently legal ${continuation.type} continuation hydration`,()=>{
  const h=hydrationHarness(continuation);h.context.returnAfterUndo();
  assert.deepEqual(h.calls,['clear','live']);
  const hydration=h.context.hydrate();
  assert.deepEqual(hydration.initial.selectionAction,h.action);
  assert.deepEqual(hydration.scenario.selectionAction,h.action);
  h.game.legalActions=[];
  assert.equal(h.context.hydrate().initial.selectionAction,null,'Continuation restoration never invents legality');
  assert.equal(h.context.hydrate().scenario.selectionAction,null);
});
test('browsing a different move while undo is pending never clears selection or returns to live',()=>{
  const h=hydrationHarness();h.viewingIntent.navigate('g');h.context.returnAfterUndo();
  assert.deepEqual(h.calls,[]);
  assert.deepEqual(h.game.initialSelectionAction,h.action);
  assert.deepEqual(h.game.pendingScenarioSelection.target,h.action.to);
  assert.equal(h.context.mountedOverlayKey,'old','No history view or board selection is cleared');
});
