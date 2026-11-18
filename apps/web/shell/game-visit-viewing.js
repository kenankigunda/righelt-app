import {isCompletedGame,isOngoingGame} from './game-lifecycle.js';

// Browser state stores only a visit reference. Personal History checkpoints
// stay opaque, in memory, and owned by their original transport/account scope.
export function createGameVisitViewingOwner(getDependencies){
 const saved=new Map();let pending=null,restored=null,lastTransport=null,lastScope=null;
 const current=()=>{
  const d=getDependencies(),transport=d.getTransport(),scope=d.getScope();
  if(transport!==lastTransport||scope!==lastScope){saved.clear();pending=null;restored=null;lastTransport=transport;lastScope=scope;}
  return{...d,transport,scope};
 };
 const capture=(visitId,route)=>{
  const d=current();if(route?.name!=='game'||!route.gameId||!visitId)return null;
  const checkpoint=d.transport?.captureHistoryView?.({gameId:route.gameId});if(!checkpoint)return null;
  saved.set(visitId,{gameId:route.gameId,checkpoint,transport:d.transport,scope:d.scope});
  return{visitId,gameId:route.gameId};
 };
 const arrive=(route,{restore=null,traversed=false,fromHome=false}={})=>{
  const d=current();restored=null;
  const retainedPending=!traversed&&!fromHome&&route?.name==='game'&&pending?.gameId===route.gameId?pending:null;pending=retainedPending;
  if(route?.name!=='game'||!route.gameId){pending=null;return;}
  if(traversed){
   const entry=restore&&saved.get(restore.visitId);
   if(entry&&restore.gameId===route.gameId&&entry.gameId===route.gameId&&entry.transport===d.transport&&entry.scope===d.scope){
    d.advanceView(entry.gameId);
    if(d.transport.restoreHistoryView?.({gameId:entry.gameId,checkpoint:entry.checkpoint}))restored={gameId:entry.gameId,transport:d.transport,scope:d.scope};
   }
   return;
  }
  if(fromHome)pending={gameId:route.gameId,transport:d.transport,scope:d.scope,generation:d.getViewGeneration(route.gameId)};
 };
 const sync=()=>{
  const d=current();if(!pending||!d.isReady())return false;
  const entry=pending,route=d.getRoute();
  if(route?.name!=='game'||route.gameId!==entry.gameId||d.transport!==entry.transport||d.scope!==entry.scope||d.getViewGeneration(entry.gameId)!==entry.generation){pending=null;return false;}
  const authoritative=d.transport.getAuthoritativeGame(entry.gameId);
  if(isCompletedGame(authoritative)){pending=null;return false;}
  if(!isOngoingGame(authoritative))return false;
  pending=null;d.advanceView(entry.gameId);d.transport.returnToLive({gameId:entry.gameId});return true;
 };
 const consumeRestored=(game)=>{
  const d=current();if(!restored||!game||game.id!==restored.gameId||game.historyLoading)return false;
  const route=d.getRoute(),entry=restored;restored=null;
  const selected=route?.name==='game'&&route.gameId===game.id&&entry.transport===d.transport&&entry.scope===d.scope&&game.inHistoryMode===true;
  if(selected)d.restorePersonalHistory?.(game.id);
  return selected;
 };
 return{capture,arrive,sync,consumeRestored,clear(){saved.clear();pending=null;restored=null;}};
}
