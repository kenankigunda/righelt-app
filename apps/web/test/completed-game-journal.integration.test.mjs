import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createCommandJournal} from '../shell/command-journal.js';
import {createLiveTransportStore} from '../shell/live-transport.js';
import {createComputerSession} from '../shell/computer-session.js';
import {IDENTITY_KEY} from '../shell/persistence.js';
import {createInitialState,resolveToStability,listLegalActions} from '../generated/packages/game-engine/src/index.js';
import {createComputerControl,changeComputerControl} from '../generated/packages/shared-types/src/computer-play.js';

test('terminal authority stops the runner while an admitted durable command still settles its receipt',async t=>{
 const now=Date.now(),initial=resolveToStability(createInitialState(),{artifactMode:'full'});
 let eventSeq=1,revision=0,command,release,admitted;
 const pending=new Promise(resolve=>release=resolve),sent=new Promise(resolve=>admitted=resolve);
 const controls=[],evidence=[],applies=[];
 let game={id:'completed-journal',createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),gameplayRevision:revision,
  board:{state:initial},currentSnapshot:initial,currentTurn:{index:0,playerSeat:'Player 1',status:'active',moveIndexes:[]},turns:[],moves:[],
  myRole:'Player 1',player1:{identityId:'owner'},player2:{identityId:'owner'},canControlComputer:true,canRecordMove:true,
  legalActions:listLegalActions(initial),viewers:[],pendingJoinRequests:[],sharedReceipts:true,computer:createComputerControl('owner',{p1:'babs',p2:null})};
 game.turns=[game.currentTurn];
 const journal=createCommandJournal({indexedDB:new IDBFactory()}),storage={getItem:key=>key===IDENTITY_KEY?'owner':null,setItem(){},removeItem(){}};
 const reply=outcomes=>Response.json({ok:true,protocolVersion:2,gameId:game.id,eventSeq,gameplayRevision:revision,game,commandOutcomes:outcomes});
 const outcome=(value,result)=>({gameId:game.id,identityId:value.identityId,clientCommandId:value.clientCommandId,fingerprint:value.fingerprint,outcome:result,reason:result==='rejected'?'stale_state':null,eventSeq,gameplayRevision:revision});
 const transport=createLiveTransportStore({storage,commandJournal:journal,fetcher:async(url,init={})=>{
  const body=init.body?JSON.parse(init.body):{};
  if(url.endsWith('/shared')){
   const values=body.payload.values;controls.push(values.action);
   game={...game,computer:changeComputerControl(game.computer,{...values,ownerId:'owner',authContextId:'',turnIndex:0,now})};eventSeq++;
   return reply([outcome(body,'accepted')]);
  }
  if(url.endsWith('/decision-attempt')){evidence.push(body);return Response.json({ok:true});}
  if(url.endsWith('/apply')){command=body;applies.push(body);admitted();await pending;return reply([outcome(body,'rejected')]);}
  if(url.endsWith('/reconcile'))return reply((body.commands??[]).map(value=>outcome(value,'rejected')));
  return reply([]);
 }});
 let calculations=0;const runtime={compute:async()=>{calculations++;return{result:{status:'ready',action:{type:'pass'}}};},cancel(){}};
 const session=createComputerSession({runtime,analysisRuntime:runtime,deviceId:'device',clock:()=>now,timers:{setInterval(){return 1;},clearInterval(){}},getContext:()=>({game:transport.getAuthoritativeGame(game.id),transport,accountGeneration:1,authenticated:true,visible:true})});
 t.after(()=>{release();session.destroy();transport.retire();});
 await transport.loadGame(game.id);await session.tick();const work=session.tick();await sent;
 assert.equal(calculations,1);assert.deepEqual(await journal.list('owner',game.id),[command]);
 revision++;eventSeq++;const terminal=structuredClone(initial);terminal.outcome={status:'p1_win',reason:'p2_commander_unsupplied'};
 game={...game,gameplayRevision:revision,board:{state:terminal},currentSnapshot:terminal,legalActions:[],canRecordMove:false,currentTurn:{...game.currentTurn,status:'complete'}};
 transport.applyLiveGameUpdate({game,eventSeq});await session.tick();
 assert.deepEqual(await journal.list('owner',game.id),[command],'completion cannot erase an uncertain admitted command');
 assert.equal(session.snapshot().activity.label,'Game finished');assert.deepEqual(controls,['acquire']);assert.equal(evidence.length,1);
 release();await work;await transport.reconcileGame(game.id);
 assert.deepEqual(await journal.list('owner',game.id),[]);assert.equal(applies.length,1);assert.deepEqual(applies[0],command);assert.equal(calculations,1);
 assert.equal(transport.getGameViewModel(game.id).pendingCommandCount,0);assert.equal(evidence.length,1,'no cancelled-run evidence rewrite after completion');
});
