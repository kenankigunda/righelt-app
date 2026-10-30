import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createCommandJournal} from '../shell/command-journal.js';
import {createLiveTransportStore} from '../shell/live-transport.js';
import {createComputerSession} from '../shell/computer-session.js';
import {opponentBoardMessage} from '../shell/opponent-narration.js';
import {recoveryMessage,isBoardRecoveryPending} from '../shell/recovery-view.js';
import {IDENTITY_KEY} from '../shell/persistence.js';
import {createInitialState,resolveToStability,listLegalActions} from '../generated/packages/game-engine/src/index.js';
import {createComputerControl,changeComputerControl,COMPUTER_TIMING} from '../generated/packages/shared-types/src/computer-play.js';

const microtasks = async predicate => {
 for(let i=0;i<100;i++){if(await predicate())return;await new Promise(resolve=>setImmediate(resolve));}
 assert.fail('renewal fixture did not reach its expected boundary');
};

test('quiet renewal keeps the durable envelope and human-turn fences through accepted settlement',async t=>{
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
 now+=COMPUTER_TIMING.renewAfterMs;await session.tick();await microtasks(()=>held);
 const original=structuredClone(held),view=transport.getGameViewModel(game.id);
 assert.equal(view.pendingCommandCount,1);assert.equal(view.sharedMutationsBlocked,true);assert.equal(view.canRecordMove,false);
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
 release();await microtasks(async()=>transport.getGameViewModel(game.id).pendingCommandCount===0&&(await journal.list('owner',game.id)).length===0);
 const final=transport.getGameViewModel(game.id);
 assert.equal(final.sharedMutationsBlocked,false);assert.equal(final.canRecordMove,true);assert.equal(final.pendingComputerControlRequest,null);
 assert.equal(final.moves.length,1);assert.deepEqual(final.moves,game.moves);assert.equal(computations,0);
 const finalMessage=boardMessage(final);assert.equal(finalMessage.text,narration.text);assert.equal(hasPass(finalMessage),true);
});
