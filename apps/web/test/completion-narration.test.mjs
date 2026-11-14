import test from 'node:test';
import assert from 'node:assert/strict';
import {completedOutcomeNarration} from '../shell/completion-narration.js';
import {selectedHistoryPresentation} from '../shell/history-narration.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
import {MAX_HISTORY} from '../generated/packages/shared-types/src/history.js';

const person=(identityId,name)=>({identityId,profile:{displayName:name}});
const commander=(id,owner)=>({id,owner,kind:'commander',position:{row:owner==='P1'?0:9,col:0},supplied:true,commanded:true});
const fixture=({status='p1_win',reason='p2_commander_destroyed',count=2,complete=true,lineageComplete=complete,
 cause,action,removals,decisionId='final',includeImported=true,actorSide=decisionId===null?'P2':'P1',extra={}}={})=>{
 const decisiveAction=action??{type:'push',actorId:'u1',from:{row:8,col:2},to:{row:9,col:2}};
 const terminal={outcome:{status,reason},pieces:[commander('c1','P1')]};
 const removed=removals??[{pieceId:'c2',kind:'commander',position:{row:9,col:2},ownerSeat:'p2',supplied:false,commanded:false,reason:'commander_unsupplied'}];
 const record={version:1,decisive:{action:decisiveAction,actorSide,decisionId,clientCommandId:'v2:final',turnIndex:4},
  board:structuredClone(terminal),result:{status,reason},removals:removed,
  cause:cause??{kind:'relevant-continuation-finality',endpointCount:2,optionalEndpointCount:1},commit:{eventSeq:9,gameplayRevision:7,clientCommandId:'v2:final'},
  lineage:{version:includeImported?1:null,complete:lineageComplete,importedMoveCount:includeImported?1:0,
   sources:includeImported?[{gameId:'source',gameplayRevision:3,moveCount:1}]:[]},activeActionCount:count,activeActionCountComplete:complete};
 const imported={moveId:'imported-one',index:0,displayMoveNumber:1,turnIndex:3,turnMoveIndex:0,actorSide:'P2',action:{type:'pass'},
  selectionSnapshot:{sideToMove:'P2',pieces:[]},snapshot:terminal,destroyedPieces:[],importedFrom:{gameId:'source',decisionId:'source-one',gameplayRevision:3}};
 const move=decisionId===null?null:{moveId:decisionId,index:includeImported?1:0,displayMoveNumber:includeImported?2:1,turnIndex:4,turnMoveIndex:0,
  actorSide,clientCommandId:'v2:final',action:decisiveAction,selectionSnapshot:{sideToMove:'P1',pieces:[]},snapshot:terminal,destroyedPieces:structuredClone(removed)};
 const moves=[...(includeImported?[imported]:[]),...(move?[move]:[]),{moveId:'undone-noise',turnIndex:99,undone:true}];
 const turns=[...(includeImported?[{index:3,playerSeat:'Player 2',status:'complete',endedAt:'earlier',moveIndexes:[0]}]:[]),
  {index:4,playerSeat:decisionId===null?'Player 2':'Player 1',status:'complete',endedAt:'terminal',moveIndexes:move?[move.index]:[]}];
 return {id:'g',gameplayRevision:7,board:{state:terminal},terminalOutcome:record,moves,turns,
  ...(includeImported?{importedHistory:{version:1,complete:lineageComplete,moveCount:1,sources:[{gameId:'source',gameplayRevision:3,moveCount:1}]}}:{}),
  player1:person('me','Horus'),player2:person('other','Guest'),myRole:'Player 1',myRoles:['Player 1'],inHistoryMode:true,historyTurnIndex:4,historyTurnMoves:move?[move]:[],...extra};
};

test('decisive push narration consumes the canonical imported and local count and closed cause only',()=>{
 const game=fixture(),message=completedOutcomeNarration(game,{identityId:'me'});
 assert.equal(message.text,'You won in 2 moves. Their push to (9, 2) destroyed Guest’s commander.');
 const html=renderBoardMessageHtml(message);
 assert.match(html,/player-tone-p1[^>]*>.*You won in 2 moves\./);
 assert.match(html,/board-preview-coordinate-chip-neutral[^>]*>9, 2/);
 assert.match(html,/player-tone-p2[^>]*>.*Guest’s commander/);
 assert.doesNotMatch(message.text,/41|99/,'visible and undone History numbers are not recount inputs');
});

test('count and cause stay independently unknown instead of being reconstructed',()=>{
 const incomplete=fixture({complete:false});
 assert.equal(completedOutcomeNarration(incomplete,{identityId:'me'}).text,'You won. Their push to (9, 2) destroyed Guest’s commander.');
 const malformed=fixture({cause:{kind:'relevant-continuation-finality',endpointCount:0,optionalEndpointCount:0}});
 assert.equal(completedOutcomeNarration(malformed,{identityId:'me'}).text,'You won in 2 moves.');
 const wrongTurn=fixture();wrongTurn.terminalOutcome.decisive.turnIndex=3;
 assert.equal(completedOutcomeNarration(wrongTurn,{identityId:'me'}),null);
 delete malformed.terminalOutcome;
 assert.equal(completedOutcomeNarration(malformed,{identityId:'me'}),null);
});

test('saturated local evidence with complete imported lineage does not publish an incomplete count',()=>{
 const saturated=fixture({count:MAX_HISTORY,complete:false,lineageComplete:true,includeImported:false});
 const decisive=saturated.moves.find(move=>move.moveId==='final');
 saturated.moves=[...Array.from({length:MAX_HISTORY-1},(_,index)=>({moveId:`local-${index}`,index,turnIndex:index,turnMoveIndex:0,
  actorSide:index%2?'P2':'P1',action:{type:'pass'},selectionSnapshot:{sideToMove:'P1',pieces:[]},snapshot:saturated.board.state,destroyedPieces:[]})),decisive];
 assert.equal(saturated.terminalOutcome.lineage.complete,true);
 assert.equal(saturated.terminalOutcome.activeActionCountComplete,false);
 assert.equal(completedOutcomeNarration(saturated,{identityId:'me'}).text,'You won. Their push to (9, 2) destroyed Guest’s commander.');
});

test('saved supply, immobility and draw causes use only their closed provenance variants',()=>{
 const supply=fixture({reason:'p2_commander_unsupplied',cause:{kind:'commander-settlement',reason:'p2_commander_unsupplied'},removals:[]});
 assert.equal(completedOutcomeNarration(supply,{identityId:'me'}).text,'You won in 2 moves. Guest’s commander lost its supply.');
 const immobile=fixture({reason:'p2_incoming_turn_immobility',count:0,cause:{kind:'incoming-turn-immobility',incomingSide:'P2'},
  action:{type:'pass'},removals:[],decisionId:null,includeImported:false,extra:{player2:person('other','Alex')}});
 assert.equal(immobile.historyTurnMoves.length,0);assert.equal(immobile.terminalOutcome.decisive.decisionId,null);
 assert.equal(completedOutcomeNarration(immobile,{identityId:'me'}).text,'You won in 0 moves because Alex had no legal move.');
 assert.equal(selectedHistoryPresentation(immobile,{identityId:'me'}).message.text,'You won in 0 moves because Alex had no legal move.');
 const mismatched=structuredClone(immobile);mismatched.terminalOutcome.decisive.actorSide='P1';
 assert.equal(completedOutcomeNarration(mismatched,{identityId:'me'}).text,'You won in 0 moves.');
 const draw=fixture({status:'draw',reason:'both_commanders_unsupplied',count:1,cause:{kind:'commander-settlement',reason:'both_commanders_unsupplied'},removals:[],extra:{myRole:'Viewer',myRoles:[]}});
 assert.equal(completedOutcomeNarration(draw,{identityId:'viewer'}).text,'The game ended in a draw after 1 move. Horus’s commander and Guest’s commander lost their supply.');
});

test('combined commander causes retain both complete proven predicates',()=>{
 const p1Removal={pieceId:'c1',kind:'commander',position:{row:0,col:0},ownerSeat:'p1',supplied:false,commanded:false,reason:'commander_unsupplied'};
 const p2Removal={pieceId:'c2',kind:'commander',position:{row:9,col:2},ownerSeat:'p2',supplied:false,commanded:false,reason:'commander_unsupplied'};
 const viewer={myRole:'Viewer',myRoles:[]};
 const both=fixture({status:'draw',reason:'both_commanders_destroyed',cause:{kind:'commander-settlement',reason:'both_commanders_destroyed'},removals:[p1Removal,p2Removal],extra:viewer});
 assert.equal(completedOutcomeNarration(both,{identityId:'viewer'}).text,
  'The game ended in a draw after 2 moves. Horus’s commander was destroyed, and Guest’s commander was destroyed.');
 const firstDestroyed=fixture({status:'draw',reason:'p1_commander_destroyed_p2_unsupplied',cause:{kind:'commander-settlement',reason:'p1_commander_destroyed_p2_unsupplied'},removals:[p1Removal],extra:viewer});
 assert.equal(completedOutcomeNarration(firstDestroyed,{identityId:'viewer'}).text,
  'The game ended in a draw after 2 moves. Horus’s commander was destroyed, and Guest’s commander lost its supply.');
 const secondDestroyed=fixture({status:'draw',reason:'p1_commander_unsupplied_p2_destroyed',cause:{kind:'commander-settlement',reason:'p1_commander_unsupplied_p2_destroyed'},removals:[p2Removal],extra:viewer});
 assert.equal(completedOutcomeNarration(secondDestroyed,{identityId:'viewer'}).text,
  'The game ended in a draw after 2 moves. Horus’s commander lost its supply, and Guest’s commander was destroyed.');
});

test('a coordinate-like player name stays literal while the proven action coordinate becomes a chip',()=>{
 const game=fixture({extra:{player2:person('other','(9, 2)')}}),message=completedOutcomeNarration(game,{identityId:'me'});
 const html=renderBoardMessageHtml(message);
 assert.equal(message.text,'You won in 2 moves. Their push to (9, 2) destroyed (9, 2)’s commander.');
 assert.equal((html.match(/board-preview-coordinate-chip-neutral/g)??[]).length,1);
 assert.match(html,/player-tone-p2[^>]*>[\s\S]*\(9, 2\)’s commander/);
});

test('proven decisive retreat uses approved viewer-relative naming without claiming a mechanism',()=>{
 const postRetreat=fixture({reason:'p2_commander_unsupplied',count:12,actorSide:'P2',
  cause:{kind:'relevant-continuation-finality',endpointCount:2,optionalEndpointCount:1},
  action:{type:'retreat',actorId:'c2',from:{row:9,col:1},to:{row:8,col:1}},removals:[],
  extra:{player1:person('sam','Sam'),player2:person('alex','Alex')}});
 assert.equal(completedOutcomeNarration(postRetreat,{identityId:'sam'}).text,'You won in 12 moves after Alex retreated.');
 assert.equal(completedOutcomeNarration(postRetreat,{identityId:'alex'}).text,'Sam won in 12 moves after you retreated.');
 assert.equal(completedOutcomeNarration(postRetreat,{identityId:'viewer'}).text,'Sam won in 12 moves after Alex retreated.');

 const selfPlay=fixture({reason:'p2_commander_unsupplied',count:12,actorSide:'P2',
  cause:{kind:'relevant-continuation-finality',endpointCount:2,optionalEndpointCount:1},
  action:{type:'retreat',actorId:'c2',from:{row:9,col:1},to:{row:8,col:1}},removals:[],
  extra:{selfPlayMode:true,selfPlayStartSide:'p1',player1:person('me','Sam'),player2:person('me','Sam'),myRole:'Both Players',myRoles:['Player 1','Player 2']}});
 assert.equal(completedOutcomeNarration(selfPlay,{identityId:'me'}).text,'You won as Red in 12 moves after you retreated as Blue.');
});

test('retreat wording fails closed without complete count, losing-side actor, or retreat provenance',()=>{
 const approved={reason:'p2_commander_unsupplied',actorSide:'P2',cause:{kind:'relevant-continuation-finality',endpointCount:2,optionalEndpointCount:1},
  action:{type:'retreat',actorId:'c2',from:{row:9,col:1},to:{row:8,col:1}},removals:[]};
 assert.equal(completedOutcomeNarration(fixture({...approved,complete:false}),{identityId:'me'}).text,'You won.');
 assert.equal(completedOutcomeNarration(fixture({...approved,actorSide:'P1'}),{identityId:'me'}).text,'You won in 2 moves.');
 assert.equal(completedOutcomeNarration(fixture({...approved,decisionId:null}),{identityId:'me'}).text,'You won in 2 moves.');
 assert.equal(completedOutcomeNarration(fixture({...approved,action:{type:'rush',actorIds:['u1'],to:{row:8,col:1}}}),{identityId:'me'}).text,
  'You won in 2 moves. Their final rush sequence cut off supply to Guest’s commander.');
});

test('self-play and bidi identities retain explicit side meaning and escaped color scopes',()=>{
 const name='משחק <星>',game=fixture({extra:{selfPlayMode:true,selfPlayStartSide:'p1',player1:person('me',name),player2:person('me',name),myRole:'Both Players',myRoles:['Player 1','Player 2']}});
 const message=completedOutcomeNarration(game,{identityId:'me'}),html=renderBoardMessageHtml(message);
 assert.equal(message.text,'You won as Red in 2 moves. Their push to (9, 2) destroyed Your Blue commander.');
 assert.match(html,/player-tone-p1/);assert.match(html,/player-tone-p2/);
 assert.doesNotMatch(html,/<星>/);assert.match(html,/You won as Red in 2 moves/);
});

test('only the decisive Board narration changes; its heading and earlier turns remain intact',()=>{
 const game=fixture(),decisive=selectedHistoryPresentation(game,{identityId:'me'});
 assert.equal(decisive.caption.text,'You won on Turn 5');
 assert.equal(decisive.message.text,'You won in 2 moves. Their push to (9, 2) destroyed Guest’s commander.');
 const earlierMove={...game.moves.find(move=>move.moveId==='final'),moveId:'earlier',turnIndex:2,action:{type:'pass'},destroyedPieces:[]};
 const earlier=selectedHistoryPresentation({...game,historyTurnIndex:2,historyTurnMoves:[earlierMove]},{identityId:'me'});
 assert.equal(earlier.caption.text,'Turn 3');
 assert.equal(earlier.message.text,'You passed');
});

test('tampered terminal provenance falls back without recounting History',()=>{
 const game=fixture();game.terminalOutcome.result.status='p2_win';
 assert.equal(completedOutcomeNarration(game,{identityId:'me'}),null);
 const presentation=selectedHistoryPresentation(game,{identityId:'me'});
 assert.equal(presentation.caption.text,'You won on Turn 5');
 assert.doesNotMatch(presentation.message.text,/in \d+ moves|destroyed Guest’s commander/);
});
