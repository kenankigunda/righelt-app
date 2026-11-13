// Keep record formatting independent of live computer activity (which itself
// consumes this grammar). Accept only recorded side/seat forms.
const normalizeActivitySide = side => ['P1','p1','Player 1'].includes(side)?'P1':['P2','p2','Player 2'].includes(side)?'P2':null;

const point = value => value && Number.isInteger(value.row) && Number.isInteger(value.col);
const coordinate = value => `(${value.row}, ${value.col})`;
export const joinNarrationEvents = events => {
  const present=events.filter(Boolean);
  return present.length<2 ? present[0]??'' : present.length===2 ? present.join(' and ') : `${present.slice(0,-1).join(', ')}, and ${present.at(-1)}`;
};
const describeNarrationEvents = (name,events) => {
  const present=events.filter(Boolean);
  if(present.length<3)return `${name} ${joinNarrationEvents(present)}`;
  const sentences=[];
  for(let index=0;index<present.length;index+=2){
    const pair=present.slice(index,index+2);
    sentences.push(`${name}${index?' also':''} ${joinNarrationEvents(pair)}`);
  }
  return sentences.join('. ');
};
export const recordedMoveNumber = move => Number.isInteger(move?.displayMoveNumber) && move.displayMoveNumber>0
  ? move.displayMoveNumber : Number.isInteger(move?.index) && move.index>=0 ? move.index+1 : null;
export const recordedActorSide = move => normalizeActivitySide(move?.actorSide)
  ?? normalizeActivitySide(move?.selectionSnapshot?.pieces?.find(piece=>piece.id===move?.action?.actorId)?.owner);
const removalIdentity=(record,move)=>record.pieceId??record.piece?.id
  ?? move?.selectionSnapshot?.pieces?.find(piece=>normalizeActivitySide(piece.owner)===normalizeActivitySide(record.ownerSeat)&&piece.position?.row===record.position?.row&&piece.position?.col===record.position?.col)?.id
  ?? record.eventId ?? JSON.stringify([record.ownerSeat,record.position,record.kind,record.reason]);
const actionDestroyedPieces = move => Array.isArray(move?.recordedActionDestroyedPieces)
  ? move.recordedActionDestroyedPieces : Array.isArray(move?.destroyedPieces) ? move.destroyedPieces : [];
const recordedCapture = move => {
  const action=move?.action,actorSide=recordedActorSide(move);
  if(action?.type!=='push'||!point(action.to)||!actorSide)return null;
  const target=move?.selectionSnapshot?.pieces?.find(piece=>piece.position?.row===action.to.row&&piece.position?.col===action.to.col);
  const targetSide=normalizeActivitySide(target?.owner);
  if(!target?.id||!targetSide||targetSide===actorSide)return null;
  return actionDestroyedPieces(move).find(record=>
    record?.reason==='no_retreat'
    && record.pieceId===target.id
    && normalizeActivitySide(record.ownerSeat??record.piece?.owner)===targetSide
    && record.position?.row===action.to.row
    && record.position?.col===action.to.col
  )??null;
};
export const distinctRecordedRemovals = moves => {
  const records=new Map();
  for(const move of moves)for(const record of move.destroyedPieces??[]){
    const key=removalIdentity(record,move);
    if(!records.has(key))records.set(key,record);
  }
  return [...records.values()];
};

/** A read-only presentation lineage. Closure changes the last visible frame,
 * never creates a selectable History row or a synthetic narrated replay step. */
export const visibleRecordedMoves = (moves,{includeUndone=false,preserveInputOrder=false}={}) => {
  const result=[];
  const ordered=preserveInputOrder?[...(moves??[])]:[...(moves??[])].sort((left,right)=>Number.isInteger(left.index)&&Number.isInteger(right.index)?left.index-right.index:0);
  for(const move of ordered){
    if(!includeUndone&&move.undone)continue;
    if(move.action?.type!=='end_turn'){result.push(move);continue;}
    const previousIndex=result.findLastIndex(previous=>previous.turnIndex===move.turnIndex&&Boolean(previous.undone)===Boolean(move.undone)
      && (!move.undone || (previous.undoEventSeq===move.undoEventSeq && previous.pendingUndoRequestId===move.pendingUndoRequestId)));
    const previous=result[previousIndex];
    if(!previous)continue;
    // Partial archives can retain a closure while omitting its real predecessor.
    // Same turn/branch is insufficient evidence for attaching the final state.
    const boardAdjacent=Number.isInteger(previous.index)&&Number.isInteger(move.index)&&move.index===previous.index+1;
    const turnAdjacent=Number.isInteger(previous.turnMoveIndex)&&Number.isInteger(move.turnMoveIndex)&&move.turnMoveIndex===previous.turnMoveIndex+1;
    if(!boardAdjacent&&!turnAdjacent)continue;
    if(Number.isInteger(previous.index)&&Number.isInteger(move.index)&&!boardAdjacent)continue;
    if(Number.isInteger(previous.turnMoveIndex)&&Number.isInteger(move.turnMoveIndex)&&!turnAdjacent)continue;
    result[previousIndex]={...previous,snapshot:move.snapshot??previous.snapshot,
      // Keep direct-action provenance separate from closure removals. This is a
      // presentation lineage field, never an authoritative stored-game change.
      recordedActionDestroyedPieces:actionDestroyedPieces(previous),
      destroyedPieces:distinctRecordedRemovals([previous,move])};
  }
  return result;
};
/** Preserve an explicitly selected record while folding its known closure only. */
export const recordedMoveWithClosure=(move,context=[])=>{
  if(!move||move.action?.type==='end_turn')return move;
  const records=new Map();
  for(const record of [...context,move])if(record?.moveId)records.set(record.moveId,record);
  if(!move.moveId)return move;
  return visibleRecordedMoves([...records.values()],{includeUndone:true}).find(record=>record.moveId===move.moveId)??move;
};
const removalEvents=(moves,actorSide,captured=[])=>{
  const capturedRecords=new Set(captured.filter(Boolean));
  const removed=distinctRecordedRemovals(moves).filter(record=>!capturedRecords.has(record)),own=[],opposing=[];
  let unknown=false;
  for(const record of removed){
    const owner=normalizeActivitySide(record.ownerSeat??record.piece?.owner);
    if(!owner||!actorSide){unknown=true;continue;}
    (owner===actorSide?own:opposing).push(record);
  }
  const clause=(records,verb)=>!records.length?null:records.length===1
    ? point(records[0].position)?`${verb} piece at ${coordinate(records[0].position)}`:'Removal details unavailable'
    :`${verb} ${records.length} pieces`;
  return [clause(own,'lost'),clause(opposing,'destroyed'),unknown?'Removal details unavailable':null];
};
const actionEvent=(action,{owned=false}={})=>{
  if(action?.type==='pass')return 'passed';
  if(action?.type==='push')return point(action.to)?`pushed onto ${coordinate(action.to)}`:null;
  const verb={move:owned?'moved your commander':'moved commander',project:'projected new piece',rush:'rushed',retreat:'retreated',follow:'followed'}[action?.type];
  return verb&&point(action.from)&&point(action.to)?`${verb} from ${coordinate(action.from)} to ${coordinate(action.to)}`:null;
};
export function describeRecordedMove(move,name,options={}){
  const action=actionEvent(move?.action,options);
  if(!action)return null;
  const capture=recordedCapture(move);
  return describeNarrationEvents(name,[action,capture?`captured piece at ${coordinate(capture.position)}`:null,...removalEvents([move],recordedActorSide(move),[capture])]);
}
export function describeRecordedTurn(moves,name,options={}){
  const active=visibleRecordedMoves([...(moves??[])].sort((left,right)=>(left.turnMoveIndex??left.index)-(right.turnMoveIndex??right.index)));
  if(!active.length)return null;
  if(active.length===1)return describeRecordedMove(active[0],name,options);
  const owner=recordedActorSide(active.find(move=>move.action?.type!=='retreat'));
  const push=active.find(move=>move.action?.type==='push');
  const captures=active.map(recordedCapture).filter(Boolean);
  let events;
  if(push){
    if(!actionEvent(push.action))return null;
    const followers=new Set(active.filter(move=>move.action?.type==='follow'&&move.action.actorId&&move.action.actorId!==push.action.actorId).map(move=>move.action.actorId));
    const capture=recordedCapture(push);
    events=[actionEvent(push.action),capture?`captured piece at ${coordinate(capture.position)}`:null,followers.size?`had ${followers.size} ${followers.size===1?'piece':'pieces'} follow`:null];
  }else{
    const rushes=active.filter(move=>move.action?.type==='rush');
    const actors=new Set(rushes.map(move=>move.action.actorId).filter(Boolean));
    events=actors.size>1&&rushes.every(move=>point(move.action.to))
      ?[`rushed ${actors.size} pieces to ${joinNarrationEvents(rushes.map(move=>coordinate(move.action.to)))}`]
      :active.map(move=>actionEvent(move.action,options));
  }
  if(events.some(event=>event===null)&&!push)return null;
  return describeNarrationEvents(name,[...events,...removalEvents(active,owner,captures)]);
}
export const recordedNarrationCoordinates = moves => moves.flatMap(move=>[
  move.action?.from,move.action?.to,...(move.destroyedPieces??[]).map(record=>record.position),
]).filter(point);
