import {buildHistoryTimeline} from './history-timeline.js';

// Shared production History rendering. Collaborators are read at render time so
// current account, transport and layout state retain their original ownership.
export function createHistoryRendering(getDependencies) {
const renderHistoryPreview = (game, preview, key) => {
  const {getShellLayoutMode, renderBoardMessageHtml, selectedHistoryPresentation, renderMiniBoardPreviewRoot, toStableKey, visibleRecordedMoves, recordedMoveNumber, isCompletedGame, transport, historyActorLabel, escapeHtml, icon, playerToneClassForSide, buildMovePreview, formatClientDateTime, historyTurnSide, COMPUTER_PROFILES, playerDisplayName, buildTurnPreview, playerToneClassForSeat, liveHistoryLabel, boardContextScope, boardContexts, canReplayDisplayed, contextReplayEnabled, undoHistory, expandedUndoneGroups, canReadAdditionalHistory, account, additionalHistory, deriveBoardView, recordedHistoryView} = getDependencies();
  return getShellLayoutMode() === "narrow"
  ? `<div class="history-inline-preview" data-testid="history-inline-preview"><p class="history-inline-narration">${renderBoardMessageHtml(selectedHistoryPresentation(game,{identityId:transport.getIdentityId()})?.message??{text:'Historical details unavailable'})}</p>${preview.snapshot ? renderMiniBoardPreviewRoot({previewId:key,...preview,previewKey:toStableKey(preview)}) : '<p role="status">Preview unavailable</p>'}</div>` : "";
};
const renderTurnHistory = (game) => {
  const {renderIncomingHistory, getShellLayoutMode, renderBoardMessageHtml, selectedHistoryPresentation, renderMiniBoardPreviewRoot, toStableKey, visibleRecordedMoves, recordedMoveNumber, isCompletedGame, transport, historyActorLabel, escapeHtml, icon, playerToneClassForSide, buildMovePreview, formatClientDateTime, historyTurnSide, COMPUTER_PROFILES, playerDisplayName, buildTurnPreview, playerToneClassForSeat, liveHistoryLabel, boardContextScope, boardContexts, canReplayDisplayed, contextReplayEnabled, undoHistory, expandedUndoneGroups, expandedImportedHistory, canReadAdditionalHistory, account, additionalHistory, deriveBoardView, recordedHistoryView} = getDependencies();
  const archiveState=additionalHistory?.snapshot?.(game.id);
  const timeline=buildHistoryTimeline(game.id,[...(game.moves??[]),...(game.pendingMoves??[])],game.historyUndoArchiveEntries??[],game.lastRestoration,{
    archiveComplete:Boolean(archiveState?.loaded&&!archiveState.cursor),
    extraMoves:game.historyTurnIndex!=null||game.historyContextMoves?game.historyTurnMoves??game.historyContextMoves??[]:[],
  });
  const moves=timeline.liveMoves;
  if (!game.inHistoryMode && !timeline.records.length && !game.turns?.length && !game.historyUndoArchiveEntries?.some(entry => entry.move?.undone === true) && !Number.isSafeInteger(game.lastRestoration?.undoEventSeq)) return '<li class="small">No turns yet.</li>';
  const turns = new Map((game.turns ?? []).map(turn => [turn.index,{...turn,moves:[]}]));
  for (const {move} of timeline.records) {
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
    // Unifying the display does not grant actions that archive rows did not own.
    const actionable=selected&&!move.undone&&(!archiveEntry||Boolean(move.importedFrom));
    const number=recordedMoveNumber(move),moveLabel=number==null?'Move unavailable':`Move ${number}:`;
    const availability=archiveEntry?.historyStatus==='unknown'?' · Status unavailable':'';
    const revertButton = actionable && !move.importedFrom && game.myRoles?.some(role=>role==='Player 1'||role==='Player 2')
      ? `<button class="secondary mini-button history-branch-button" data-action="revert-to-move" data-game-id="${escapeHtml(game.id)}" data-move-id="${escapeHtml(move.moveId || '')}">${icon('back')}Undo before this move</button>` : '';
    const branchButton = actionable
      ? `<button class="secondary mini-button history-branch-button" data-action="launch-history-branch" data-game-id="${escapeHtml(game.id)}" data-move-index="${move.index}"${archiveEntry?` data-decision-id="${escapeHtml(archiveEntry.id)}"`:''}>${icon('play')}New game before this move</button>` : '';
    const actions = revertButton || branchButton ? `<div class="history-item-actions">${revertButton}${branchButton}</div>` : '';
    const destroyedPieces = Array.isArray(move.destroyedPieces) ? move.destroyedPieces : [];
    const destroyed = destroyedPieces.map((record)=>`<li class="history-destruction-item ${playerToneClassForSide(record.ownerSeat === "p1" ? "P1" : record.ownerSeat === "p2" ? "P2" : "neutral")}" data-testid="history-destruction-item"><span class="history-destruction-label">DESTROYED (${record.position.row},${record.position.col})</span></li>`).join('');
    return `<li class="history-item ${playerToneClassForSide(move.actorSide)}${selected?' is-selected':liveSelected?' is-live-selected':''}${move.undone?' is-undone':''}${pending?' history-item-pending':''}${actions?' history-item-has-actions':''}" data-key="${escapeHtml(archiveEntry ? `archive:${archiveEntry.id}` : move.moveId || move.clientCommandId || String(move.index))}" ${archiveEntry ? `data-archive-move-id="${escapeHtml(archiveEntry.id)}"` : `data-move-id="${escapeHtml(move.moveId || '')}"`} ${pending?'data-testid="history-pending-move-item"':'data-testid="history-move-item"'} aria-label="${escapeHtml(actor)} · ${move.undone ? `Turn ${move.turnIndex+1} · ` : ''}${moveLabel} ${escapeHtml(move.notation)}${availability}" ${selected?'aria-current="true"':''} ${pending?'aria-busy="true"':''}>
      ${selected?'':`<button type="button" class="history-move-hit secondary" data-action="${archiveEntry ? 'inspect-history-archive' : 'jump-history'}" data-game-id="${escapeHtml(game.id)}" ${archiveEntry ? `data-decision-id="${escapeHtml(archiveEntry.id)}"` : `data-move-index="${move.index}"`} aria-label="${escapeHtml(actor)} · ${moveLabel} ${escapeHtml(move.notation)}${availability}"></button>`}
      <div class="history-item-info"><span class="history-move-line">${move.undone ? `Turn ${move.turnIndex+1} · ` : ''}${moveLabel} ${escapeHtml(move.notation)}${availability}${pending?' · Pending':''}</span>${destroyedPieces.length > 0 ? `<ul class="history-destruction-list">${destroyed}</ul>` : ""}<span class="history-move-at small">${escapeHtml(formatClientDateTime(move.at))}</span></div>
      ${selected ? renderHistoryPreview(previewGame,buildMovePreview(selectedHistoryPresentation(previewGame,{identityId:transport.getIdentityId()})?.record ?? move,{context:'history'}),`history:${game.id}:${move.moveId}`) : ''}${actions}</li>`;
  };
  const selectableTurns=new Set(),selectedTurns=new Set();
  const renderTurn=(turn,records,key)=>{
    const ordered=[...records].reverse().map(record=>record.move);
    const selected=game.inHistoryMode&&game.historyTurnIndex===turn.index&&!selectedTurns.has(turn.index);
    if(selected)selectedTurns.add(turn.index);
    const first=ordered[0];
    const side=historyTurnSide(turn,ordered);
    const turnActor=ordered.find(move=>move.actorSide===side)??first;
    const name=historyActorLabel(game,{...turnActor,actorSide:side},{identityId:transport.getIdentityId()});
    const active=records.some(record=>record.entry?.historyStatus!=='unknown'&&!(game.pendingMoves??[]).includes(record.move));
    const selectable=!selected&&active&&!selectableTurns.has(turn.index);
    if(active)selectableTurns.add(turn.index);
    return `<li class="history-turn ${playerToneClassForSide(side)}" data-key="${escapeHtml(key)}" data-testid="history-turn" aria-label="Turn ${turn.index+1} · ${escapeHtml(name)}">${selectable?`<button type="button" class="history-turn-hit secondary" data-action="jump-history-turn" data-game-id="${escapeHtml(game.id)}" data-turn-index="${turn.index}" aria-label="Inspect Turn ${turn.index+1} · ${escapeHtml(name)}"></button>`:''}<div class="history-turn-heading${selected?' is-selected':''}" data-key="turn:${escapeHtml(game.id)}:${turn.index}:${escapeHtml(key)}" ${selected?'aria-current="true"':''}>Turn ${turn.index+1}</div>
      ${selected?renderHistoryPreview(game,buildTurnPreview(game.historyTurnMoves,{context:'history'}),`turn:${game.id}:${turn.index}`):''}
      <ol class="history-list history-list-nested">${records.map(record=>row(record.move,record.entry)).join('')}</ol></li>`;
  };
  const undoGroups=timeline.groups;
  undoHistory.observeUndoHistoryDisclosure(expandedUndoneGroups,game,undoGroups,transport);
  const splitNodes=imported=>timeline.nodes.flatMap(node=>{
    if(node.type!=='retained')return imported?[]:[node];
    const records=node.records.filter(record=>Boolean(record.move.importedFrom)===imported);
    return records.length?[{...node,records}]:[];
  });
  const renderNodes=(nodes,prefix='history-turn')=>{
    const portions=new Set();
    return nodes.map(node=>{
    if(node.type==='gap')return `<li class="small history-order-gap" role="status" data-key="${escapeHtml(node.key)}">${node.unknown?'Original move order unavailable for some loaded records.':'Earlier pages are not loaded between these moves.'}</li>`;
    if(node.type==='undone')return undoHistory.renderUndoHistoryGroups(game.id,[node],row,expandedUndoneGroups,escapeHtml);
    const canonical=!portions.has(node.turnIndex);portions.add(node.turnIndex);
    const key=canonical?`${prefix}:${game.id}:${node.turnIndex}`:`${prefix}:${game.id}:${node.turnIndex}:portion:${node.records[0].id}`;
    return renderTurn(turns.get(node.turnIndex)??{index:node.turnIndex},node.records,key);
    }).join('');
  };
  const groups=renderNodes(splitNodes(false));
  const importedNodes=splitNodes(true);
  const importedSegments=[];
  for(const node of importedNodes){
    const recordRuns=[];
    for(const record of node.records){
      const origin=record.move.importedFrom;
      const key=`${origin.gameId}\u0000${origin.gameplayRevision}`;
      const run=recordRuns.at(-1);
      if(run?.key===key)run.records.push(record);
      else recordRuns.push({key,origin,records:[record]});
    }
    for(const run of recordRuns){
      const segment=importedSegments.at(-1);
      const portion={...node,records:run.records};
      if(segment?.key===run.key)segment.nodes.push(portion);
      else importedSegments.push({key:run.key,origin:run.origin,nodes:[portion]});
    }
  }
  const importedCount=Number.isSafeInteger(game.importedHistory?.moveCount)?game.importedHistory.moveCount:timeline.records.filter(record=>record.move.importedFrom).length;
  const selectedImported=Boolean(game.inHistoryMode&&(game.inspectedDecision?.importedFrom
    || timeline.records.some(record=>record.move.importedFrom&&(game.inspectedDecision?.moveId===record.move.moveId||game.historyIndex===record.move.index))));
  const importedExpanded=Boolean(expandedImportedHistory?.has(game.id)||selectedImported);
  const importedSources=importedSegments.map((segment,index)=>`<section class="history-imported-source-segment"><a class="history-imported-source" href="#/game/${encodeURIComponent(segment.origin.gameId)}" aria-label="Open source game for imported history segment ${index+1}">Open source game</a><ol class="history-list history-list-imported">${renderNodes(segment.nodes,`imported-history-turn:${index}`)}</ol></section>`).join('');
  const importedStatus=game.importedHistory?.complete===false?'<span class="small history-imported-status">Imported history is incomplete.</span>':'';
  const imported=importedCount>0?`<li class="history-item history-item-imported-group${importedExpanded?' is-expanded':''}" data-testid="history-imported-group"><button type="button" class="history-imported-toggle secondary" data-action="toggle-imported-history" data-game-id="${escapeHtml(game.id)}" aria-expanded="${importedExpanded}">Imported from previous game · ${importedCount} ${importedCount===1?'move':'moves'}</button>${importedStatus}${importedExpanded?`<div class="history-imported-content">${importedSources}</div>`:''}</li>`:'';
  const emptyTurns=[...turns.values()].filter(turn=>(!timeline.records.some(record=>record.move.turnIndex===turn.index)
    || game.historyTurnIndex===turn.index&&!timeline.nodes.some(node=>node.type==='retained'&&node.turnIndex===turn.index))
    && (turn.index!==game.currentTurn?.index||Boolean(turn.endedAt)||Boolean(turn.moveIndexes?.length)));
  const emptyRow=turn=>renderTurn(turn,[],`history-turn:${game.id}:${turn.index}`);
  const leadingEmpty=emptyTurns.filter(turn=>turn.index===game.currentTurn?.index).map(emptyRow).join('');
  const trailingEmpty=emptyTurns.filter(turn=>turn.index!==game.currentTurn?.index).reverse().map(emptyRow).join('');
  const live = game.inHistoryMode && !isCompletedGame(game) ? `<li class="history-empty-line history-return-live"><button class="secondary" data-action="return-live" data-game-id="${escapeHtml(game.id)}" data-testid="history-return-live">${icon('board')}Return to live view</button></li>` : '';
  const state = game.currentSnapshot ?? game.board?.state;
  const current = !game.inHistoryMode && game.currentTurn;
  const waiting = current && (state?.continuation || !current.moveIndexes?.length) ? `<li class="history-item history-item-waiting ${playerToneClassForSeat(game.controlSeat ?? current.playerSeat)} is-live-selected" aria-disabled="true"><span class="history-move-line">${escapeHtml(liveHistoryLabel(game,state,{identityId:transport.getIdentityId()}))}</span></li>` : '';
  boardContextScope();
  const acknowledged=boardContexts.channel('acknowledged');
  const replayFallback=!game.inHistoryMode&&acknowledged?.gameId===game.id&&acknowledged.replay&&boardContexts.isDismissed(acknowledged.key)&&canReplayDisplayed(acknowledged.replay)
    ?`<li class="history-live-replay" data-key="live-replay:${escapeHtml(acknowledged.key)}"><button type="button" class="secondary" data-action="replay-board-context" data-board-context-key="${escapeHtml(acknowledged.key)}"${contextReplayEnabled(acknowledged.replay)?'':' disabled'}>Show me again</button></li>`:'';
  const incoming=getShellLayoutMode()==='wide'?renderIncomingHistory?.(game)??'':'';
  return live + (incoming?`<li class="history-incoming-container">${incoming}</li>`:'') + waiting + replayFallback + leadingEmpty + groups + trailingEmpty + imported;
};

const renderAdditionalHistory = game => {
  const {getShellLayoutMode, renderBoardMessageHtml, selectedHistoryPresentation, renderMiniBoardPreviewRoot, toStableKey, visibleRecordedMoves, recordedMoveNumber, isCompletedGame, transport, historyActorLabel, escapeHtml, icon, playerToneClassForSide, buildMovePreview, formatClientDateTime, historyTurnSide, COMPUTER_PROFILES, playerDisplayName, buildTurnPreview, playerToneClassForSeat, liveHistoryLabel, boardContextScope, boardContexts, canReplayDisplayed, contextReplayEnabled, undoHistory, expandedUndoneGroups, canReadAdditionalHistory, account, additionalHistory, deriveBoardView, recordedHistoryView} = getDependencies();
  if(!canReadAdditionalHistory(game,account.snapshot()))return '<div data-testid="additional-history"><ol class="history-list" aria-label="Additional game history"></ol></div>';
  const state=additionalHistory.snapshot(game.id);
  if(!state)return "";
  if(!state.metadata&&!state.loading&&!state.error)queueMicrotask(()=>void additionalHistory.ensure(game.id));
  const archiveRecords=state.items.map(entry=>({...entry.move,moveId:entry.move?.moveId??entry.id}));
  const archiveItems=state.items.filter(entry=>entry.move&&!game.historyContextMoves?.some(move=>move.moveId===entry.id));
  const inspected = game.inspectedDecision;
  if (inspected && inspected.action?.type!=='end_turn' && !game.moves?.some(move=>move.moveId===inspected.moveId) && !archiveItems.some(entry=>entry.id===inspected.moveId)) archiveItems.unshift({id:inspected.moveId,move:inspected,at:inspected.at});
  const archiveRow = entry => {
    const selected=Boolean(game.inHistoryMode&&game.inspectedDecision?.moveId===entry.id);
    const previewGame={...game,historyContextMoves:[...archiveRecords,...(game.historyContextMoves??[])]};
    const preview=selected?renderHistoryPreview(previewGame,buildMovePreview(selectedHistoryPresentation(previewGame,{identityId:transport.getIdentityId()})?.record ?? entry.move,{context:'history'}),`archive:${game.id}:${entry.id}`):'';
    return `<li class="history-item ${playerToneClassForSide(entry.move.actorSide)}${selected?' is-selected':''}${entry.move.undone?' is-undone':''}" data-key="archive:${escapeHtml(entry.id)}" data-archive-move-id="${escapeHtml(entry.id)}" aria-label="${escapeHtml(historyActorLabel(game,entry.move,{identityId:transport.getIdentityId()}))}">${selected?'':`<button type="button" class="history-move-hit secondary" data-action="inspect-history-archive" data-game-id="${escapeHtml(game.id)}" data-decision-id="${escapeHtml(entry.id)}" aria-label="${escapeHtml(historyActorLabel(game,entry.move,{identityId:transport.getIdentityId()}))} · ${recordedMoveNumber(entry.move)==null?'Move unavailable':`Move ${recordedMoveNumber(entry.move)}`} · ${escapeHtml(entry.move.notation)}"></button>`}<div class="history-item-info history-archive-select" aria-current="${selected?'true':'false'}"><span class="history-move-line">${entry.move.undone ? `Turn ${entry.move.turnIndex+1} · ` : ''}${recordedMoveNumber(entry.move)==null?'Move unavailable':`Move ${recordedMoveNumber(entry.move)}:`} ${escapeHtml(entry.move.notation)}${entry.move.undone?' · Undone':entry.historyStatus==='unknown'?' · Status unavailable':''}</span><span class="history-move-at small">${escapeHtml(formatClientDateTime(entry.at))}</span></div>${preview}</li>`;
  };
  let rows='';
  if(!Array.isArray(game.historyUndoArchiveEntries)){
    const timeline=buildHistoryTimeline(game.id,[],archiveItems,null,{archiveComplete:!state.cursor});
    undoHistory.observeUndoHistoryDisclosure(expandedUndoneGroups,game,timeline.groups,transport);
    const selectableTurns=new Set(),selectedTurns=new Set(),portions=new Set();
    rows=timeline.nodes.map(node=>{
      if(node.type==='gap')return `<li class="small history-order-gap" role="status" data-key="${escapeHtml(node.key)}">Original move order unavailable for some loaded records.</li>`;
      if(node.type==='undone')return undoHistory.renderUndoHistoryGroups(game.id,[node],(move,entry)=>archiveRow({...entry,move}),expandedUndoneGroups,escapeHtml);
      const index=node.turnIndex,entries=node.records.map(record=>({...record.entry,move:record.move}));
      const chronological=[...entries].reverse(),first=chronological[0].move;
      const side=historyTurnSide({index},chronological.map(entry=>entry.move));
      const turnActor=chronological.find(entry=>entry.move.actorSide===side)?.move??first;
      const selectedTurn=game.inHistoryMode&&game.historyTurnIndex===index&&!selectedTurns.has(index);
      if(selectedTurn)selectedTurns.add(index);
      const selectableTurn=!selectableTurns.has(index)&&entries.some(entry=>entry.historyStatus!=='unknown');
      selectableTurns.add(index);
      const turnName=historyActorLabel(game,{...turnActor,actorSide:side},{identityId:transport.getIdentityId()});
      const turnHit=selectedTurn||!selectableTurn?'':`<button type="button" class="history-turn-hit secondary" data-action="jump-history-turn" data-game-id="${escapeHtml(game.id)}" data-turn-index="${index}" aria-label="Inspect Turn ${index+1} · ${escapeHtml(turnName)}"></button>`;
      const canonical=!portions.has(index);portions.add(index);
      const key=canonical?`archive-history-turn:${game.id}:${index}`:`archive-history-turn:${game.id}:${index}:portion:${node.records[0].id}`;
      const heading=`<div class="history-turn-heading${selectedTurn?' is-selected':''}" data-key="${escapeHtml(key)}:heading" ${selectedTurn?'aria-current="true"':''}>Turn ${index+1}</div>`;
      return `<li class="history-turn ${playerToneClassForSide(side)}" data-key="${escapeHtml(key)}" aria-label="Turn ${index+1} · ${escapeHtml(turnName)}">${turnHit}${heading}${selectedTurn?renderHistoryPreview(game,buildTurnPreview(game.historyTurnMoves,{context:'history'}),`archive-turn:${game.id}:${index}`):''}<ol class="history-list history-list-nested">${entries.map(archiveRow).join('')}</ol></li>`;
    }).join('');
  }
  const action=state.error?`<p role="status">We couldn’t load more history</p><button class="secondary" data-action="retry-history-archive" data-game-id="${escapeHtml(game.id)}">${icon('rematch')}Retry</button>`
    : state.available&&(!state.loaded||state.cursor)?`<button class="secondary" data-action="load-history-archive" data-game-id="${escapeHtml(game.id)}" ${state.loading?'disabled aria-busy="true"':''}>${icon('history')}${state.loaded?'Load more history':'More game history'}</button>`:"";
  return `<div data-testid="additional-history"><ol class="history-list" aria-label="Additional game history">${rows}</ol>${action}${state.loaded&&state.partial?'<p class="small">Some earlier history is unavailable</p>':''}</div>`;
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
