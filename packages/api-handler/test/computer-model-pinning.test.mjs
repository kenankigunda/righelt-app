import test from 'node:test';
import assert from 'node:assert/strict';
import {handleLiveGameRequest} from '../src/shell-live.ts';
import {createInitialGame,applyServerAction} from '../src/shell-live-core.ts';
import {persistGameState} from '../src/shell-live-db.ts';
import {listLegalActions} from '../../game-engine/src/index.ts';
import {CURRENT_COMPUTER_MODEL,computerModelForCreation} from '../../shared-types/src/computer-play.ts';
import {createFakeD1} from './support/fake-d1.mjs';
import {createFakeGameRooms} from './support/fake-game-rooms.mjs';
const seats={p1:'babs',p2:null};
function fixture(){
 const env={DB:createFakeD1()};env.GAME_ROOMS=createFakeGameRooms(()=>env);
 const call=async(route,body)=>{
  const response=await handleLiveGameRequest(new Request(`https://test/api/shell/${route}${body===undefined?'?identityId=owner':''}`,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identityId:'owner',protocolVersion:2,...body})}),env);
  return response.response?{status:response.response.status,body:await response.response.json()}:{status:response.status,body:response.body};
 };
 return {env,call};
}
for(const [name,requested,expected]of [['legacy omission',undefined,'initial-1554'],['explicit published',CURRENT_COMPUTER_MODEL.id,CURRENT_COMPUTER_MODEL.id]]){
 test(`creation preserves ${name} prepared model across durable reload and conflicting recreation`,async()=>{
  const {env,call}=fixture();const created=await call('games',{gameId:'pinned',computer:seats,...(requested===undefined?{}:{computerModelId:requested})});
  assert.equal(created.status,200,JSON.stringify(created.body));assert.equal(created.body.game.computer.modelId,expected);
  env.GAME_ROOMS.restart('pinned');const loaded=await call('games/pinned');assert.equal(loaded.body.game.computer.modelId,expected);
  assert.equal((await call('games',{gameId:'pinned',computer:{p1:null,p2:'horus'},computerModelId:CURRENT_COMPUTER_MODEL.id})).status,409);
  const unchanged=(await call('games/pinned')).body.game.computer;assert.equal(unchanged.modelId,expected);assert.deepEqual(unchanged.seats,seats);
 });
 test(`history branch preserves ${name} prepared model without changing source`,async()=>{
  const {env,call}=fixture();const source=createInitialGame({gameId:'source',identityId:'owner',selfPlayMode:true});
  await persistGameState(env,source,1);
  const action=listLegalActions(source.board.state).find(a=>a.from&&a.to);assert.equal(applyServerAction(source,action).ok,true);await persistGameState(env,source,2);
  const before=JSON.stringify(source.board.state);const result=await call('history/branch',{gameId:'branch',sourceGameId:'source',sourceDecisionId:source.moves[0].moveId,computer:seats,...(requested===undefined?{}:{computerModelId:requested})});
  assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.game.computer.modelId,expected);assert.deepEqual(result.body.game.board.state,source.moves[0].selectionSnapshot);
  env.GAME_ROOMS.restart('branch');assert.equal((await call('games/branch')).body.game.computer.modelId,expected);
  assert.equal(JSON.stringify((await call('games/source')).body.game.board.state),before);
 });
}
for(const value of ['',null,{},[],1554,'unknown-model','production-20261025-99','__proto__'])test(`explicit malformed or unpublished model fails closed: ${JSON.stringify(value)}`,async()=>{
 assert.equal(computerModelForCreation(value),null);const {call}=fixture();
 for(const route of ['games','history/branch']){
  const r=await call(route,{gameId:'rejected',sourceGameId:'missing',sourceDecisionId:'missing',computer:seats,computerModelId:value});assert.equal(r.status,400);assert.equal(r.body.error,'invalid_computer_model');
 }
});
