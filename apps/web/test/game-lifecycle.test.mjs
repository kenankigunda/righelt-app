import test from 'node:test';
import assert from 'node:assert/strict';
import {isCompletedGame,isOngoingGame,isTerminalOutcome} from '../shell/game-lifecycle.js';
import {renderHistoryResult} from '../shell/game-result.js';
const game=status=>({id:'g',myRole:'Player 1',board:{state:{outcome:{status}}},player1:{identityId:'a'},player2:{identityId:'b'}});
for(const status of ['p1_win','p2_win','draw'])test(`${status} remains completed while reviewing an earlier position`,()=>{
 const finished=game(status);assert.equal(isTerminalOutcome(status),true);assert.equal(isCompletedGame(finished),true);assert.equal(isOngoingGame(finished),false);
 const historical={...finished,board:{state:{outcome:{status:'ongoing'}}},liveCurrentSnapshot:finished.board.state};assert.equal(isCompletedGame(historical),true);assert.equal(isOngoingGame(historical),false);
});
test('only an explicitly ongoing live game permits gameplay',()=>{
 assert.equal(isOngoingGame(game('ongoing')),true);assert.equal(isOngoingGame(null),false);assert.equal(isOngoingGame({}),false);
 assert.equal(isOngoingGame({...game('ongoing'),status:'finished'}),true,'authoritative undo can reopen a game despite stale display metadata');
});
test('History presents perspective-aware winner and color, including observers and draws',()=>{
 assert.match(renderHistoryResult(game('p1_win'),'a'),/You won<\/strong> <span>· Red/);
 assert.match(renderHistoryResult(game('p2_win'),'a'),/Your opponent won<\/strong> <span>· Blue/);
 assert.match(renderHistoryResult(game('p2_win'),'observer'),/Guest 2 won<\/strong> <span>· Blue/);
 assert.match(renderHistoryResult(game('draw'),'a'),/Draw<\/strong>/);assert.doesNotMatch(renderHistoryResult(game('draw'),'a'),/· (Red|Blue)/);
 assert.equal(renderHistoryResult(game('ongoing'),'a'),'');
 const named={...game('p1_win'),player1:{identityId:'a',profile:{displayName:'<Ada>'}}};assert.match(renderHistoryResult(named,'observer'),/&lt;Ada&gt; won/);
});
