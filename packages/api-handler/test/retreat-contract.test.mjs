import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {getTurnOwnerSideForState} from '../../shared-types/src/shell-live-turn.js';
import {GameRoomDO} from '../src/game-room-do.ts';
import {createFakeD1} from './support/fake-d1.mjs';
import {ACTION_CONTRACT_VERSION,commandFingerprint} from '../../shared-types/src/sync-protocol.ts';
import {CURRENT_RETREAT_SEMANTICS,deterministicStateHash,equivalentGameStates,resolveToStability} from '../../game-engine/src/index.ts';
const fixture=JSON.parse(readFileSync(new URL('../../game-engine/test/fixtures/completion-preserving-retreat.json',import.meta.url),'utf8'));
const harness=async()=>{
 const DB=createFakeD1(),env={DB};let room;
 const restart=()=>{room=new GameRoomDO({id:{name:'g'}},env);room.broadcast=async()=>{};};restart();
 const call=async(path,body={})=>{const response=await room.fetch(new Request(`https://test/${path}`,{method:'POST',headers:{'x-game-id':'g'},body:JSON.stringify({protocolVersion:2,identityId:'owner',...body})}));return {status:response.status,...await response.json()};};
 await call('create',{gameId:'g',selfPlayMode:true});
 DB.overwriteGameState('g',game=>{
  const state=structuredClone(fixture.states.afterPush),owner=getTurnOwnerSideForState(state);
  return {...game,board:{state},turns:[{...game.turns[0],index:state.turnIndex,playerSeat:owner==='P1'?'Player 1':'Player 2'}]};
 });restart();
 const command=async(action,version=ACTION_CONTRACT_VERSION)=>{const game=DB.getGameState('g'),value={protocolVersion:2,actionContractVersion:version,gameId:'g',identityId:'owner',clientCommandId:`v2:${crypto.randomUUID()}`,kind:'action',payload:{action},expectedState:game.board.state,expectedGameplayRevision:game.gameplayRevision};return {...value,fingerprint:await commandFingerprint(value)};};
 return {DB,call,command,restart};
};

test('live contract admits only the completion-preserving retreat and records its semantics',async()=>{
 assert.equal(ACTION_CONTRACT_VERSION,3);
 const h=await harness(),bad=await h.command(fixture.retreat.action);
 assert.equal((await h.call('apply',bad)).accepted,false);
 assert.equal(deterministicStateHash(h.DB.getGameState('g').board.state),fixture.push.afterHash);
 const safe=fixture.alternatives.find(row=>row.completable),good=await h.command(safe.action);
 assert.equal((await h.call('apply',good)).accepted,true);
 assert.equal(h.DB.getGameState('g').moves.at(-1).retreatSemantics,CURRENT_RETREAT_SEMANTICS);
 const actual=h.DB.getGameState('g').board.state, equivalent=equivalentGameStates(actual,safe.state);
 let differences=[];
 if(!equivalent){
  const actualStable=resolveToStability(structuredClone(actual),{artifactMode:'full'}),expectedStable=resolveToStability(structuredClone(safe.state),{artifactMode:'full'});
  const compare=(a,b,path='')=>{
   if(JSON.stringify(a)===JSON.stringify(b))return;
   if(a&&b&&typeof a==='object'&&typeof b==='object')for(const key of new Set([...Object.keys(a),...Object.keys(b)]))compare(a[key],b[key],`${path}/${key}`);
   else differences.push({path,actual:a,expected:b});
  };compare(actualStable,expectedStable);
  const directory=new URL('../../../test-results/retreat-source-preparation/',import.meta.url);mkdirSync(directory,{recursive:true});
  writeFileSync(new URL('safe-retreat-api-state-difference.json',directory),JSON.stringify({activeTurn:h.DB.getGameState('g').turns.at(-1),differences,actualStable,expectedStable},null,2)+'\n',{mode:0o600});
 }
 assert.equal(equivalent,true,JSON.stringify(differences));
});

for(const version of [2,undefined])test(`unsettled old retreat ${String(version)} is durably fenced with its original identity`,async()=>{
 const h=await harness(),old=await h.command(fixture.retreat.action,version);
 // Passing undefined explicitly requires deleting the optional field: the helper's default is live.
 if(version===undefined){delete old.actionContractVersion;old.fingerprint=await commandFingerprint(old);}
 const original=structuredClone(old),before=structuredClone(h.DB.getGameState('g'));
 const result=await h.call('apply',old);
 assert.equal(result.commandOutcomes[0].reason,'upgrade_required');
 assert.equal(result.commandOutcomes[0].clientCommandId,old.clientCommandId);
 assert.equal(result.commandOutcomes[0].fingerprint,old.fingerprint);
 assert.equal(h.DB.getReceipt('g',old.clientCommandId).outcome,'rejected');
 h.restart();assert.equal((await h.call('apply',old)).commandOutcomes[0].reason,'upgrade_required');
 assert.deepEqual(h.DB.getGameState('g').board,before.board);assert.deepEqual(old,original);
});

for(const outcome of ['accepted','rejected'])test(`original old ${outcome} receipt wins before the new retreat fence`,async()=>{
 const h=await harness(),old=await h.command(fixture.retreat.action,2),before=structuredClone(h.DB.getGameState('g'));
 await h.DB.prepare('INSERT INTO live_command_receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind('g',old.clientCommandId,'owner',old.fingerprint,outcome,outcome==='rejected'?'retained_rejection':null,1,0,null).run();
 const receipt=h.DB.getReceipt('g',old.clientCommandId);h.restart();
 const result=await h.call('apply',old);
 assert.equal(result.commandOutcomes[0].outcome,outcome);
 assert.equal(result.commandOutcomes[0].fingerprint,old.fingerprint);
 assert.equal(result.commandOutcomes[0].reason,receipt.reason);
 assert.deepEqual(h.DB.getReceipt('g',old.clientCommandId),receipt);
 assert.deepEqual(h.DB.getGameState('g'),before);
});


test('live HTTP cannot inject archive semantics into a current-contract retreat',async()=>{
 const h=await harness(),sent=await h.command(fixture.retreat.action);
 sent.payload.retreatSemantics='geometric-retreat-v1';sent.fingerprint=await commandFingerprint(sent);
 const before=structuredClone(h.DB.getGameState('g').board.state),result=await h.call('apply',sent);
 assert.equal(result.accepted,false);
 assert.equal(equivalentGameStates(h.DB.getGameState('g').board.state,before),true);
});
