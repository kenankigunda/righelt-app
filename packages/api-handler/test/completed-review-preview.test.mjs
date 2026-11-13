import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApiRequest} from './support/v2-test-adapter.mjs';
import {createFakeD1} from './support/fake-d1.mjs';
import {createFakeGameRooms} from './support/fake-game-rooms.mjs';
import {persistGameState} from '../src/shell-live-db.ts';

const request=(path,body)=>new Request(`https://example.test${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('completed preview batch is revision-fenced, bounded, sanitized, and read-only',async()=>{
 const DB=createFakeD1(),env={DB,GAME_ROOMS:null};env.GAME_ROOMS=createFakeGameRooms(()=>env);
 const created=await handleApiRequest(request('/api/shell/games',{identityId:'owner'}),env);
 const {game}=await created.json(),before=structuredClone(game.board.state),final={...structuredClone(before),turnIndex:3,outcome:{status:'p1_win'}};
 const value=DB.getGameState(game.id);await persistGameState(env,{...value,gameplayRevision:7,board:{state:final},turns:[{index:2,playerSeat:'Player 1',status:'complete',moveIndexes:[0]}],moves:[{
   moveId:'decisive',clientCommandId:'private-command',index:0,displayMoveNumber:1,turnIndex:2,turnMoveIndex:0,actorSide:'P1',at:value.updatedAt,
   notation:'MOVE',action:{type:'move',actorId:'C1',from:{row:3,col:6},to:{row:4,col:6}},selectionSnapshot:before,snapshot:final,destroyedPieces:[],
 }]},2);
 env.GAME_ROOMS.reset();
 const writesBefore=DB.getWrites().length;
 const response=await handleApiRequest(request('/api/shell/games/review-previews',{identityId:'owner',items:[{gameId:game.id,gameplayRevision:7}]}),env);
 assert.equal(response.status,200);
 const body=await response.json(),preview=body.items[0];
 assert.equal(preview.ok,true,JSON.stringify(body));assert.equal(preview.gameId,game.id);assert.equal(preview.gameplayRevision,7);assert.equal(preview.turnIndex,2);
 assert.equal(preview.preview.overlay.mode,'recorded-turn');assert.equal(preview.preview.overlay.presentationContext,'history');
 assert.deepEqual(preview.preview.overlay.endpointRoles,[{row:3,col:6,source:true,target:false},{row:4,col:6,source:false,target:true}]);
 const serialized=JSON.stringify(body);
 for(const forbidden of ['private-command','clientCommandId','inviteToken','identityId','receipts'])assert.equal(serialized.includes(forbidden),false,forbidden);
 assert.equal(DB.getWrites().length,writesBefore,'preview reads cannot persist or backfill game data');
 const stale=await handleApiRequest(request('/api/shell/games/review-previews',{identityId:'owner',items:[{gameId:game.id,gameplayRevision:6}]}),env);
 assert.equal((await stale.json()).items[0].error,'history_changed');
 for(const size of [0,7]){
   const items=Array.from({length:size},(_,index)=>({gameId:`g-${index}`,gameplayRevision:1}));
   assert.equal((await handleApiRequest(request('/api/shell/games/review-previews',{identityId:'owner',items}),env)).status,400);
 }
});

test('completed preview batch preserves independent per-game authorization results',async()=>{
 const calls=[];
 const env={DB:createFakeD1(),GAME_ROOMS:{idFromName:name=>({name}),get:id=>({fetch:async req=>{
   calls.push({gameId:id.name,authorization:req.headers.get('authorization')});
   if(id.name.endsWith('unavailable'))throw new Error('room unavailable');
   return id.name.endsWith('allowed')?Response.json({ok:true,gameId:id.name,gameplayRevision:2,turnIndex:0,outcomeStatus:'draw',preview:{snapshot:{outcome:{status:'draw'}},overlay:{mode:'recorded-turn',presentationContext:'history'}}}):Response.json({ok:false,error:'forbidden'},{status:403});
 }})}};
 const response=await handleApiRequest(new Request('https://example.test/api/shell/games/review-previews',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer opaque'},body:JSON.stringify({identityId:'owner',items:[{gameId:'first-allowed',gameplayRevision:2},{gameId:'second-denied',gameplayRevision:2},{gameId:'third-unavailable',gameplayRevision:2}]})}),env);
 const body=await response.json();
 assert.equal(response.status,200);assert.deepEqual(body.items.map(item=>[item.gameId,item.ok,item.status??200]),[['first-allowed',true,200],['second-denied',false,403],['third-unavailable',false,503]]);
 assert.deepEqual(calls,[{gameId:'first-allowed',authorization:'Bearer opaque'},{gameId:'second-denied',authorization:'Bearer opaque'},{gameId:'third-unavailable',authorization:'Bearer opaque'}]);
});
