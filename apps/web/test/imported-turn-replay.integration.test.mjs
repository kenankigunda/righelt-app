import test from 'node:test';
import assert from 'node:assert/strict';
import {captureDisplayedReplay,displayedReplayIsCurrent} from '../shell/displayed-replay.js';
import {historyRenderingFixture} from './support/history-rendering-context.mjs';

test('the actual History renderer offers one owned replay for the selected imported turn and no imported Undo',()=>{
 const snapshot={pieces:[],turnIndex:0,sideToMove:'P1',outcome:{status:'ongoing'}};
 const move={moveId:'imported',index:0,displayMoveNumber:1,turnIndex:0,turnMoveIndex:0,actorSide:'P1',action:{type:'pass'},notation:'PASS',at:'2026-11-19T00:00:00Z',selectionSnapshot:snapshot,snapshot:{...snapshot,turnIndex:1,sideToMove:'P2'},importedFrom:{gameId:'source',decisionId:'original'}};
 const owner={},game={id:'destination',gameplayRevision:1,inHistoryMode:true,historyTurnIndex:0,historyIndex:null,historyTurnMoves:[move],moves:[move],turns:[{index:0,playerSeat:'Player 1',moveIndexes:[0],endedAt:move.at}],currentTurn:{index:1,playerSeat:'Player 2',moveIndexes:[]},board:{state:move.snapshot},importedHistory:{moveCount:1},canRecordMove:true};
 const before=structuredClone(game),scope='account/visit',context={owner,scope,gameId:game.id,revision:1,lineageHead:'imported',visible:true,viewGeneration:4};
 const descriptor=()=>captureDisplayedReplay({game,owner,scope,source:'imported-turn',viewGeneration:4});
 const fixture=historyRenderingFixture({expandedImportedHistory:new Set([game.id]),transport:owner,importedTurnReplayDescriptor:descriptor,contextReplayEnabled:d=>displayedReplayIsCurrent(d,{game,context})});
 owner.getIdentityId=()=> 'viewer';
 const html=fixture.renderTurnHistory(game);
 assert.equal((html.match(/data-replay-source="imported-turn"/g)??[]).length,1);
 assert.equal((html.match(/>Show me again<\/button>/g)??[]).length,1);
 assert.match(html,/data-action="replay-board-context"/);
 assert.doesNotMatch(html,/Undo before this move/);
 assert.deepEqual(game,before);
 const unavailable=historyRenderingFixture({expandedImportedHistory:new Set([game.id]),transport:owner,importedTurnReplayDescriptor:()=>null}).renderTurnHistory(game);
 assert.doesNotMatch(unavailable,/data-replay-source="imported-turn"/);
});
