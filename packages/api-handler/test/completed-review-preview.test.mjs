import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleApiRequest} from './support/v2-test-adapter.mjs';
import {createFakeD1} from './support/fake-d1.mjs';
import {createFakeGameRooms} from './support/fake-game-rooms.mjs';
import {persistGameState} from '../src/shell-live-db.ts';
import {archiveStatements,readDecision} from '../src/decision-archive.ts';
import {applyAcceptedAutomaticEnding,applyAuthorizedPendingAutomaticEnding,applyScenarioToGame,createInitialGame} from '../src/shell-live-core.ts';
import {resolveToStability} from '../../game-engine/src/resolve.ts';
import {commander,makeState,unit} from '../../game-engine/test/helpers/state-builders.mjs';

const request=(path,body)=>new Request(`https://example.test${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

const terminalGame=({complete=true}={})=>{
 const game=createInitialGame({gameId:`completed-count-${complete?'complete':'incomplete'}`,identityId:'owner',selfPlayMode:true});
 game.board.state.pieces=game.board.state.pieces.filter(piece=>piece.id!=='C2');
 game.board.state.outcome={status:'p1_win',reason:'p2_commander_destroyed'};
 const move=(moveId,index,{undone=false,imported=false}={})=>({moveId,index,displayMoveNumber:index+1,turnIndex:0,turnMoveIndex:index,
  actorSide:'P1',at:game.createdAt,notation:'Pass',action:{type:'pass'},selectionSnapshot:structuredClone(game.board.state),
  snapshot:structuredClone(game.board.state),destroyedPieces:[],clientCommandId:`v2:${moveId}`,
  ...(undone?{undone:true}:{}),...(imported?{importedFrom:{gameId:'source',decisionId:'origin',gameplayRevision:7}}:{})});
 const imported=move('imported',0,{imported:true}),undone=move('undone',1,{undone:true}),decisive=move('decisive',2);
 game.moves=[imported,undone,decisive];game.turns[0].moveIndexes=[0,1,2];
 game.importedHistory={version:1,complete,moveCount:1,sources:[{gameId:'source',gameplayRevision:7,moveCount:1}]};
 game.gameplayRevision=1;
 applyAcceptedAutomaticEnding(game,{type:'pass'},{move:decisive,destroyedPieces:[]},
  {clientCommandId:decisive.clientCommandId,eventSeq:1,gameplayRevision:1,actorSide:'P1',turnOwnerSide:'P1',turnIndex:0});
 return game;
};

const zeroActionTerminalGame=()=>{
 const game=createInitialGame({gameId:'completed-count-zero',identityId:'owner',selfPlayMode:true});
 const pieces=[];
 for(let row=0;row<10;row++)for(let col=0;col<10;col++){
  const owner=col>=5?'P1':'P2';
  pieces.push(row===0&&col===9?commander('C1','P1',row,col):row===9&&col===0?commander('C2','P2',row,col):unit(`${owner}-${row}-${col}`,owner,row,col));
 }
 game.board.state=resolveToStability(makeState({sideToMove:'P2',turnIndex:4,pieces}));
 game.turns=[{index:4,startedAt:game.createdAt,endedAt:null,playerSeat:'Player 2',status:'active',moveIndexes:[],lastMoveAt:null}];
 game.gameplayRevision=1;
 assert.ok(applyAuthorizedPendingAutomaticEnding(game,{type:'pass'},
  {clientCommandId:'v2:zero',eventSeq:1,gameplayRevision:1,actorSide:'P2',turnIndex:4},structuredClone(game.board.state)));
 return game;
};

test('completed preview projects only the proven active count, including zero, and enforces per-game identity',async()=>{
 const DB=createFakeD1(),env={DB,GAME_ROOMS:null};env.GAME_ROOMS=createFakeGameRooms(()=>env);
 for(const game of [terminalGame(),terminalGame({complete:false}),zeroActionTerminalGame()])await persistGameState(env,game,1,null,{baseEventSeq:0});
 env.GAME_ROOMS.reset();
 const writesBefore=DB.getWrites().length;
 const read=async(game,identityId='owner')=>{
  const response=await handleApiRequest(request('/api/shell/games/review-previews',{identityId,items:[{gameId:game.id,gameplayRevision:game.gameplayRevision}]}),env);
  assert.equal(response.status,200);return (await response.json()).items[0];
 };
 const complete=await read(terminalGame());
 assert.equal(complete.ok,true);assert.equal(complete.completedActionCount,2);
 assert.equal(JSON.stringify(complete).includes('activeActionCountComplete'),false);
 const incomplete=await read(terminalGame({complete:false}));
 assert.equal(incomplete.ok,true);assert.equal(Object.hasOwn(incomplete,'completedActionCount'),false);
 const zero=await read(zeroActionTerminalGame());
 assert.equal(zero.ok,true);assert.equal(zero.completedActionCount,0);assert.equal(zero.preview,undefined);
 const denied=await read(terminalGame(),'stranger');
 assert.equal(denied.ok,false);assert.equal(denied.status,403);assert.equal(Object.hasOwn(denied,'completedActionCount'),false);
 assert.equal(DB.getWrites().length,writesBefore,'count projection cannot persist, restore, or backfill');
});

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
 for(const size of [0,5]){
   const items=Array.from({length:size},(_,index)=>({gameId:`g-${index}`,gameplayRevision:1}));
   assert.equal((await handleApiRequest(request('/api/shell/games/review-previews',{identityId:'owner',items}),env)).status,400);
 }
});

test('completed preview reads a retained compact legacy payload and archive without restore, backfill, or writes',async()=>{
 const catalog=JSON.parse(readFileSync(new URL('../../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
 const scenario=catalog.scenarios.find(record=>record.title==='Capture supply point to win by unsupplying the commander');
 assert.ok(scenario);
 const DB=createFakeD1(),env={DB,STORAGE_COMPRESSION:'true',GAME_ROOMS:null};env.GAME_ROOMS=createFakeGameRooms(()=>env);
 const game=createInitialGame({gameId:'retained-compact-completed',identityId:'owner',selfPlayMode:true});
 applyScenarioToGame(game,scenario);
 assert.equal(game.board.state.outcome.status,'p1_win');assert.ok(game.moves.length>1);
 const decisive=game.moves.at(-1);decisive.clientCommandId??='v2:retained';game.gameplayRevision=1;
 assert.ok(applyAcceptedAutomaticEnding(game,decisive.action,{move:decisive,destroyedPieces:decisive.destroyedPieces??[]},
  {clientCommandId:decisive.clientCommandId,eventSeq:1,gameplayRevision:1,actorSide:decisive.actorSide,turnOwnerSide:decisive.actorSide,turnIndex:decisive.turnIndex}));
 await DB.batch(archiveStatements(env,null,game,1));
 await persistGameState(env,game,1,null,{baseEventSeq:0});
 assert.equal(DB.getGameState(game.id).moves.length,0,'the indexed card row is the compact representation');
 assert.equal((await readDecision(env,game.id,game.moves.at(-1).moveId))?.move?.moveId,game.moves.at(-1).moveId,'the retained decision archive remains authoritative');
 env.GAME_ROOMS.reset();
 const writesBefore=DB.getWrites().length,readsBefore=DB.getReads().length;
 const response=await handleApiRequest(request('/api/shell/games/review-previews',{identityId:'owner',items:[{gameId:game.id,gameplayRevision:game.gameplayRevision}]}),env);
 assert.equal(response.status,200);
 const body=await response.json(),preview=body.items[0];
 assert.equal(preview.ok,true,JSON.stringify(body));assert.equal(preview.turnIndex,game.moves.at(-1).turnIndex);
 assert.equal(preview.completedActionCount,game.terminalOutcome.activeActionCount);
 assert.equal(preview.preview.overlay.presentationContext,'history');assert.ok(preview.preview.overlay.endpointRoles.length>0);
 assert.deepEqual(DB.getWrites().slice(writesBefore),[],'the preview cannot restore, backfill, or persist retained state');
 const reads=DB.getReads().slice(readsBefore).map(entry=>entry.query);
 assert.ok(reads.some(query=>query.includes('FROM game_payloads')),'the preview loads the compressed authoritative payload');
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
