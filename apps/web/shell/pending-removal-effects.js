const activeRecords = moves => (moves ?? []).filter(move=>!move.undone)
 .flatMap(move=>(move.destroyedPieces??[]).map(record=>({record,key:record.eventId??`${move.clientCommandId??move.moveId??move.index}:${record.pieceId??`${record.position?.row},${record.position?.col}`}`})));

// End turn can append destruction to an acknowledged move without adding a
// pending move. Retain only the new predicted records until authority arrives.
export function getPendingRemovalEffects(view,authoritativeGame){
 const pending=activeRecords(view?.pendingMoves);
 if(view?.pendingCommandCount>0&&authoritativeGame?.id===view.id){
  const confirmed=new Set(activeRecords(authoritativeGame.moves).map(entry=>entry.key));
  pending.push(...activeRecords(view.moves).filter(entry=>!confirmed.has(entry.key)));
 }
 return [...new Map(pending.map(entry=>[entry.key,entry.record])).values()];
}
