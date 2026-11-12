import {visibleRecordedMoves} from './recorded-narration.js';

const sequence = entry => Number.isSafeInteger(entry?.eventSeq) && entry.eventSeq >= 0
  && Number.isSafeInteger(entry?.ordinal) && entry.ordinal >= 0 ? [entry.eventSeq,entry.ordinal] : null;
const compare = (a,b) => a[0]-b[0] || a[1]-b[1];
const boundaryKind = record => {
  const move=record.move;
  if(move.undone!==true || record.entry?.historyStatus==='unknown') return null;
  if(!record.conflict && Number.isSafeInteger(move.undoEventSeq) && move.undoEventSeq>0) return 'accepted';
  if(!record.conflict && typeof move.pendingUndoRequestId==='string' && move.pendingUndoRequestId) return 'pending';
  return 'unavailable';
};
const fold = records => {
  const visible=new Map(visibleRecordedMoves(records.map(record=>record.move),{includeUndone:true,preserveInputOrder:true}).map(move=>[move.moveId??move,move]));
  return records.filter(record=>visible.has(record.move.moveId??record.move)).map(record=>({...record,move:visible.get(record.move.moveId??record.move)}));
};

/** Read-only display timeline. Live array order survives rebasing and Undo.
 * Additional archive pages are the evicted prefix, ordered by original commit
 * metadata. A partial prefix never proves adjacency to the bounded live tail.
 * Frozen/unbound records remain explicit rather than inventing a timestamp,
 * turn-coordinate or rebased-index ordering. */
export function buildHistoryTimeline(gameId,moves=[],entries=[],lastRestoration=null,{archiveComplete=false,extraMoves=[]}={}) {
  const seen=new Map(),live=[],archived=[],unknown=[];
  const add=(move,entry,source)=>{
    if(!move)return;
    const id=move.moveId??(source==='live'&&!move.undone?`local:${move.clientCommandId??live.length}`:null);
    if(!id)return;
    const previous=seen.get(id);
    if(previous){
      if(move.undoBoundaryStatus==='conflict' || (previous.move.undoEventSeq!==undefined && move.undoEventSeq!==undefined && previous.move.undoEventSeq!==move.undoEventSeq)) previous.conflict=true;
      return;
    }
    const record={id,move,entry,source,conflict:move.undoBoundaryStatus==='conflict',chronology:source==='live'?'recorded':sequence(entry)?'recorded':'unknown'};
    seen.set(id,record);
    if(source==='live')live.push(record);else if(sequence(entry))archived.push(record);else unknown.push(record);
  };
  for(const move of moves)add(move,null,'live');
  for(const entry of entries)if(entry?.move)add({...entry.move,moveId:entry.move.moveId??entry.id},entry,'archive');
  for(const move of extraMoves)add(move,null,'context');
  const positions=new Map();
  for(const record of archived){const key=sequence(record.entry).join(':');positions.set(key,(positions.get(key)??0)+1);}
  for(let index=archived.length-1;index>=0;index--){
    const record=archived[index];
    if(positions.get(sequence(record.entry).join(':'))>1){archived.splice(index,1);record.chronology='unknown';unknown.push(record);}
  }
  archived.sort((a,b)=>compare(sequence(a.entry),sequence(b.entry)));
  const joined=archiveComplete?fold([...archived,...live]):null;
  const local=joined?joined.filter(record=>record.source==='live'):fold(live);
  const older=joined?joined.filter(record=>record.source==='archive'):fold(archived);
  const unbound=unknown.flatMap(record=>fold([record]));
  const records=[...local].reverse();
  const ordered=[...records];
  if(older.length){
    if(local.length&&!archiveComplete)ordered.push({gap:true,key:`${gameId}:history-unloaded-gap`});
    ordered.push(...older.reverse());
  }
  if(unbound.length){ordered.push({gap:true,unknown:true,key:`${gameId}:history-unbound-gap`});ordered.push(...unbound.reverse());}
  const nodes=[];
  for(const record of ordered){
    if(record.gap){nodes.push({type:'gap',...record});continue;}
    const kind=boundaryKind(record),previous=nodes.at(-1),move=record.move;
    if(kind){
      const compatible=previous?.type==='undone' && previous.kind===kind && record.chronology==='recorded' && previous.chronology==='recorded'
        && (kind!=='pending' || previous.requestId===move.pendingUndoRequestId);
      if(compatible)previous.records.push(record);
      else nodes.push({type:'undone',key:`${gameId}:undo-run:${kind}:${record.id}`,kind,chronology:record.chronology,requestId:move.pendingUndoRequestId??null,records:[record]});
    }else if(previous?.type==='retained' && previous.turnIndex===move.turnIndex && record.chronology==='recorded' && previous.chronology==='recorded')previous.records.push(record);
    else nodes.push({type:'retained',key:`${gameId}:turn-portion:${record.id}`,turnIndex:move.turnIndex,chronology:record.chronology,records:[record]});
  }
  const groups=nodes.filter(node=>node.type==='undone');
  for(const group of groups){
    group.eventSeqs=group.kind==='accepted'?[...new Set(group.records.map(record=>record.move.undoEventSeq).filter(value=>Number.isSafeInteger(value)&&value>0))]:[];
    group.eventSeq=group.kind==='accepted'&&group.eventSeqs.length===1?group.eventSeqs[0]:null;
    group.anchorMoveId=group.records[0].move.moveId??null;
  }
  const eventSeq=lastRestoration?.undoEventSeq;
  if(Number.isSafeInteger(eventSeq)&&eventSeq>0&&typeof lastRestoration.decisionId==='string'&&!groups.some(group=>group.eventSeqs.includes(eventSeq))){
    const placeholder={type:'undone',key:`${gameId}:undo:accepted:${eventSeq}`,kind:'accepted',eventSeq,eventSeqs:[eventSeq],chronology:'unknown',records:[]};
    nodes.push(placeholder);groups.push(placeholder);
  }
  return {nodes,groups,liveMoves:local.map(record=>record.move),records:ordered.filter(record=>!record.gap)};
}
