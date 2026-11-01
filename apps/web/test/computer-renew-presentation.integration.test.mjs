import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createCommandJournal} from '../shell/command-journal.js';
import {createLiveTransportStore} from '../shell/live-transport.js';
import {createComputerSession} from '../shell/computer-session.js';
import {opponentBoardMessage} from '../shell/opponent-narration.js';
import {recoveryMessage,isBoardRecoveryPending} from '../shell/recovery-view.js';
import {projectOptimisticGame} from '../shell/optimistic-live.js';
import {createShellBoardHost} from '../board/hosts/shell-host.js';
import {createRulesExecutor} from '../board/rules-runtime.js';
import {ACTION_CONTRACT_HEADER,ACTION_CONTRACT_VERSION} from '../generated/packages/shared-types/src/sync-protocol.js';
import {IDENTITY_KEY} from '../shell/persistence.js';
import {createInitialState,resolveToStability,listLegalActions,applyAction,validateAction} from '../generated/packages/game-engine/src/index.js';
import {createComputerControl,changeComputerControl,COMPUTER_TIMING} from '../generated/packages/shared-types/src/computer-play.js';

// IndexedDB admission/cleanup is an asynchronous transaction boundary. A fixed
// number of immediate turns can expire before its scheduled callback on Linux.
const waitForBoundary = async predicate => {
 const deadline=performance.now()+1000;
 while(performance.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}
 assert.fail('renewal fixture did not reach its expected boundary');
};

test('quiet renewal keeps its durable envelope without disabling legal human-turn gameplay',async t=>{
 let now=Date.now(),eventSeq=1,held,release,computations=0;
 const state=resolveToStability(createInitialState(),{artifactMode:'full'});state.turnIndex=2;
 const turn={index:2,playerSeat:'Player 1',status:'active',moveIndexes:[]};
 let game={id:'quiet-renew-game',createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),gameplayRevision:0,
  board:{state},currentSnapshot:state,currentTurn:turn,turns:[{index:1,status:'complete'},turn],
  moves:[{moveId:'prior-computer-move',index:0,turnIndex:1,snapshot:{...structuredClone(state),turnIndex:1,sideToMove:'P2'},action:{type:'project',from:{row:6,col:3},to:{row:6,col:1}},computerProof:{profile:'babs'}}],
  myRole:'Player 1',player1:{identityId:'owner'},player2:{identityId:'owner'},canControlComputer:true,canRecordMove:true,
  legalActions:listLegalActions(state),viewers:[],pendingJoinRequests:[],sharedReceipts:true,
  computer:createComputerControl('owner',{p1:null,p2:'babs'})};
 const journal=createCommandJournal({indexedDB:new IDBFactory()});
 const storage={getItem:key=>key===IDENTITY_KEY?'owner':null,setItem(){},removeItem(){}};
 const transport=createLiveTransportStore({storage,commandJournal:journal,fetcher:async(url,init={})=>{
  if(init.method==='POST'&&url.endsWith('/shared')){
   const command=JSON.parse(init.body),values=command.payload.values;
   if(values.action==='renew'){held=structuredClone(command);await new Promise(resolve=>{release=resolve;});}
   game={...game,computer:changeComputerControl(game.computer,{...values,ownerId:'owner',authContextId:'',turnIndex:2,now})};eventSeq++;
   return Response.json({ok:true,protocolVersion:2,gameId:game.id,eventSeq,gameplayRevision:game.gameplayRevision,game,
    commandOutcomes:[{gameId:game.id,identityId:command.identityId,clientCommandId:command.clientCommandId,fingerprint:command.fingerprint,outcome:'accepted',reason:null,eventSeq,gameplayRevision:game.gameplayRevision}]});
  }
  if(init.method==='POST'&&url.endsWith('/reconcile'))return Response.json({ok:true,protocolVersion:2,gameId:game.id,eventSeq,gameplayRevision:game.gameplayRevision,game,commandOutcomes:[]});
  return Response.json({ok:true,protocolVersion:2,eventSeq,game});
 }});
 const runtime={compute:async()=>{computations++;throw Error('human-turn renewal must not compute');},cancel(){}};
 let accountGeneration=1,visible=true;
 const session=createComputerSession({runtime,analysisRuntime:runtime,deviceId:'local-device',clock:()=>now,
  timers:{setInterval(){return 1;},clearInterval(){}},getContext:()=>({game:transport.getAuthoritativeGame(game.id),transport,accountGeneration,authenticated:true,visible})});
 t.after(()=>{release?.();session.destroy();transport.retire();});
 await transport.loadGame(game.id);await session.tick();
 assert.equal(session.snapshot().activity.label,'Active here');assert.deepEqual(await journal.list('owner',game.id),[]);
 assert.equal(transport.getGameViewModel(game.id).sharedMutationsBlocked,false);
 const boardMessage=view=>opponentBoardMessage(view,session.snapshot(),{},{canInteract:view.canRecordMove,identityId:'owner'});
 const hasPass=message=>(message.rows??[message]).some(row=>(row.actions??(row.action?[row.action]:[])).some(action=>action.id==='pass'));
 const narration=boardMessage(transport.getGameViewModel(game.id));assert.match(narration.text,/Babs projected/);assert.equal(hasPass(narration),true);
 now+=COMPUTER_TIMING.renewAfterMs;await session.tick();await waitForBoundary(()=>held);
 const original=structuredClone(held),view=transport.getGameViewModel(game.id);
 assert.equal(view.pendingCommandCount,1);assert.equal(view.sharedMutationsBlocked,true);
 assert.equal(view.canRecordMove,true,'a background renewal must not make a legal human action unavailable');
 assert.equal(view.gameplayMutationsBlocked,false);
 assert.deepEqual(await journal.list('owner',game.id),[original]);
 assert.deepEqual(view.pendingComputerControlRequest,{action:'renew',deviceId:'local-device',generation:game.computer.generation,submittedAt:original.submittedAt});
 const activity=session.snapshot().activity;
 assert.equal(activity.label,'Active here');assert.equal(activity.quietRenewal,true);
 assert.equal(recoveryMessage(view,now,{quietComputerRenewal:activity.quietRenewal}),'');
 assert.equal(isBoardRecoveryPending(view,{quietComputerRenewal:activity.quietRenewal,now}),false);
 const heldMessage=boardMessage(view);assert.equal(heldMessage.text,narration.text);assert.deepEqual(heldMessage.action,{id:'replay-computer',label:'Show me again'});assert.equal(hasPass(heldMessage),true);
 transport.selectHistoryMove({gameId:game.id,moveIndex:0});
 assert.equal(transport.getGameViewModel(game.id).inHistoryMode,true);
 assert.notEqual(transport.getAuthoritativeGame(game.id).inHistoryMode,true,'actual session context remains authoritative, not the history projection');
 assert.equal(session.snapshot().activity.quietRenewal,false);
 assert.equal(transport.getGameViewModel(game.id).sharedMutationsBlocked,true);
 assert.equal(transport.getGameViewModel(game.id).canRecordMove,false);
 assert.deepEqual(await journal.list('owner',game.id),[original]);
 transport.returnToLive({gameId:game.id});
 assert.equal(transport.getGameViewModel(game.id).inHistoryMode,false);
 assert.equal(session.snapshot().activity.quietRenewal,true);
 assert.equal(transport.getGameViewModel(game.id).sharedMutationsBlocked,true);
 assert.deepEqual(await journal.list('owner',game.id),[original]);
 await assert.rejects(transport.computerControl(game.id,{action:'pause',deviceId:'local-device',generation:game.computer.generation}),/sync_recovering/);
 view.pendingComputerControlRequest.action='pause';assert.deepEqual(await journal.list('owner',game.id),[original]);
 accountGeneration++;assert.equal(session.snapshot().activity.quietRenewal,false);accountGeneration--;
 visible=false;assert.equal(session.snapshot().activity.quietRenewal,false);visible=true;
 assert.deepEqual(await journal.list('owner',game.id),[original]);assert.equal(computations,0);
 release();await waitForBoundary(async()=>transport.getGameViewModel(game.id).pendingCommandCount===0&&(await journal.list('owner',game.id)).length===0);
 const final=transport.getGameViewModel(game.id);
 assert.equal(final.sharedMutationsBlocked,false);assert.equal(final.canRecordMove,true);assert.equal(final.pendingComputerControlRequest,null);
 assert.equal(final.moves.length,1);assert.deepEqual(final.moves,game.moves);assert.equal(computations,0);
 const finalMessage=boardMessage(final);assert.equal(finalMessage.text,narration.text);assert.equal(hasPass(finalMessage),true);
});

async function humanRenewalHarness(t,{gateProjection,controlAction='renew',initialState,startRenewal=true,rulesOverride,authenticated=false}={}) {
 const auth=authenticated?{enabled:true,session:{authenticated:true,account:{id:'owner'},contextId:'a'.repeat(64)}}:undefined;
 const now=Date.now(),state=initialState??resolveToStability(createInitialState(),{artifactMode:'full'});
 let game={id:'human-renewal',createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),gameplayRevision:0,
  board:{state},currentSnapshot:state,moves:[],turns:[{index:0,playerSeat:'Player 1',status:'active',moveIndexes:[]}],currentTurn:{index:0,playerSeat:'Player 1',status:'active',moveIndexes:[]},myRole:'Player 1',player1:{identityId:'owner'},player2:{identityId:'owner'},
  canControlComputer:true,canRecordMove:true,canEndTurn:Boolean(state.continuation),legalActions:listLegalActions(state),viewers:[],pendingJoinRequests:[],sharedReceipts:true,
  ...(authenticated?{ownershipMode:'account_v1'}:{}),
  computer:changeComputerControl(createComputerControl('owner',{p1:null,p2:'babs'}),{action:'acquire',deviceId:'device',ownerId:'owner',authContextId:auth?.session.contextId??'',generation:0,turnIndex:0,now})};
 let eventSeq=1,held,release;const actions=[];
 const journal=createCommandJournal({indexedDB:new IDBFactory()});
 const rules=rulesOverride??createRulesExecutor(),project=rules.project.bind(rules);
 rules.project=(scope,input)=>gateProjection&&scope.startsWith('admit:')?Promise.resolve(gateProjection()).then(()=>project(scope,input)):project(scope,input);
 const clientGame=value=>{const copy=structuredClone(value);if(authenticated&&copy.computer?.lease)delete copy.computer.lease.authContextId;return copy;};
 const reply=body=>Response.json(body.game?{...body,game:clientGame(body.game)}:body,{headers:{[ACTION_CONTRACT_HEADER]:String(ACTION_CONTRACT_VERSION)}});
 const store=createLiveTransportStore({auth,shouldDeferCommandSend:()=>!startRenewal,commandJournal:journal,rulesExecutor:rules,storage:{getItem:key=>key===IDENTITY_KEY?'owner':null,setItem(){},removeItem(){}},fetcher:async(url,init={})=>{
  if(init.method==='POST'&&url.endsWith('/shared')) {
   const command=JSON.parse(init.body);held=command;await new Promise(resolve=>{release=resolve;});
   let reason=null;try{game={...game,computer:changeComputerControl(game.computer,{...command.payload.values,ownerId:'owner',authContextId:command.authContextId??'',turnIndex:0,now:Date.now()})};}catch(error){reason=error.message;}eventSeq++;
   return reply({ok:true,protocolVersion:2,gameId:game.id,eventSeq,gameplayRevision:game.gameplayRevision,game,commandOutcomes:[{gameId:game.id,identityId:command.identityId,clientCommandId:command.clientCommandId,fingerprint:command.fingerprint,outcome:reason?'rejected':'accepted',reason,eventSeq,gameplayRevision:game.gameplayRevision}]});
  }
  if(init.method==='POST'&&(url.endsWith('/apply')||url.endsWith('/end-turn'))) {
   const command=JSON.parse(init.body);actions.push(command);
   assert.equal(command.expectedGameplayRevision,game.gameplayRevision,'renewal must not advance gameplay revision');
   assert.deepEqual(command.expectedState,game.board.state);
   const action=command.kind==='end_turn'?{type:'end_turn'}:command.payload.action;
   const next=applyAction(game.board.state,action,{artifactMode:'full'}).state;
   game={...game,board:{state:next},currentSnapshot:next,gameplayRevision:game.gameplayRevision+1,legalActions:listLegalActions(next),moves:[...game.moves,{moveId:command.clientCommandId,clientCommandId:command.clientCommandId,index:game.moves.length,action:command.payload.action,snapshot:next}]};eventSeq++;
   return reply({ok:true,protocolVersion:2,gameId:game.id,eventSeq,gameplayRevision:game.gameplayRevision,game,commandOutcomes:[{gameId:game.id,identityId:command.identityId,clientCommandId:command.clientCommandId,fingerprint:command.fingerprint,outcome:'accepted',reason:null,eventSeq,gameplayRevision:game.gameplayRevision}]});
  }
  return reply({ok:true,protocolVersion:2,eventSeq,game});
 }});
 let renewOutcome;t.after(async()=>{release?.();await renewOutcome;store.retire();});await store.loadGame(game.id);
 const renew=startRenewal?store.computerControl(game.id,{action:controlAction,deviceId:'device',generation:game.computer.generation}):Promise.resolve();
 renewOutcome=renew.then(()=>({ok:true}),error=>({ok:false,code:error.code}));
 if(startRenewal)await waitForBoundary(()=>held);
 return {store,journal,auth,renew,renewOutcome,game:()=>game,held:()=>held,release:()=>release(),actions,update:mutate=>{game=mutate(structuredClone(game));eventSeq++;store.applyLiveGameUpdate({game:clientGame(game),eventSeq});},renewNext:async()=>{held=null;const completion=store.computerControl(game.id,{action:'renew',deviceId:'device',generation:game.computer.generation});renewOutcome=completion.then(()=>({ok:true}),error=>({ok:false,code:error.code}));await waitForBoundary(()=>held);return {completion};}};
}

test('an explicit human Pass during held renewal is visibly admitted once with the unchanged gameplay revision',async t=>{
 const h=await humanRenewalHarness(t),original=h.held();
 const result=await h.store.applyGameAction({gameId:h.game().id,state:h.game().board.state,action:{type:'pass'}});
 assert.equal(result.accepted,true,JSON.stringify(result.validation));assert.equal(h.actions.length,0,'the shared receipt retains network ordering');
 assert.equal(h.store.getGameViewModel(h.game().id).pendingMoves.length,1,'explicit admitted play is visible, never a hidden callback');
 const saved=await h.journal.list('owner',h.game().id);assert.equal(saved.length,2);
 const action=saved.find(command=>command.kind==='action');assert.equal(action.expectedGameplayRevision,0);assert.deepEqual(action.predecessor,{clientCommandId:original.clientCommandId,fingerprint:original.fingerprint});
 h.release();await h.renew;await result.committed;
 assert.equal(h.actions.length,1);assert.equal(h.game().gameplayRevision,1);
 await waitForBoundary(async()=>!(await h.journal.list('owner',h.game().id)).length);
});

test('renewal settlement during human projection preserves a still-valid native intent',async t=>{
 let entered,finish;const gate=new Promise(resolve=>{finish=resolve;});const ready=new Promise(resolve=>{entered=resolve;});
 const h=await humanRenewalHarness(t,{gateProjection:()=>{entered();return gate;}});
 const result=h.store.applyGameAction({gameId:h.game().id,state:h.game().board.state,action:{type:'pass'}});
 await ready;h.release();await h.renew;finish();
 const admitted=await result;assert.equal(admitted.accepted,true);await admitted.committed;assert.equal(h.actions.length,1);
});

for(const [name,change] of [
 ['lost human authority',h=>h.update(game=>({...game,canRecordMove:false,canEndTurn:false}))],
 ['changed computer owner',h=>h.update(game=>({...game,computer:{...game.computer,ownerId:'another-owner'}}))],
 ['changed lease device',h=>h.update(game=>({...game,computer:{...game.computer,lease:{...game.computer.lease,deviceId:'another-device'}}}))],
 ['changed control generation',h=>h.update(game=>({...game,computer:{...game.computer,generation:game.computer.generation+1}}))],
 ['completed game',h=>h.update(game=>({...game,board:{state:{...game.board.state,outcome:{status:'p1_win',reason:'p2_commander_destroyed'}}}}))],
 ['expired lease',h=>h.update(game=>({...game,computer:{...game.computer,lease:{...game.computer.lease,expiresAt:Date.now()-1}}}))],
 ['independent recovery episode',h=>h.store.setConnectionRecovering(h.game().id,true)],
])test(`a pending renewal cannot hide ${name}`,async t=>{
 const h=await humanRenewalHarness(t);assert.equal(h.store.getGameViewModel(h.game().id).canRecordMove,true);
 change(h);const view=h.store.getGameViewModel(h.game().id);assert.equal(view.canRecordMove,false);assert.equal(view.gameplayMutationsBlocked,true);
 await assert.rejects(h.store.applyGameAction({gameId:h.game().id,state:h.game().board.state,action:{type:'pass'}}),{code:'sync_recovering'});
 assert.equal((await h.journal.list('owner',h.game().id)).length,1,'blocked input never adds hidden durable intent');assert.equal(h.actions.length,0);
});

test('a pending control-changing request keeps human gameplay fenced',async t=>{
 const h=await humanRenewalHarness(t,{controlAction:'pause'});const view=h.store.getGameViewModel(h.game().id);
 assert.equal(view.gameplayMutationsBlocked,true);assert.equal(view.canRecordMove,false);
 await assert.rejects(h.store.applyGameAction({gameId:h.game().id,state:h.game().board.state,action:{type:'pass'}}),{code:'sync_recovering'});
 assert.equal((await h.journal.list('owner',h.game().id)).length,1);
});

test('a legal End turn remains enabled and durably submits once during harmless renewal',async t=>{
 const fixture=JSON.parse(readFileSync(new URL('./support/quiet-renew-closable-rush.json',import.meta.url)));
 assert.equal(validateAction(fixture.state,{type:'end_turn'}).ok,true);
 const h=await humanRenewalHarness(t,{initialState:fixture.state});
 assert.equal(h.store.getGameViewModel(h.game().id).canEndTurn,true);
 const result=await h.store.endTurn({gameId:h.game().id});assert.equal(h.actions.length,0);
 const saved=await h.journal.list('owner',h.game().id);const closure=saved.find(command=>command.kind==='end_turn');
 assert.ok(closure);assert.equal(closure.expectedGameplayRevision,0);assert.equal(closure.expectedTurnIndex,fixture.state.turnIndex);
 h.release();await h.renew;await result.committed;assert.equal(h.actions.length,1);assert.equal(h.game().gameplayRevision,1);
});

for(const change of ['metadata','authority','permission'])test(`${change} arriving during durable admission uses only a compatible completed projection`,async t=>{
 const requests=[],rules={asynchronous:true,project(scope,input){let resolve;const promise=new Promise(r=>{resolve=r;});requests.push({scope,input,resolve});return promise;},cancel(){},cancelAll(){}};
 const h=await humanRenewalHarness(t,{startRenewal:false,rulesOverride:rules});h.store.setRulesActiveGame(h.game().id,true);
 const before=structuredClone(h.game().board.state);let entered,finish;
 const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{finish=resolve;});
 const originalAdmit=h.journal.admit.bind(h.journal);h.journal.admit=async envelope=>{entered();await gate;return originalAdmit(envelope);};
 const host=createShellBoardHost({transport:h.store,gameId:h.game().id,canInteract:()=>true,canSelect:()=>true,rulesExecutor:{asynchronous:false,cancelAll(){}}});
 const action=h.game().legalActions.find(action=>action.type==='move');assert.ok(action);
 const applying=host.applyAction(before,action);await waitForBoundary(()=>requests.length===1);
 requests[0].resolve(projectOptimisticGame(requests[0].input));await ready;
 h.update(game=>({...game,updatedAt:new Date().toISOString(),notifications:['new metadata'],...(change==='authority'?{gameplayRevision:1,player1:{identityId:'another-player'},player2:{identityId:'other-player'},myRole:'Viewer',canRecordMove:false,board:{state:{...game.board.state,sideToMove:'P2'}},currentSnapshot:{...game.board.state,sideToMove:'P2'}}:change==='permission'?{canRecordMove:false,canEndTurn:false,control:'viewer'}:{})}));
 finish();const result=await applying;assert.equal(result.accepted,true);assert.equal((await h.journal.list('owner',h.game().id)).length,1);
 if(change==='metadata') {
  assert.equal(requests.length,1,'harmless metadata cannot start another rules worker');
  assert.notDeepEqual(result.state,before,'accepted input returns its projected board immediately');
  assert.deepEqual(h.store.getGameViewModel(h.game().id).notifications,['new metadata']);
 }else{
  assert.equal(requests.length,2,'changed authority refuses the stale successful projection');
  const next=projectOptimisticGame(requests[1].input);if(change==='authority')assert.equal(next.ok,false);requests[1].resolve(next);
  await waitForBoundary(()=>!h.store.getGameViewModel(h.game().id).rulesChecking);
  if(change==='authority')assert.equal(h.store.getGameViewModel(h.game().id).currentSnapshot.sideToMove,'P2');
  else assert.equal(h.store.getGameViewModel(h.game().id).canRecordMove,false,'a rebuilt projection cannot restore withdrawn human permission');
 }
});

for(const [name,change,code] of [
 ['lease expiry',h=>h.update(game=>({...game,computer:{...game.computer,lease:{...game.computer.lease,expiresAt:Date.now()-1}}})),'sync_recovering'],
 ['controller generation',h=>h.update(game=>({...game,computer:{...game.computer,generation:game.computer.generation+1}})),'stale_state'],
 ['position',h=>h.update(game=>({...game,gameplayRevision:1,board:{state:{...game.board.state,sideToMove:'P2'}},currentSnapshot:{...game.board.state,sideToMove:'P2'}})),'stale_state'],
 ['independent recovery',h=>h.store.setConnectionRecovering(h.game().id,true),'sync_recovering'],
])test(`${name} during rules work blocks fresh admission instead of queuing hidden play`,async t=>{
 let entered,finish;const gate=new Promise(resolve=>{finish=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
 const h=await humanRenewalHarness(t,{gateProjection:()=>{entered();return gate;}});
 const work=h.store.applyGameAction({gameId:h.game().id,state:h.game().board.state,action:{type:'pass'}});
 const outcome=work.then(value=>({value}),error=>({error}));await ready;change(h);finish();
 const result=await outcome;assert.equal(result.error?.code,code);assert.equal(h.actions.length,0);
 assert.equal((await h.journal.list('owner',h.game().id)).length,1,'only the original renewal remains durable');
});

test('repeated accepted maintenance never toggles legal human availability at a published boundary',async t=>{
 const h=await humanRenewalHarness(t),before=structuredClone(h.game().board);const samples=[],ids=[];
 h.store.subscribe(event=>samples.push({type:event.type,canRecordMove:h.store.getGameViewModel(h.game().id).canRecordMove}));
 let completion=h.renew;
 for(let round=0;round<3;round++){
  ids.push(h.held().clientCommandId);assert.equal(h.store.getGameViewModel(h.game().id).canRecordMove,true);
  h.release();await completion;await waitForBoundary(async()=>!(await h.journal.list('owner',h.game().id)).length);
  assert.deepEqual(h.game().board,before);assert.equal(h.game().gameplayRevision,0);assert.equal(h.actions.length,0);
  if(round<2)({completion}=await h.renewNext());
 }
 assert.equal(new Set(ids).size,3);assert.ok(samples.length>3);
 for(const sample of samples)assert.equal(sample.canRecordMove,true,`unexpected availability change at ${sample.type}`);
});

test('permission-only loss after renewal settlement still cancels fresh worker admission',async t=>{
 let entered,finish;const gate=new Promise(resolve=>{finish=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
 const h=await humanRenewalHarness(t,{gateProjection:()=>{entered();return gate;}});
 const work=h.store.applyGameAction({gameId:h.game().id,state:h.game().board.state,action:{type:'pass'}});
 const outcome=work.then(value=>({value}),error=>({error}));await ready;h.release();await h.renew;
 h.update(game=>({...game,canRecordMove:false,canEndTurn:false,control:'viewer'}));finish();
 const result=await outcome;assert.equal(result.error?.code,'stale_state');assert.equal(h.actions.length,0);
 await waitForBoundary(async()=>!(await h.journal.list('owner',h.game().id)).length);
});

test('a real confirmation deadline remains a fence even while the lease is still valid',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const h=await humanRenewalHarness(t);t.mock.timers.tick(16000);
 h.update(game=>({...game,computer:{...game.computer,lease:{...game.computer.lease,expiresAt:Date.now()+60000}}}));
 const view=h.store.getGameViewModel(h.game().id);assert.equal(view.confirmationOverdue,true);assert.equal(view.canRecordMove,false);
 await assert.rejects(h.store.applyGameAction({gameId:h.game().id,state:h.game().board.state,action:{type:'pass'}}),{code:'sync_recovering'});
 assert.equal((await h.journal.list('owner',h.game().id)).length,1);assert.equal(h.actions.length,0);
});

test('failed human journal admission retains storage recovery instead of hiding it behind renewal',async t=>{
 const h=await humanRenewalHarness(t);const original=h.journal.admit.bind(h.journal);
 h.journal.admit=async()=>{throw Object.assign(Error('journal_timeout'),{code:'journal_timeout'});};
 await assert.rejects(h.store.applyGameAction({gameId:h.game().id,state:h.game().board.state,action:{type:'pass'}}),{code:'journal_timeout'});
 h.journal.admit=original;const view=h.store.getGameViewModel(h.game().id);
 assert.equal(view.storageBlocked,true);assert.equal(view.unsavedCommand,true);assert.equal(view.canRecordMove,false);
 assert.equal((await h.journal.list('owner',h.game().id)).length,1);assert.equal(h.actions.length,0);
});

test('empty auto-settled turn retains its semantic rejection without journaling',async t=>{
 const h=await humanRenewalHarness(t,{startRenewal:false});
 h.update(game=>({...game,canRecordMove:false,canEndTurn:false,currentTurn:{index:1,playerSeat:'Player 2',status:'active',moveIndexes:[]},turns:[...game.turns,{index:1,playerSeat:'Player 2',status:'active',moveIndexes:[]}],board:{state:{...game.board.state,sideToMove:'P2',turnIndex:1}},currentSnapshot:{...game.board.state,sideToMove:'P2',turnIndex:1}}));
 await assert.rejects(h.store.endTurn({gameId:h.game().id}),{code:'turn_has_no_moves'});
 assert.deepEqual(await h.journal.list('owner',h.game().id),[]);assert.deepEqual(h.actions,[]);
});

test('permission loss still blocks a nonempty legal End turn without journaling',async t=>{
 const fixture=JSON.parse(readFileSync(new URL('./support/quiet-renew-closable-rush.json',import.meta.url)));
 const h=await humanRenewalHarness(t,{initialState:fixture.state,startRenewal:false});
 h.update(game=>({...game,canRecordMove:false,canEndTurn:false,control:'viewer'}));
 await assert.rejects(h.store.endTurn({gameId:h.game().id}),{code:'sync_recovering'});
 assert.deepEqual(await h.journal.list('owner',h.game().id),[]);assert.deepEqual(h.actions,[]);
});


test('terminal empty turns retain their completion fence without journaling',async t=>{
 const h=await humanRenewalHarness(t,{startRenewal:false});
 h.update(game=>({...game,canRecordMove:false,canEndTurn:false,board:{state:{...game.board.state,outcome:{status:'p1_win',reason:'p2_commander_destroyed'}}}}));
 await assert.rejects(h.store.endTurn({gameId:h.game().id}),{code:'sync_recovering'});
 assert.deepEqual(await h.journal.list('owner',h.game().id),[]);assert.deepEqual(h.actions,[]);
});


test('authenticated sanitized lease preserves legal human admission through fresh renewal',async t=>{
 const h=await humanRenewalHarness(t,{authenticated:true});
 assert.equal(h.store.getAuthoritativeGame(h.game().id).computer.lease.authContextId,undefined);
 assert.equal(h.held().authContextId,h.auth.session.contextId);
 assert.equal(h.store.getGameViewModel(h.game().id).canRecordMove,true);
 const result=await h.store.applyGameAction({gameId:h.game().id,state:h.game().board.state,action:{type:'pass'}});
 assert.equal(result.accepted,true);const pending=(await h.journal.list('owner',h.game().id)).find(value=>value.kind==='action');
 assert.equal(pending.authContextId,h.auth.session.contextId);assert.deepEqual(pending.predecessor,{clientCommandId:h.held().clientCommandId,fingerprint:h.held().fingerprint});assert.equal(h.actions.length,0);
 h.release();await h.renew;await waitForBoundary(()=>h.actions.length===1);assert.equal(h.actions[0].clientCommandId,pending.clientCommandId);
});

for(const change of ['context','account','signed-out','explicit-lease-mismatch'])test(`sanitized lease cannot bypass changed authenticated ${change}`,async t=>{
 const h=await humanRenewalHarness(t,{authenticated:true});
 if(change==='context')h.auth.session.contextId='b'.repeat(64);
 else if(change==='account')h.auth.session.account={id:'another-account'};
 else if(change==='signed-out')h.auth.session.authenticated=false;
 else h.store.applyLiveGameUpdate({game:{...h.game(),computer:{...h.game().computer,lease:{...h.game().computer.lease,authContextId:'b'.repeat(64)}}},eventSeq:2});
 assert.equal(h.store.getGameViewModel(h.game().id).canRecordMove,false);
 await assert.rejects(h.store.applyGameAction({gameId:h.game().id,state:h.game().board.state,action:{type:'pass'}}),error=>['sync_recovering','invalid_credentials'].includes(error.code));
 assert.equal((await h.journal.list('owner',h.game().id)).length,1);assert.equal(h.actions.length,0);
});

test('a missing guest lease context is not treated as authenticated proof',async t=>{
 const h=await humanRenewalHarness(t);const game=structuredClone(h.game());delete game.computer.lease.authContextId;
 h.store.applyLiveGameUpdate({game,eventSeq:2});
 assert.equal(h.store.getGameViewModel(game.id).canRecordMove,false);
 await assert.rejects(h.store.applyGameAction({gameId:game.id,state:game.board.state,action:{type:'pass'}}),{code:'sync_recovering'});
 assert.equal((await h.journal.list('owner',game.id)).length,1);assert.equal(h.actions.length,0);
});
