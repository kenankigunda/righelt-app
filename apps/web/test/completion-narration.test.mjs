import test from 'node:test';
import assert from 'node:assert/strict';
import {completedOutcomeNarration} from '../shell/completion-narration.js';
import {selectedHistoryPresentation} from '../shell/history-narration.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';

const person=(identityId,name)=>({identityId,profile:{displayName:name}});
const commander=(id,owner)=>({id,owner,kind:'commander',position:{row:owner==='P1'?0:9,col:0},supplied:true,commanded:true});
const fixture=({status='p1_win',reason='p2_commander_destroyed',count=12,complete=true,cause,action,removals,extra={}}={})=>{
 const decisiveAction=action??{type:'push',actorId:'u1',from:{row:8,col:2},to:{row:9,col:2}};
 const terminal={outcome:{status,reason},pieces:[commander('c1','P1')]};
 const record={version:1,decisive:{action:decisiveAction,actorSide:'P1',decisionId:'final',clientCommandId:'v2:final',turnIndex:4},
  board:structuredClone(terminal),result:{status,reason},removals:removals??[{pieceId:'c2',kind:'commander',position:{row:9,col:2},ownerSeat:'p2',supplied:false,commanded:false,reason:'commander_unsupplied'}],
  cause:cause??{kind:'relevant-continuation-finality',endpointCount:2,optionalEndpointCount:1},commit:{eventSeq:9,gameplayRevision:7,clientCommandId:'v2:final'},
  lineage:{version:1,complete,importedMoveCount:7,sources:[{gameId:'source',gameplayRevision:3,moveCount:7}]},activeActionCount:count,activeActionCountComplete:complete};
 const move={moveId:'final',index:40,displayMoveNumber:41,turnIndex:4,turnMoveIndex:0,actorSide:'P1',action:decisiveAction,selectionSnapshot:{sideToMove:'P1',pieces:[]},snapshot:terminal};
 return {id:'g',gameplayRevision:7,board:{state:terminal},terminalOutcome:record,moves:[move,{moveId:'undone-noise',turnIndex:99,undone:true}],turns:[{index:4,playerSeat:'Player 1',moveIndexes:[40]}],
  player1:person('me','Horus'),player2:person('other','Guest'),myRole:'Player 1',myRoles:['Player 1'],inHistoryMode:true,historyTurnIndex:4,historyTurnMoves:[move],...extra};
};

test('decisive push narration consumes the frozen complete count and closed cause only',()=>{
 const game=fixture({count:329}),message=completedOutcomeNarration(game,{identityId:'me'});
 assert.equal(message.text,'You won in 329 moves. Their push to (9, 2) destroyed Guest’s commander.');
 const html=renderBoardMessageHtml(message);
 assert.match(html,/player-tone-p1[^>]*>.*You won in 329 moves\./);
 assert.match(html,/board-preview-coordinate-chip-neutral[^>]*>9, 2/);
 assert.match(html,/player-tone-p2[^>]*>.*Guest’s commander/);
 assert.doesNotMatch(message.text,/41|99/,'visible and undone History numbers are not recount inputs');
});

test('count and cause stay independently unknown instead of being reconstructed',()=>{
 const incomplete=fixture({count:329,complete:false});
 assert.equal(completedOutcomeNarration(incomplete,{identityId:'me'}).text,'You won. Their push to (9, 2) destroyed Guest’s commander.');
 const malformed=fixture({cause:{kind:'relevant-continuation-finality',endpointCount:0,optionalEndpointCount:0}});
 assert.equal(completedOutcomeNarration(malformed,{identityId:'me'}).text,'You won in 12 moves.');
 const wrongTurn=fixture();wrongTurn.terminalOutcome.decisive.turnIndex=3;
 assert.equal(completedOutcomeNarration(wrongTurn,{identityId:'me'}),null);
 delete malformed.terminalOutcome;
 assert.equal(completedOutcomeNarration(malformed,{identityId:'me'}),null);
});

test('saved supply, immobility and draw causes use only their closed provenance variants',()=>{
 const supply=fixture({reason:'p2_commander_unsupplied',cause:{kind:'commander-settlement',reason:'p2_commander_unsupplied'},removals:[]});
 assert.equal(completedOutcomeNarration(supply,{identityId:'me'}).text,'You won in 12 moves. Guest’s commander lost its supply.');
 const immobile=fixture({reason:'p2_incoming_turn_immobility',cause:{kind:'incoming-turn-immobility',incomingSide:'P2'},removals:[]});
 assert.equal(completedOutcomeNarration(immobile,{identityId:'me'}).text,'You won in 12 moves. Guest had no legal move except Pass.');
 const draw=fixture({status:'draw',reason:'both_commanders_unsupplied',count:1,cause:{kind:'commander-settlement',reason:'both_commanders_unsupplied'},removals:[],extra:{myRole:'Viewer',myRoles:[]}});
 assert.equal(completedOutcomeNarration(draw,{identityId:'viewer'}).text,'The game ended in a draw after 1 move. Horus’s commander and Guest’s commander lost their supply.');
});

test('self-play and bidi identities retain explicit side meaning and escaped color scopes',()=>{
 const name='משחק <星>',game=fixture({extra:{selfPlayMode:true,selfPlayStartSide:'p1',player1:person('me',name),player2:person('me',name),myRole:'Both Players',myRoles:['Player 1','Player 2']}});
 const message=completedOutcomeNarration(game,{identityId:'me'}),html=renderBoardMessageHtml(message);
 assert.equal(message.text,'You won as Red in 12 moves. Their push to (9, 2) destroyed Your Blue commander.');
 assert.match(html,/player-tone-p1/);assert.match(html,/player-tone-p2/);
 assert.doesNotMatch(html,/<星>/);assert.match(html,/You won as Red in 12 moves/);
});

test('only the decisive Board narration changes; its heading and earlier turns remain intact',()=>{
 const game=fixture(),decisive=selectedHistoryPresentation(game,{identityId:'me'});
 assert.equal(decisive.caption.text,'You won on Turn 5');
 assert.equal(decisive.message.text,'You won in 12 moves. Their push to (9, 2) destroyed Guest’s commander.');
 const earlierMove={...game.moves[0],moveId:'earlier',turnIndex:3,action:{type:'pass'}};
 const earlier=selectedHistoryPresentation({...game,historyTurnIndex:3,historyTurnMoves:[earlierMove]},{identityId:'me'});
 assert.equal(earlier.caption.text,'Turn 4');
 assert.equal(earlier.message.text,'You passed');
});
