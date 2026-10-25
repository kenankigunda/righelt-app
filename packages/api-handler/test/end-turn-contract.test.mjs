import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoomDO } from '../src/game-room-do.ts';
import { handleApiRequest } from '../src/index.ts';
import { createFakeD1 } from './support/fake-d1.mjs';
import { ACTION_CONTRACT_HEADER, ACTION_CONTRACT_VERSION, commandFingerprint } from '../../shared-types/src/sync-protocol.ts';
import { createComputerControl, COMPUTER_PROFILES } from '../../shared-types/src/computer-play.ts';
import { deterministicStateHash, resolveToStability } from '../../game-engine/src/index.ts';
import { commander, makeState, unit } from '../../game-engine/test/helpers/state-builders.mjs';
import { withViewModel } from '../src/shell-live-core.ts';
import { projectOptimisticGame } from '../../../apps/web/shell/optimistic-live.js';
const harness=async()=>{
  const DB=createFakeD1(), env={DB}, state={id:{name:'g'}}, events=[]; let room;
  const makeRoom=()=>{ room=new GameRoomDO(state,env); room.broadcast=async event=>{events.push(event)}; }; makeRoom();
  const call=async(route,body={})=>{const response=await room.fetch(new Request(`https://test/${route}`,{method:'POST',headers:{'x-game-id':'g'},body:JSON.stringify({protocolVersion:2,identityId:'owner',...body})}));return {status:response.status,...await response.json()}};
  await call('create',{gameId:'g',selfPlayMode:true});
  DB.overwriteGameState('g',game=>({...game,board:{state:resolveToStability(makeState({pieces:[commander('C1','P1',3,6),commander('C2','P2',6,3),unit('L','P1',3,3),unit('A','P1',4,4),unit('B','P1',5,3),unit('E','P2',4,2)]}))}}));
  const restart=makeRoom; restart();
  const command=async(action,patch={})=>{const game=DB.getGameState('g');const next={protocolVersion:2,actionContractVersion:ACTION_CONTRACT_VERSION,gameId:'g',identityId:'owner',clientCommandId:`v2:${crypto.randomUUID()}`,kind:'action',payload:{action},expectedState:game.board.state,expectedGameplayRevision:game.gameplayRevision,...patch};return {...next,fingerprint:await commandFingerprint(next)}};
  const rush=await command({type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}});
  assert.equal((await call('apply',rush)).commandOutcomes[0].outcome,'accepted');
  return {DB,env,state,call,command,restart,events};
};

test('explicit End Turn has optimistic/server parity and no history or numbering row',async()=>{
  const h=await harness(), game=h.DB.getGameState('g'), before=structuredClone(game), command=await h.command({type:'end_turn'});
  const projected=projectOptimisticGame({authoritativeGame:withViewModel(game,'owner'),identityId:'owner',queue:[{kind:'apply',action:{type:'end_turn'},clientCommandId:command.clientCommandId,queuedAt:game.updatedAt}]});
  assert.equal(projected.ok,true); assert.equal(projected.game.pendingMoves.length,0);
  const accepted=await h.call('apply',command);
  assert.equal(accepted.commandOutcomes[0].outcome,'accepted'); assert.equal(accepted.move,undefined);
  const next=h.DB.getGameState('g'); assert.equal(next.moves.length,before.moves.length);
  assert.equal(next.moves[0].displayMoveNumber,before.moves[0].displayMoveNumber);
  assert.equal(next.turns.at(-1).index,1); assert.equal(next.board.state.continuation,null);
  assert.equal(deterministicStateHash(projected.game.board.state),deterministicStateHash(next.board.state));
  assert.equal(h.events.at(-1)?.reason,'turn_ended');
});

test('old continuation Pass is fenced rather than translated; current Pass is illegal',async()=>{
  const h=await harness(), before=h.DB.getGameState('g');
  const old=await h.command({type:'pass'},{actionContractVersion:undefined});
  assert.equal((await h.call('apply',old)).commandOutcomes[0].reason,'upgrade_required');
  assert.equal(h.DB.getReceipt('g',old.clientCommandId).outcome,'rejected');
  const current=await h.command({type:'pass'});
  assert.equal((await h.call('apply',current)).commandOutcomes[0].reason,'CONTINUATION_REQUIRED');
  assert.equal(deterministicStateHash(h.DB.getGameState('g').board.state),deterministicStateHash(before.board.state));
});

test('mismatched action contracts never execute; accepted receipts still reconcile first',async()=>{
  const h=await harness(), mismatch=await h.command({type:'end_turn'},{actionContractVersion:99});
  assert.equal((await h.call('apply',mismatch)).commandOutcomes[0].reason,'upgrade_required');
  assert.equal(h.DB.getReceipt('g',mismatch.clientCommandId).outcome,'rejected');
  const sent=await h.command({type:'end_turn'});
  const accepted=await h.call('apply',sent); assert.equal(accepted.accepted,true);
  h.restart(); const before=h.DB.getGameState('g'), retried=await h.call('apply',sent);
  assert.equal(retried.duplicate,true); assert.deepEqual(h.DB.getGameState('g'),before);
});

test('lost End Turn response settles exactly once after restart',async()=>{
  const h=await harness(), sent=await h.command({type:'end_turn'});h.DB.loseNextBatchResponse();
  await assert.rejects(h.call('apply',sent),/Lost batch/); h.restart();
  assert.equal((await h.call('apply',sent)).duplicate,true);
  assert.equal(h.DB.getGameState('g').moves.length,1); assert.equal(h.DB.getGameState('g').board.state.turnIndex,1);
});

test('computer End Turn retains its own durable proof without overwriting move proof',async()=>{
  const h=await harness();const priorProof={attemptId:'rush-proof'};
  h.DB.overwriteGameState('g',game=>{game.computer=createComputerControl('owner',{p1:'babs',p2:null});game.computer.lease={deviceId:'device',authContextId:'',expiresAt:Date.now()+60000};game.moves[0].computerProof=priorProof;return game});h.restart();
  const game=h.DB.getGameState('g'), proof={deviceId:'device',generation:0,modelId:game.computer.modelId,profile:'babs',profileVersion:COMPUTER_PROFILES.babs.version,seed:107,attemptId:'end-turn-proof'};
  const action={type:'end_turn'}, attempt={proof,gameplayRevision:game.gameplayRevision,fingerprint:deterministicStateHash(game.board.state),outcome:'ready',result:{action}};
  assert.equal((await h.call('decision-attempt',{operation:'write',kind:'computer',attemptId:proof.attemptId,attempt})).status,200);
  const sent=await h.command(action,{payload:{action,computer:proof}}), accepted=await h.call('apply',sent);
  assert.equal(accepted.accepted,true,JSON.stringify(accepted.commandOutcomes));
  assert.deepEqual(h.DB.getGameState('g').moves[0].computerProof,priorProof);
  assert.deepEqual(JSON.parse(h.DB.getReceipt('g',sent.clientCommandId).result_json).computerProof,proof);
});

test('API advertises the independent semantic action contract',async()=>{
 const response=await handleApiRequest(new Request('https://test/api/health'),{DB:createFakeD1()});
 assert.equal(response.headers.get(ACTION_CONTRACT_HEADER),String(ACTION_CONTRACT_VERSION));
});


test('legacy Pass fencing uses immutable intent, not an earlier current continuation',async()=>{
  const h=await harness(), game=h.DB.getGameState('g');
  const next=structuredClone(game.board.state);next.continuation=null;next.sideToMove='P2';next.turnIndex++;
  const command=await h.command({type:'pass'},{actionContractVersion:undefined,expectedState:next,expectedGameplayRevision:game.gameplayRevision+1,predecessor:{clientCommandId:'v2:pending-parent',fingerprint:'a'.repeat(64)}});
  const result=await h.call('apply',command);
  assert.equal(result.commandOutcomes[0].outcome,'unknown');
  assert.equal(result.commandOutcomes[0].reason,'dependency_pending');
  assert.equal(h.DB.getReceipt('g',command.clientCommandId),null);
});
