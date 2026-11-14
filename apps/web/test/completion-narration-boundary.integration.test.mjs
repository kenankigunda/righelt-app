import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialGame} from '../../../packages/api-handler/src/shell-live-core.ts';
import {loadGameProjection,persistGameState} from '../../../packages/api-handler/src/shell-live-db.ts';
import {createFakeD1} from '../../../packages/api-handler/test/support/fake-d1.mjs';
import {completedOutcomeNarration} from '../shell/completion-narration.js';

const canonicalTerminalGame=()=>{
 const game=createInitialGame({gameId:'t145-boundary',identityId:'owner',selfPlayMode:true});
 const terminal=structuredClone(game.board.state);
 terminal.pieces=terminal.pieces.filter(piece=>piece.id!=='C2');
 terminal.outcome={status:'p1_win',reason:'p2_commander_destroyed'};
 const removal={pieceId:'C2',kind:'commander',position:{row:9,col:0},ownerSeat:'p2',supplied:false,commanded:false,reason:'commander_unsupplied'};
 const imported={moveId:'imported-one',index:0,turnIndex:0,turnMoveIndex:0,displayMoveNumber:1,actorSide:'P1',at:game.createdAt,
  notation:'Pass',action:{type:'pass'},selectionSnapshot:structuredClone(terminal),snapshot:structuredClone(terminal),destroyedPieces:[],
  importedFrom:{gameId:'source-game',decisionId:'source-one',gameplayRevision:3}};
 const action={type:'push',actorId:'U1-1',from:{row:8,col:0},to:{row:9,col:0}};
 const decisive={moveId:'local-final',index:1,turnIndex:0,turnMoveIndex:1,displayMoveNumber:2,actorSide:'P1',at:game.createdAt,
  notation:'Push',action,clientCommandId:'v2:final',selectionSnapshot:structuredClone(terminal),snapshot:structuredClone(terminal),destroyedPieces:[removal]};
 game.board.state=terminal;game.gameplayRevision=1;game.moves=[imported,decisive];
 game.turns=[{index:0,startedAt:game.createdAt,endedAt:game.updatedAt,playerSeat:'Player 1',status:'complete',moveIndexes:[0,1],lastMoveAt:game.updatedAt}];
 game.importedHistory={version:1,complete:true,moveCount:1,sources:[{gameId:'source-game',gameplayRevision:3,moveCount:1}]};
 game.terminalOutcome={version:1,decisive:{action,actorSide:'P1',decisionId:'local-final',clientCommandId:'v2:final',turnIndex:0},
  board:structuredClone(terminal),result:structuredClone(terminal.outcome),removals:[removal],
  cause:{kind:'relevant-continuation-finality',endpointCount:2,optionalEndpointCount:1},
  commit:{eventSeq:1,gameplayRevision:1,clientCommandId:'v2:final'},
  lineage:{version:1,complete:true,importedMoveCount:1,sources:[{gameId:'source-game',gameplayRevision:3,moveCount:1}]},
  activeActionCount:2,activeActionCountComplete:true};
 return game;
};

const completedView=game=>({...game,myRole:'Both Players',myRoles:['Player 1','Player 2'],inHistoryMode:true,historyTurnIndex:0,
 historyTurnMoves:game.moves.filter(move=>move.turnIndex===0)});

test('authoritative persisted normalization feeds the exact closed record to completion narration',async()=>{
 const env={DB:createFakeD1()},game=canonicalTerminalGame();await persistGameState(env,game,1);
 const loaded=await loadGameProjection(env,game.id);assert.equal(loaded.kind,'ok');assert.deepEqual(loaded.game.terminalOutcome,game.terminalOutcome);
 const narration=completedOutcomeNarration(completedView(loaded.game),{identityId:'owner'});
 assert.match(narration.text,/in 2 moves\./);assert.match(narration.text,/push to \(9, 0\)/);
});

test('tampered provenance is rejected at normalization and missing provenance never triggers a History recount',async()=>{
 const tamperedEnv={DB:createFakeD1()},tampered=canonicalTerminalGame();await persistGameState(tamperedEnv,tampered,1);
 tamperedEnv.DB.overwriteGameState(tampered.id,value=>{value.terminalOutcome.board.turnIndex+=1;return value;});
 const rejected=await loadGameProjection(tamperedEnv,tampered.id);assert.equal(rejected.kind,'invalid');

 const legacyEnv={DB:createFakeD1()},legacy=canonicalTerminalGame();legacy.id='t145-legacy';delete legacy.terminalOutcome;
 await persistGameState(legacyEnv,legacy,1);const loaded=await loadGameProjection(legacyEnv,legacy.id);assert.equal(loaded.kind,'ok');
 assert.equal(completedOutcomeNarration(completedView(loaded.game),{identityId:'owner'}),null);
});
