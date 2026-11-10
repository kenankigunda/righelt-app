import {visibleRecordedMoves} from './recorded-narration.js';

/** Group only positively identified accepted restorations. Inputs stay chronological. */
export function groupUndoHistory(gameId, moves = [], entries = [], lastRestoration = null) {
  const seen = new Map(), groups = new Map();
  for (const record of [...moves.map(move => ({ move })), ...entries.map(entry => ({ move: { ...entry.move, moveId: entry.move?.moveId ?? entry.id }, entry }))]) {
    const move = record.move;
    if (!move?.moveId) continue;
    const prior = seen.get(move.moveId);
    if (prior) {
      if (prior.move.undoBoundaryStatus === 'conflict' || move.undoBoundaryStatus === 'conflict'
        || (prior.move.undoEventSeq !== move.undoEventSeq && prior.move.undoEventSeq !== undefined && move.undoEventSeq !== undefined)) prior.conflict = true;
      continue;
    }
    seen.set(move.moveId, {...record, conflict:move.undoBoundaryStatus === 'conflict'});
  }
  const visible = new Map(visibleRecordedMoves([...seen.values()].map(record => record.move), {includeUndone:true}).map(move => [move.moveId, move]));
  for (const sourceRecord of seen.values()) {
    const move = visible.get(sourceRecord.move.moveId);
    if (!move) continue;
    const record = {...sourceRecord, move};
    if (move.undone !== true || record.entry?.historyStatus === 'unknown') continue;
    const accepted = !record.conflict && move.undoBoundaryStatus !== 'conflict' && Number.isSafeInteger(move.undoEventSeq) && move.undoEventSeq > 0;
    const pending = !record.conflict && !accepted && typeof move.pendingUndoRequestId === 'string' && move.pendingUndoRequestId.length > 0;
    const kind = accepted ? 'accepted' : pending ? 'pending' : 'unavailable';
    const key = `${gameId}:undo:${kind}:${accepted ? move.undoEventSeq : pending ? move.pendingUndoRequestId : 'legacy'}`;
    if (!groups.has(key)) groups.set(key, { key, kind, eventSeq: accepted ? move.undoEventSeq : null, records: [] });
    groups.get(key).records.push(record);
  }
  const eventSeq = lastRestoration?.undoEventSeq;
  if (Number.isSafeInteger(eventSeq) && eventSeq > 0 && typeof lastRestoration.decisionId === 'string') {
    const key = `${gameId}:undo:accepted:${eventSeq}`;
    if (!groups.has(key)) groups.set(key, { key, kind: 'accepted', eventSeq, records: [] });
  }
  return [...groups.values()].sort((a, b) => (b.eventSeq ?? -1) - (a.eventSeq ?? -1)).map(group => ({
    ...group,
    // A display copy only. Stored decisions and replay ancestry are untouched.
    records: [...group.records].sort((a, b) => (b.move.turnIndex ?? 0) - (a.move.turnIndex ?? 0)
      || (b.move.turnMoveIndex ?? b.move.index ?? 0) - (a.move.turnMoveIndex ?? a.move.index ?? 0)),
  }));
}

export const renderUndoHistoryGroups = (gameId, groups, row, expandedUndoneGroups, escapeHtml) => groups.map(group => {
  const expanded = expandedUndoneGroups.has(group.key);
  const count = group.records.length;
  const label = group.kind === 'accepted' ? count ? `${count} move${count === 1 ? '' : 's'} undone` : 'Undo applied · Earlier history'
    : group.kind === 'pending' ? `${count} move${count === 1 ? '' : 's'} · Undo pending`
    : `${count} undone move${count === 1 ? '' : 's'} · Original Undo boundary unavailable`;
  return `<li class="history-item history-item-undone-group is-undone${expanded ? ' is-expanded' : ''}" data-key="${escapeHtml(group.key)}" data-undo-boundary="${group.kind}"${group.eventSeq == null ? '' : ` data-undo-event-seq="${group.eventSeq}"`}><button type="button" class="history-undone-toggle secondary" data-action="toggle-undone-group" data-group-key="${escapeHtml(group.key)}" aria-expanded="${expanded}">${escapeHtml(label)}</button>${expanded ? `<ol class="history-list history-list-nested">${group.records.length ? group.records.map(record => row(record.move, record.entry)).join('') : '<li class="small" role="status">Earlier moves from this Undo are not in the loaded history.</li>'}</ol>` : ''}</li>`;
}).join('');


// This state belongs to one viewer's expansion Set, never to shared gameplay.
const disclosureOwners = new WeakMap();
const disclosureOwner = expanded => {
  if (!disclosureOwners.has(expanded)) disclosureOwners.set(expanded, {owner:null,identity:null,states:new Map(),explicit:new Map(),generation:0,requiresExplicitSelection:false});
  return disclosureOwners.get(expanded);
};
const disclosureScope = (expanded, owner) => {
  if (!owner || typeof owner.getIdentityId !== 'function') throw Error('Undo disclosure owner required');
  const state = disclosureOwner(expanded), identity = owner.getIdentityId();
  if (state.owner !== null && (state.owner !== owner || state.identity !== identity)) {
    state.states.clear();state.explicit.clear();expanded.clear();state.requiresExplicitSelection=true;
  }
  state.owner=owner;state.identity=identity;
  return state;
};
export function noteUndoHistorySelection(expanded, gameId, moveId, owner) {
  if (!gameId || !moveId) return;
  const state = disclosureScope(expanded, owner);
  state.explicit.set(gameId, {moveId,generation:++state.generation});
}
export function observeUndoHistoryDisclosure(expanded, game, groups, owner) {
  const state = disclosureScope(expanded, owner);
  const previous=state.states.get(game.id);
  const selectedMoveId=game.inHistoryMode && game.historyTurnIndex == null
    ? game.inspectedDecision?.moveId ?? game.moves?.find(move=>move.index===game.historyIndex)?.moveId ?? null : null;
  const group=selectedMoveId ? groups.find(candidate=>candidate.records.some(record=>record.move.moveId===selectedMoveId)) : null;
  const explicit=state.explicit.get(game.id);
  const generation=explicit?.moveId===selectedMoveId ? explicit.generation : previous?.generation ?? 0;
  const key=group?.key ?? null;
  // Reveal a new selection/membership once. Re-rendering the same selection must
  // honor a later explicit native collapse, rather than continually reopening.
  const permitted=!state.requiresExplicitSelection || explicit?.moveId===selectedMoveId;
  const reveal=Boolean(permitted && group && (!previous || previous.moveId!==selectedMoveId || previous.key!==key || previous.generation!==generation));
  if(reveal)expanded.add(key);
  state.states.set(game.id,{moveId:selectedMoveId,key,generation});
  return reveal;
}
