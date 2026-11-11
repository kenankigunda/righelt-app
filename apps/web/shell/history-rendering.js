// Shared production History rendering. Collaborators are read at render time so
// current account, transport and layout state retain their original ownership.
export function createHistoryRendering(getDependencies) {
const renderHistoryPreview = (game, preview, key) => {
  const {getShellLayoutMode, renderBoardMessageHtml, selectedHistoryPresentation, renderMiniBoardPreviewRoot, toStableKey, visibleRecordedMoves, recordedMoveNumber, isCompletedGame, transport, historyActorLabel, escapeHtml, icon, playerToneClassForSide, buildMovePreview, formatClientDateTime, historyTurnSide, COMPUTER_PROFILES, playerDisplayName, buildTurnPreview, playerToneClassForSeat, liveHistoryLabel, boardContextScope, boardContexts, canReplayDisplayed, contextReplayEnabled, undoHistory, expandedUndoneGroups, canReadAdditionalHistory, account, additionalHistory, deriveBoardView, recordedHistoryView} = getDependencies();
  return getShellLayoutMode() === "narrow"
  ? `<div class="history-inline-preview" data-testid="history-inline-preview"><p class="history-inline-narration">${renderBoardMessageHtml(selectedHistoryPresentation(game,{identityId:transport.getIdentityId()})?.message??{text:'Historical details unavailable'})}</p>${preview.snapshot ? renderMiniBoardPreviewRoot({previewId:key,...preview,previewKey:toStableKey(preview)}) : '<p role="status">Preview unavailable</p>'}</div>` : "";
};
const renderTurnHistory = (game) => {
  const {getShellLayoutMode, renderBoardMessageHtml, selectedHistoryPresentation, renderMiniBoardPreviewRoot, toStableKey, visibleRecordedMoves, recordedMoveNumber, isCompletedGame, transport, historyActorLabel, escapeHtml, icon, playerToneClassForSide, buildMovePreview, formatClientDateTime, historyTurnSide, COMPUTER_PROFILES, playerDisplayName, buildTurnPreview, playerToneClassForSeat, liveHistoryLabel, boardContextScope, boardContexts, canReplayDisplayed, contextReplayEnabled, undoHistory, expandedUndoneGroups, canReadAdditionalHistory, account, additionalHistory, deriveBoardView, recordedHistoryView} = getDependencies();
  const moves = visibleRecordedMoves([...(game.moves ?? []), ...(game.pendingMoves ?? [])],{includeUndone:true});
  if (!game.inHistoryMode && !moves.length && !game.turns?.length && !game.historyUndoArchiveEntries?.some(entry => entry.move?.undone === true) && !Number.isSafeInteger(game.lastRestoration?.undoEventSeq)) return '<li class="small">No turns yet.</li>';
  if (game.historyTurnIndex != null || game.historyContextMoves) {
    for (const frozen of game.historyTurnMoves ?? game.historyContextMoves ?? []) if (frozen.action?.type!=='end_turn' && !moves.some(move=>move.moveId===frozen.moveId)) moves.push(frozen);
  }
  const turns = new Map((game.turns ?? []).map(turn => [turn.index,{...turn,moves:[]}]));
  for (const move of moves) {
    if (!turns.has(move.turnIndex)) turns.set(move.turnIndex,{index:move.turnIndex,moves:[]});
    turns.get(move.turnIndex).moves.push(move);
  }
  // Finalization prepares the next active turn before discovering a terminal
  // outcome. It is not a recorded turn until a decision or closure exists.
  if (isCompletedGame(game)) {
    for (const [index,turn] of turns) {
      if (index === game.currentTurn?.index && !turn.moves.length && !turn.endedAt && !(turn.moveIndexes?.length)) turns.delete(index);
    }
  }
  const row = (move, archiveEntry) => {
    const previewGame = archiveEntry ? { ...game, historyContextMoves: [...(game.historyUndoArchiveEntries ?? []).map(entry => entry.move), ...(game.historyContextMoves ?? [])] } : game;
    const selected = game.inHistoryMode && (game.inspectedDecision?.moveId ? game.inspectedDecision.moveId === move.moveId : game.historyIndex === move.index);
    const pending = (game.pendingMoves ?? []).includes(move);
    const liveSelected = !game.inHistoryMode && move === moves.at(-1) && !game.currentSnapshot?.continuation && game.currentTurn?.moveIndexes?.length;
    const actor = historyActorLabel(game,move,{identityId:transport.getIdentityId()});
    const revertButton = selected && !move.undone && game.myRoles?.some(role=>role==='Player 1'||role==='Player 2')
      ? `<button class="secondary mini-button history-branch-button" data-action="revert-to-move" data-game-id="${escapeHtml(game.id)}" data-move-id="${escapeHtml(move.moveId || '')}">${icon('back')}Undo before this move</button>` : '';
    const branchButton = selected && !move.undone
      ? `<button class="secondary mini-button history-branch-button" data-action="launch-history-branch" data-game-id="${escapeHtml(game.id)}" data-move-index="${move.index}">${icon('play')}New game before this move</button>` : '';
    const actions = revertButton || branchButton ? `<div class="history-item-actions">${revertButton}${branchButton}</div>` : '';
    const destroyedPieces = Array.isArray(move.destroyedPieces) ? move.destroyedPieces : [];
    const destroyed = destroyedPieces.map((record)=>`<li class="history-destruction-item ${playerToneClassForSide(record.ownerSeat === "p1" ? "P1" : record.ownerSeat === "p2" ? "P2" : "neutral")}" data-testid="history-destruction-item"><span class="history-destruction-label">DESTROYED (${record.position.row},${record.position.col})</span></li>`).join('');
    return `<li class="history-item ${playerToneClassForSide(move.actorSide)}${selected?' is-selected':liveSelected?' is-live-selected':''}${move.undone?' is-undone':''}${pending?' history-item-pending':''}${actions?' history-item-has-actions':''}" data-key="${escapeHtml(archiveEntry ? `archive:${archiveEntry.id}` : move.moveId || move.clientCommandId || String(move.index))}" ${archiveEntry ? `data-archive-move-id="${escapeHtml(archiveEntry.id)}"` : `data-move-id="${escapeHtml(move.moveId || '')}"`} ${pending?'data-testid="history-pending-move-item"':'data-testid="history-move-item"'} aria-label="${escapeHtml(actor)} · ${move.undone ? `Turn ${move.turnIndex+1} · ` : ''}Move ${move.displayMoveNumber ?? move.index+1}: ${escapeHtml(move.notation)}" ${selected?'aria-current="true"':''} ${pending?'aria-busy="true"':''}>
      ${selected?'':`<button type="button" class="history-move-hit secondary" data-action="${archiveEntry ? 'inspect-history-archive' : 'jump-history'}" data-game-id="${escapeHtml(game.id)}" ${archiveEntry ? `data-decision-id="${escapeHtml(archiveEntry.id)}"` : `data-move-index="${move.index}"`} aria-label="${escapeHtml(actor)} · Move ${move.displayMoveNumber??move.index+1}: ${escapeHtml(move.notation)}"></button>`}
      <div class="history-item-info"><span class="history-move-line">${move.undone ? `Turn ${move.turnIndex+1} · ` : ''}Move ${move.displayMoveNumber ?? move.index+1}: ${escapeHtml(move.notation)}${pending?' · Pending':''}</span>${destroyedPieces.length > 0 ? `<ul class="history-destruction-list">${destroyed}</ul>` : ""}<span class="history-move-at small">${escapeHtml(formatClientDateTime(move.at))}</span></div>
      ${selected ? renderHistoryPreview(previewGame,buildMovePreview(selectedHistoryPresentation(previewGame,{identityId:transport.getIdentityId()})?.record ?? move,{context:'history'}),`history:${game.id}:${move.moveId}`) : ''}${actions}</li>`;
  };
  const groups = [...turns.values()].sort((a,b)=>b.index-a.index).map(turn=>{
    const ordered = turn.moves.sort((a,b)=>(a.turnMoveIndex ?? a.index)-(b.turnMoveIndex ?? b.index));
    const selected = game.inHistoryMode && game.historyTurnIndex === turn.index;
    if (!selected && ordered.length && ordered.every(move => move.undone === true)) return '';
    const first = ordered.find(move=>!move.undone) ?? ordered[0];
    const side = historyTurnSide(turn,ordered);
    const turnActor = ordered.find(move=>move.actorSide===side) ?? first;
    const name = historyActorLabel(game,{...turnActor,actorSide:side},{identityId:transport.getIdentityId()});
    const active = ordered.some(move=>!move.undone && !(game.pendingMoves??[]).includes(move));
    return `<li class="history-turn ${playerToneClassForSide(side)}" data-key="history-turn:${escapeHtml(game.id)}:${turn.index}" data-testid="history-turn" aria-label="Turn ${turn.index+1} · ${escapeHtml(name)}">${selected||!active?'':`<button type="button" class="history-turn-hit secondary" data-action="jump-history-turn" data-game-id="${escapeHtml(game.id)}" data-turn-index="${turn.index}" aria-label="Inspect Turn ${turn.index+1} · ${escapeHtml(name)}"></button>`}<div class="history-turn-heading${selected?' is-selected':''}" data-key="turn:${escapeHtml(game.id)}:${turn.index}" ${selected?'aria-current="true"':''}>Turn ${turn.index+1}</div>
      ${selected?renderHistoryPreview(game,buildTurnPreview(game.historyTurnMoves,{context:'history'}),`turn:${game.id}:${turn.index}`):''}
      <ol class="history-list history-list-nested">${ordered.filter(move=>!move.undone).reverse().map(move => row(move)).join('')}</ol></li>`;
  }).join('');
  const live = game.inHistoryMode ? `<li class="history-empty-line history-return-live"><button class="secondary" data-action="return-live" data-game-id="${escapeHtml(game.id)}" data-testid="history-return-live">${icon('board')}Return to live view</button></li>` : '';
  const state = game.currentSnapshot ?? game.board?.state;
  const current = !game.inHistoryMode && game.currentTurn;
  const waiting = current && (state?.continuation || !current.moveIndexes?.length) ? `<li class="history-item history-item-waiting ${playerToneClassForSeat(game.controlSeat ?? current.playerSeat)} is-live-selected" aria-disabled="true"><span class="history-move-line">${escapeHtml(liveHistoryLabel(game,state,{identityId:transport.getIdentityId()}))}</span></li>` : '';
  boardContextScope();
  const acknowledged=boardContexts.channel('acknowledged');
  const replayFallback=!game.inHistoryMode&&acknowledged?.gameId===game.id&&acknowledged.replay&&boardContexts.isDismissed(acknowledged.key)&&canReplayDisplayed(acknowledged.replay)
    ?`<li class="history-live-replay" data-key="live-replay:${escapeHtml(acknowledged.key)}"><button type="button" class="secondary" data-action="replay-board-context" data-board-context-key="${escapeHtml(acknowledged.key)}"${contextReplayEnabled(acknowledged.replay)?'':' disabled'}>Show me again</button></li>`:'';
  const undoGroups = undoHistory.groupUndoHistory(game.id, [...moves, ...(game.moves ?? []).filter(move => move.action?.type === 'end_turn')], game.historyUndoArchiveEntries ?? [], game.lastRestoration);
  undoHistory.observeUndoHistoryDisclosure(expandedUndoneGroups, game, undoGroups, transport);
  const undoneGroups = undoHistory.renderUndoHistoryGroups(game.id, undoGroups, row, expandedUndoneGroups, escapeHtml);
  return live + waiting + replayFallback + groups + undoneGroups;
};

const renderAdditionalHistory = game => {
  const {getShellLayoutMode, renderBoardMessageHtml, selectedHistoryPresentation, renderMiniBoardPreviewRoot, toStableKey, visibleRecordedMoves, recordedMoveNumber, isCompletedGame, transport, historyActorLabel, escapeHtml, icon, playerToneClassForSide, buildMovePreview, formatClientDateTime, historyTurnSide, COMPUTER_PROFILES, playerDisplayName, buildTurnPreview, playerToneClassForSeat, liveHistoryLabel, boardContextScope, boardContexts, canReplayDisplayed, contextReplayEnabled, undoHistory, expandedUndoneGroups, canReadAdditionalHistory, account, additionalHistory, deriveBoardView, recordedHistoryView} = getDependencies();
  if(!canReadAdditionalHistory(game,account.snapshot()))return '<div data-testid="additional-history"><ol class="history-list" aria-label="Additional game history"></ol></div>';
  const state=additionalHistory.snapshot(game.id);
  if(!state)return "";
  if(!state.metadata&&!state.loading&&!state.error)queueMicrotask(()=>void additionalHistory.ensure(game.id));
  const archiveTurns = new Map();
  const archiveRecords=state.items.map(entry=>({...entry.move,moveId:entry.move?.moveId??entry.id}));
  const archiveMoves=new Map(visibleRecordedMoves(archiveRecords,{includeUndone:true}).map(move=>[move.moveId,move]));
  const archiveItems = state.items.filter(entry=>archiveMoves.has(entry.id)&&!game.historyContextMoves?.some(move=>move.moveId===entry.id)).map(entry=>({...entry,move:archiveMoves.get(entry.id)}));
  const inspected = game.inspectedDecision;
  if (inspected && inspected.action?.type!=='end_turn' && !game.moves?.some(move=>move.moveId===inspected.moveId) && !archiveItems.some(entry=>entry.id===inspected.moveId)) archiveItems.unshift({id:inspected.moveId,move:inspected,at:inspected.at});
  for (const entry of archiveItems.filter(entry => entry.move.undone !== true)) {
    const index = entry.move.turnIndex;
    if (!archiveTurns.has(index)) archiveTurns.set(index,[]);
    archiveTurns.get(index).push(entry);
  }
  const archiveRow = entry => {
    const selected=Boolean(game.inHistoryMode&&game.inspectedDecision?.moveId===entry.id);
    const previewGame={...game,historyContextMoves:[...archiveRecords,...(game.historyContextMoves??[])]};
    const preview=selected?renderHistoryPreview(previewGame,buildMovePreview(selectedHistoryPresentation(previewGame,{identityId:transport.getIdentityId()})?.record ?? entry.move,{context:'history'}),`archive:${game.id}:${entry.id}`):'';
    return `<li class="history-item ${playerToneClassForSide(entry.move.actorSide)}${selected?' is-selected':''}${entry.move.undone?' is-undone':''}" data-key="archive:${escapeHtml(entry.id)}" data-archive-move-id="${escapeHtml(entry.id)}" aria-label="${escapeHtml(historyActorLabel(game,entry.move,{identityId:transport.getIdentityId()}))}">${selected?'':`<button type="button" class="history-move-hit secondary" data-action="inspect-history-archive" data-game-id="${escapeHtml(game.id)}" data-decision-id="${escapeHtml(entry.id)}" aria-label="${escapeHtml(historyActorLabel(game,entry.move,{identityId:transport.getIdentityId()}))} · ${recordedMoveNumber(entry.move)==null?'Move unavailable':`Move ${recordedMoveNumber(entry.move)}`} · ${escapeHtml(entry.move.notation)}"></button>`}<div class="history-item-info history-archive-select" aria-current="${selected?'true':'false'}"><span class="history-move-line">${entry.move.undone ? `Turn ${entry.move.turnIndex+1} · ` : ''}${recordedMoveNumber(entry.move)==null?'Move unavailable':`Move ${recordedMoveNumber(entry.move)}:`} ${escapeHtml(entry.move.notation)}${entry.move.undone?' · Undone':entry.historyStatus==='unknown'?' · Status unavailable':''}</span><span class="history-move-at small">${escapeHtml(formatClientDateTime(entry.at))}</span></div>${preview}</li>`;
  };
  const rows=[...archiveTurns.entries()].sort(([a],[b])=>b-a).map(([index,entries])=>{
    entries.sort((a,b)=>(a.move.turnMoveIndex ?? a.move.index)-(b.move.turnMoveIndex ?? b.move.index));
    const first=entries[0].move;
    const side=historyTurnSide({index},entries.map(entry=>entry.move));
    const turnActor=entries.find(entry=>entry.move.actorSide===side)?.move ?? first;
    const selectedTurn=game.inHistoryMode && game.historyTurnIndex===index;
    const selectableTurn=entries.some(entry=>entry.move.undone!==true && entry.historyStatus!=="unknown");
    const turnName=COMPUTER_PROFILES[turnActor.computerProof?.profile]?.name??playerDisplayName(game,side);
    const turnHit=selectedTurn||!selectableTurn?'':`<button type="button" class="history-turn-hit secondary" data-action="jump-history-turn" data-game-id="${escapeHtml(game.id)}" data-turn-index="${index}" aria-label="Inspect Turn ${index+1} · ${escapeHtml(turnName)}"></button>`;
    const heading=`<div class="history-turn-heading${selectedTurn?' is-selected':''}" data-key="archive-turn:${escapeHtml(game.id)}:${index}" ${selectedTurn?'aria-current="true"':''}>Turn ${index+1}</div>`;
    const contents=[...entries].reverse().map(archiveRow).join('');
    return `<li class="history-turn ${playerToneClassForSide(side)}" data-key="archive-history-turn:${escapeHtml(game.id)}:${index}" aria-label="Turn ${index+1} · ${escapeHtml(turnName)}">${turnHit}${heading}${selectedTurn?renderHistoryPreview(game,buildTurnPreview(game.historyTurnMoves,{context:'history'}),`archive-turn:${game.id}:${index}`):''}<ol class="history-list history-list-nested">${contents}</ol></li>`;
  }).join('');
  const action=state.error?`<p role="status">We couldn’t load more history</p><button class="secondary" data-action="retry-history-archive" data-game-id="${escapeHtml(game.id)}">${icon('rematch')}Retry</button>`
    : state.available&&(!state.loaded||state.cursor)?`<button class="secondary" data-action="load-history-archive" data-game-id="${escapeHtml(game.id)}" ${state.loading?'disabled aria-busy="true"':''}>${icon('history')}${state.loaded?'Load more history':'More game history'}</button>`:"";
  const undoGroups = undoHistory.groupUndoHistory(game.id, [], archiveItems);
  if (!Array.isArray(game.historyUndoArchiveEntries)) undoHistory.observeUndoHistoryDisclosure(expandedUndoneGroups, game, undoGroups, transport);
  const undoneGroups = Array.isArray(game.historyUndoArchiveEntries) ? ''
    : undoHistory.renderUndoHistoryGroups(game.id, undoGroups, (move, entry) => archiveRow({...entry,move}), expandedUndoneGroups, escapeHtml);
  return `<div data-testid="additional-history"><ol class="history-list" aria-label="Additional game history">${rows}${undoneGroups}</ol>${action}${state.loaded&&state.partial?'<p class="small">Some earlier history is unavailable</p>':''}</div>`;
};

const getBoardGame = game => {
  const {getShellLayoutMode, renderBoardMessageHtml, selectedHistoryPresentation, renderMiniBoardPreviewRoot, toStableKey, visibleRecordedMoves, recordedMoveNumber, isCompletedGame, transport, historyActorLabel, escapeHtml, icon, playerToneClassForSide, buildMovePreview, formatClientDateTime, historyTurnSide, COMPUTER_PROFILES, playerDisplayName, buildTurnPreview, playerToneClassForSeat, liveHistoryLabel, boardContextScope, boardContexts, canReplayDisplayed, contextReplayEnabled, undoHistory, expandedUndoneGroups, canReadAdditionalHistory, account, additionalHistory, deriveBoardView, recordedHistoryView} = getDependencies();
  const viewed=deriveBoardView(game,{narrow:getShellLayoutMode()==="narrow",identityId:transport.getIdentityId()});
  if(!viewed?.inHistoryMode)return viewed;
  const archived=additionalHistory.snapshot(viewed.id)?.items?.map(entry=>({...entry.move,moveId:entry.move?.moveId??entry.id}))??[];
  return recordedHistoryView({...viewed,historyContextMoves:[...archived,...(viewed.historyContextMoves??[])]});
};
return {renderHistoryPreview,renderTurnHistory,renderAdditionalHistory,getBoardGame};
}
