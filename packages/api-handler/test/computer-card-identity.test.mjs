import test from 'node:test';
import assert from 'node:assert/strict';
import {COMPUTER_PROFILES,createComputerControl} from '../../shared-types/src/computer-play.ts';
import {createInitialGame,toStaticGameCard,withViewModel} from '../src/shell-live-core.ts';
import {handleApiRequest} from './support/v2-test-adapter.mjs';
import {createFakeD1} from './support/fake-d1.mjs';
import {createFakeGameRooms} from './support/fake-game-rooms.mjs';

const cardKeys=['id','createdAt','lastMoveAt','updatedAt','moveCount','previewSnapshot','previewSelection','myRole','canJoinAsPlayer','player1','player2'].sort();
test('static cards preserve configured computer identity independently of manual control',()=>{
 for(const profile of Object.keys(COMPUTER_PROFILES))for(const sides of ['p1','p2','both'])for(const manual of [false,true]){
  const game=createInitialGame({gameId:`${profile}-${sides}-${manual}`,identityId:'owner',selfPlayMode:true});
  const seats={p1:sides==='p1'||sides==='both'?profile:null,p2:sides==='p2'||sides==='both'?profile:null};
  game.computer={...createComputerControl('owner',seats),manual};
  const original=structuredClone(game),fullBefore=withViewModel(game,'owner');
  for(const identity of ['owner','visitor']){
   const card=toStaticGameCard(game,identity);
   assert.equal(card.player1.computerProfile,seats.p1,`${profile}/${sides}/manual=${manual}/p1`);
   assert.equal(card.player2.computerProfile,seats.p2,`${profile}/${sides}/manual=${manual}/p2`);
   assert.equal(card.canJoinAsPlayer,false);
   assert.deepEqual(Object.keys(card).sort(),cardKeys,'cards gain no control, lease or permission fields');
  }
  assert.deepEqual(game,original,'static identity decoration never mutates durable participants or control');
  assert.deepEqual(withViewModel(game,'owner'),fullBefore);
  if(manual){assert.equal(fullBefore.computerTurn,null);assert.equal(fullBefore.player1.computerProfile,null);assert.equal(fullBefore.player2.computerProfile,null);assert.equal(fullBefore.canRecordMove,true);}
  const visitor=withViewModel(game,'visitor');assert.equal(visitor.canControlComputer,false);assert.equal(visitor.canRecordMove,false);assert.equal(visitor.canEndTurn,false);
 }
});

test('ordinary human self-play remains untagged and keeps its existing card contract',()=>{
 const game=createInitialGame({gameId:'human-self-play',identityId:'owner',selfPlayMode:true});
 const card=toStaticGameCard(game,'owner');
 assert.equal(card.player1.identityId,'owner');assert.equal(card.player2.identityId,'owner');
 assert.equal(Object.hasOwn(card.player1,'computerProfile'),false);assert.equal(Object.hasOwn(card.player2,'computerProfile'),false);
 assert.equal(card.canJoinAsPlayer,false);assert.deepEqual(Object.keys(card).sort(),cardKeys);
});

const request=(path,body)=>new Request(`https://example.test/api/shell/${path}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);
test('Home list retains the configured opponent after an authorized manual-control transition',async()=>{
 for(const profile of Object.keys(COMPUTER_PROFILES))for(const side of ['p1','p2']){
  const env={DB:createFakeD1(),GAME_ROOMS:null};env.GAME_ROOMS=createFakeGameRooms(()=>env);
  const seats={p1:side==='p1'?profile:null,p2:side==='p2'?profile:null};
  const created=await handleApiRequest(request('games',{identityId:'owner',computer:seats}),env);assert.equal(created.status,200);
  const game=(await created.json()).game,id=game.id;
  const control=async(identityId,action,generation)=>handleApiRequest(request(`games/${id}/computer-control`,{identityId,action,generation,deviceId:'same-device'}),env);
  const denied=await control('visitor','acquire',game.computer.generation);assert.equal(denied.status,409);assert.equal((await denied.json()).error,'computer_owner_required');
  const acquired=await control('owner','acquire',game.computer.generation);assert.equal(acquired.status,200);const active=(await acquired.json()).game;
  const manual=await control('owner','manual',active.computer.generation);assert.equal(manual.status,200);const effective=(await manual.json()).game;
  assert.equal(effective.computer.manual,true);assert.equal(effective.computerTurn,null);assert.equal(effective.canRecordMove,true);assert.equal(effective.player1.computerProfile,null);assert.equal(effective.player2.computerProfile,null);
  const beforeList=env.DB.getGameState(id);
  const listed=await handleApiRequest(request('games?identityId=owner&section=my&page=0&pageSize=6&debug=0'),env);assert.equal(listed.status,200);
  const cards=(await listed.json()).games;assert.equal(cards.length,1);const card=cards[0];
  assert.equal(card.id,id);assert.equal(card.player1.computerProfile,seats.p1);assert.equal(card.player2.computerProfile,seats.p2);assert.deepEqual(Object.keys(card).sort(),cardKeys);
  assert.deepEqual(env.DB.getGameState(id),beforeList,'reading the home card does not change manual control or history');
 }
});
