import {buildHistoryTimeline} from './history-timeline.js';

/** Display runs are independent of the accepted Undo operations stored on moves. */
export function groupUndoHistory(gameId,moves=[],entries=[],lastRestoration=null,options={}) {
  return buildHistoryTimeline(gameId,moves,entries,lastRestoration,options).groups;
}

export const renderUndoHistoryGroups = (gameId, groups, row, expandedUndoneGroups, escapeHtml) => groups.map(group => {
  const expanded = expandedUndoneGroups.has(group.key);
  const count = group.records.length;
  const label = (group.kind === 'accepted' ? count ? `${count} move${count === 1 ? '' : 's'} undone` : 'Undo applied · Earlier history'
    : group.kind === 'pending' ? `${count} move${count === 1 ? '' : 's'} · Undo pending`
    : `${count} undone move${count === 1 ? '' : 's'} · Original Undo boundary unavailable`) + (count && group.chronology==='unknown' ? ' · Original move order unavailable' : '');
  return `<li class="history-item history-item-undone-group is-undone${expanded ? ' is-expanded' : ''}" data-key="${escapeHtml(group.key)}" data-undo-boundary="${group.kind}"${group.eventSeq == null ? '' : ` data-undo-event-seq="${group.eventSeq}"`}><button type="button" class="history-undone-toggle secondary" data-action="toggle-undone-group" data-group-key="${escapeHtml(group.key)}" aria-expanded="${expanded}"><span class="history-undone-label">${escapeHtml(label)}</span></button>${expanded ? `<ol class="history-list history-list-nested">${group.records.length ? group.records.map(record => row(record.move, record.entry)).join('') : '<li class="small" role="status">Earlier moves from this Undo are not in the loaded history.</li>'}</ol>` : ''}</li>`;
}).join('');


// This state belongs to one viewer's expansion Set, never to shared gameplay.
const disclosureOwners = new WeakMap();
const disclosureOwner = expanded => {
  if (!disclosureOwners.has(expanded)) disclosureOwners.set(expanded, {owner:null,identity:null,states:new Map(),explicit:new Map(),automatic:new Map(),groups:new Map(),choices:new Map(),generation:0,requiresExplicitSelection:false});
  return disclosureOwners.get(expanded);
};
const disclosureScope = (expanded, owner) => {
  if (!owner || typeof owner.getIdentityId !== 'function') throw Error('Undo disclosure owner required');
  const state = disclosureOwner(expanded), identity = owner.getIdentityId();
  if (state.owner !== null && (state.owner !== owner || state.identity !== identity)) {
    state.states.clear();state.explicit.clear();state.automatic.clear();state.groups.clear();state.choices.clear();expanded.clear();state.requiresExplicitSelection=true;
  }
  state.owner=owner;state.identity=identity;
  return state;
};
export function noteUndoHistorySelection(expanded, gameId, moveId, owner) {
  if (!gameId || !moveId) return;
  const state = disclosureScope(expanded, owner);
  state.explicit.set(gameId, {moveId,generation:++state.generation});
}
// Reconcile the display identity by immutable member overlap. The currently
// focused/pressed disclosure wins a merge so native input keeps its target.
const reconcileRuns=(expanded,gameId,groups,state)=>{
 const previous=state.groups.get(gameId)??[],open=new Set(expanded),automatic=new Map(state.automatic),choices=new Map(state.choices),used=new Set();
 const active=globalThis.document?.querySelector?.('.history-undone-toggle.is-pressing')?.dataset?.groupKey
   ?? globalThis.document?.activeElement?.dataset?.groupKey;
 for(const old of previous){expanded.delete(old.key);state.automatic.delete(old.key);state.choices.delete(old.key);}
 for(const group of groups){
  const ids=new Set(group.records.map(record=>record.move.moveId).filter(Boolean));
  const matches=previous.filter(old=>old.kind===group.kind&&(ids.size?[...ids].some(id=>old.ids.has(id)):old.key===group.key));
  const preferred=matches.find(old=>old.key===active)??matches[0];
  if(preferred&&!used.has(preferred.key))group.key=preferred.key;
  used.add(group.key);
  const choice=matches.map(old=>choices.get(old.key)).filter(Boolean).sort((a,b)=>b.generation-a.generation)[0];
  if(choice){state.choices.set(group.key,choice);if(choice.open)expanded.add(group.key);}
  else {
   if(matches.some(old=>open.has(old.key))||open.has(group.key))expanded.add(group.key);
   const events=new Set(matches.flatMap(old=>[...(automatic.get(old.key)??[])]));
   if(events.size)state.automatic.set(group.key,events);
  }
 }
 state.groups.set(gameId,groups.map(group=>({key:group.key,kind:group.kind,ids:new Set(group.records.map(record=>record.move.moveId).filter(Boolean)),eventSeqs:[...(group.eventSeqs??[])]})));
};
export function observeUndoHistoryDisclosure(expanded, game, groups, owner) {
  const state = disclosureScope(expanded, owner);
  reconcileRuns(expanded,game.id,groups,state);
  const previous=state.states.get(game.id);
  const selectedMoveId=game.inHistoryMode && game.historyTurnIndex == null
    ? game.inspectedDecision?.moveId ?? game.moves?.find(move=>move.index===game.historyIndex)?.moveId ?? null : null;
  const group=selectedMoveId ? groups.find(candidate=>candidate.records.some(record=>record.move.moveId===selectedMoveId)) : null;
  const explicit=state.explicit.get(game.id);
  const generation=explicit?.moveId===selectedMoveId ? explicit.generation : previous?.generation ?? 0;
  const key=group?.key ?? null;
  // Reveal a new selection, or its first undone membership, once. A remapped
  // display-run key is not a new selection and must preserve deliberate collapse.
  const permitted=!state.requiresExplicitSelection || explicit?.moveId===selectedMoveId;
  const reveal=Boolean(permitted && group && (!previous || previous.moveId!==selectedMoveId || previous.key===null || previous.generation!==generation));
  if(reveal){state.choices.delete(key);if(!expanded.has(key))state.automatic.set(key,new Set(group.eventSeqs??[]));expanded.add(key);}
  state.states.set(game.id,{moveId:selectedMoveId,key,generation});
  return reveal;
}

// A native disclosure choice supersedes ownership of an automatic reveal.
export function toggleUndoHistoryGroup(expanded,key,owner){
 const state=disclosureScope(expanded,owner);state.automatic.delete(key);
 const open=!expanded.has(key);if(open)expanded.add(key);else expanded.delete(key);
 state.choices.set(key,{open,generation:++state.generation});
}
// Called only after this viewer's existing Undo intent authorizes return-live.
export function finishUndoHistoryRequesterReturn(expanded,gameId,eventSeq,owner){
 if(!gameId||!Number.isSafeInteger(eventSeq)||eventSeq<=0)return false;
 const state=disclosureScope(expanded,owner);
 const group=(state.groups.get(gameId)??[]).find(group=>group.eventSeqs.includes(eventSeq)&&state.automatic.get(group.key)?.has(eventSeq));
 if(!group)return false;
 state.automatic.delete(group.key);expanded.delete(group.key);return true;
}
