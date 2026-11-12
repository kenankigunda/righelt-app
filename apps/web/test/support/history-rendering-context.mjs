import {renderBoardMessageHtml} from '../../board/message-presentation.js';
import {buildMovePreview,buildTurnPreview} from '../../shell/history-preview.js';
import {visibleRecordedMoves,recordedMoveNumber} from '../../shell/recorded-narration.js';
import {selectedHistoryPresentation} from '../../shell/history-narration.js';
import {isCompletedGame} from '../../shell/game-lifecycle.js';
import {historyTurnSide} from '../../shell/history-preview.js';
import * as undoHistory from '../../shell/history-undo-groups.js';
import {runInNewContext} from 'node:vm';
import {createHistoryRendering} from '../../shell/history-rendering.js';
export function runWithHistoryRendering(source, context) {
 context.historyRendering=createHistoryRendering(()=>({getShellLayoutMode:()=> 'wide',renderIncomingHistory:()=>'',...context}));
 return runInNewContext(source,context);
}
export function historyRenderingFixture(overrides={}) {
 const context={renderBoardMessageHtml,buildMovePreview,buildTurnPreview,visibleRecordedMoves,recordedMoveNumber,selectedHistoryPresentation,isCompletedGame,historyTurnSide,undoHistory,
  getShellLayoutMode:()=> 'wide',transport:{getIdentityId:()=> 'owner'},historyActorLabel:(_game,move)=>move.actorSide??'P1',
  escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),icon:()=>'',
  playerToneClassForSide:side=>side==='P1'?'player-tone-p1':side==='P2'?'player-tone-p2':'player-tone-neutral',playerToneClassForSeat:()=>'',
  COMPUTER_PROFILES:{},playerDisplayName:()=> 'Player',formatClientDateTime:String,liveHistoryLabel:()=> 'Waiting',
  boardContextScope:()=>{},boardContexts:{channel:()=>null},renderIncomingHistory:()=>'',expandedUndoneGroups:new Set(),...overrides};
 return {context,...createHistoryRendering(()=>context)};
}
