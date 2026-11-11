import {createHistoryRendering} from '../shell/history-rendering.js';
import * as undoHistory from '../shell/history-undo-groups.js';
import {selectedHistoryPresentation} from '../shell/history-narration.js';
import {recordedMoveNumber,visibleRecordedMoves} from '../shell/recorded-narration.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdditionalHistory,canReadAdditionalHistory} from '../shell/additional-history.js';
async function renderAccess(accountState,ownershipMode){
 let requests=0,authorityResets=0,dialogOpen=true,focused='start-new-game';
 const game={id:'g',gameplayRevision:0,ownershipMode};
 const context={undoHistory,expandedUndoneGroups:new Set(),selectedHistoryPresentation,recordedMoveNumber,visibleRecordedMoves,renderBoardMessageHtml,createAdditionalHistory,canReadAdditionalHistory,account:{snapshot:()=>accountState},getCurrentViewedGameId:()=> 'g',render:()=>{},escapeHtml:String,icon:()=>'',queueMicrotask,
  transport:{getIdentityId:()=> 'viewer',getAuthoritativeGame:()=>game,additionalHistory:async()=>{
   requests++;
   if(accountState.enabled&&(!accountState.session.authenticated||ownershipMode==='legacy_guest')){
    authorityResets++;dialogOpen=false;focused=null;throw Object.assign(Error('invalid_credentials'),{code:'invalid_credentials'});
   }
   return {gameplayRevision:0,available:false,items:[],nextCursor:null};
  }}};
 context.additionalHistory=createAdditionalHistory({
  getScope:gameId=>{const value=context.transport.getAuthoritativeGame(gameId),state=context.account.snapshot();return canReadAdditionalHistory(value,state)?{gameId,owner:context.transport,generation:state.generation,revision:value.gameplayRevision}:null;},
  load:(scope,values)=>scope.owner.additionalHistory(scope.gameId,values),onChange:()=>{},
 });
 context.draw=()=>createHistoryRendering(()=>context).renderAdditionalHistory(game);
 for(let i=0;i<20;i++)context.draw();
 for(let i=0;i<10;i++)await Promise.resolve();
 context.draw();
 return {requests,authorityResets,dialogOpen,focused};
}
test('actual history rendering never probes protected archives for unauthenticated or legacy views',async()=>{
 for(const state of [{enabled:true,ready:true,session:{authenticated:false}},{enabled:true,ready:false,session:{authenticated:true}}])assert.deepEqual(await renderAccess(state,'account'),{requests:0,authorityResets:0,dialogOpen:true,focused:'start-new-game'});
 assert.deepEqual(await renderAccess({enabled:true,ready:true,session:{authenticated:true}},'legacy_guest'),{requests:0,authorityResets:0,dialogOpen:true,focused:'start-new-game'});
});
test('normal signed-in observers and guest-mode games keep one authoritative availability probe',async()=>{
 for(const state of [{enabled:true,ready:true,session:{authenticated:true}},{enabled:false,ready:true,session:{authenticated:false}}])assert.deepEqual(await renderAccess(state,'account'),{requests:1,authorityResets:0,dialogOpen:true,focused:'start-new-game'});
});
