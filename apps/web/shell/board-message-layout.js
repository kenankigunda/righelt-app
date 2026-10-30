import {renderBoardMessageHtml,renderBoardInlineAction} from '../board/message-presentation.js';
import {BOARD_TURN_CAPTIONS} from './perspective-labels.js';
import {computerActivityActorSide,setActivityActor} from './activity-affiliation.js';
import { COMPUTER_PROFILES } from '../generated/packages/shared-types/src/computer-play.js';
import { describeComputerMove, describeMove } from './computer-narration.js';
import { SELECTED_PIECE_EXPLANATIONS,SELECTED_CONTINUATION_LABELS } from '../board/piece-explanations.js';
import {renderCoordinateChip} from '../board/coordinate-chip.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
// Measure the real formatter at the board's longest coordinate width. Keeping
// every supported verb/profile avoids guessing which proportional text is widest.
const narrationSizes = [
  ...['Your opponent','Red','Blue'].flatMap(name => ['move','project','rush','push','retreat','follow'].map(type => describeMove({action:{type,from:{row:9,col:9},to:{row:9,col:9}}},name))),
  ...Object.keys(COMPUTER_PROFILES).flatMap(profile =>
  ['move','project','rush','push','retreat','follow'].map(type => describeComputerMove({
    computerProof:{profile}, action:{type,from:{row:9,col:9},to:{row:9,col:9}},
  })),
)];
const maximumCoordinate=renderCoordinateChip({row:9,col:9});
const explanationSizes = SELECTED_PIECE_EXPLANATIONS.flatMap(text => {
  const base=`Piece at ${maximumCoordinate} – ${escape(text)}`;
  return [
    `${base} ${renderBoardInlineAction({id:"end-turn",label:"End Turn"},{sizing:true})}`,
    `${base} · ${SELECTED_CONTINUATION_LABELS.rushBlocker} ${maximumCoordinate}`,
    `${base} · ${SELECTED_CONTINUATION_LABELS.retreat}`,
    `${base} · ${SELECTED_CONTINUATION_LABELS.follow}`,
  ];
});

// Both font families use this one real formatter. The fallback remains present
// after Manrope loads, so a cold font swap cannot shrink the reserved message.
// This finite set is 96 paragraphs per family, with no actionable replicas.
const renderMessageSizing = fallback => {
  const fontClass=fallback?' board-message-fallback-sizing':'';
  const attrs=index=>`data-sizing-font="${fallback?'fallback':'primary'}" data-sizing-variant="${index}" aria-hidden="true" inert`;
  return narrationSizes.map((text,index) => `<p class="board-preview-label board-message-sizing${fontClass}" ${attrs(`narration:${index}`)}>${renderBoardMessageHtml({rows:[{text,coordinates:[{row:9,col:9}],action:{id:"replay-computer",label:"Show me again"}},{text:"Select a piece or",action:{id:"pass",label:"Pass"}}]},{sizing:true})}</p>`).join('')
    + explanationSizes.map((text,index) => `<p class="board-preview-label board-message-sizing board-explanation-sizing${fontClass}" ${attrs(`explanation:${index}`)}>${text}</p>`).join('');
};

export function renderBoardMessageSlot({id, loading = false, loadingKey} = {}) {
  return `<div class="board-message-slot"><div class="board-message-live"><p class="board-preview-label"${id ? ` id="${escape(id)}"` : ''}${loading ? ' aria-hidden="true"' : ''}>${loading ? '' : 'Select a piece'}</p><span class="board-message-activity" aria-hidden="true" data-loading-state="${loading && loadingKey ? 'pending' : 'idle'}" data-loading-context="external"${loading && loadingKey ? ` data-loading-key="${escape(loadingKey)}"` : ''}></span></div>${renderMessageSizing(false)}${renderMessageSizing(true)}</div>`;
}

export function renderBoardHeadingSlot({loading = false} = {}) {
  const caption = turn => `Board <span class="board-heading-separator">-</span> <span>${turn}</span>`;
  const sizing = fallback => BOARD_TURN_CAPTIONS.map((turn,index) => `<h2 class="board-heading board-heading-sizing${fallback ? ' board-heading-fallback-sizing' : ''}" data-heading-sizing-font="${fallback ? 'fallback' : 'primary'}" data-heading-sizing-caption="${index}" aria-hidden="true" inert role="presentation">${caption(turn)}</h2>`).join('');
  return `<div class="board-heading-slot"><h2 class="board-heading">${loading ? 'Board' : 'Board <span class="board-heading-separator">-</span> <span id="shell-board-turn-indicator">-</span>'}</h2>${sizing(false)}${sizing(true)}</div>`;
}

const activeMessages = new WeakMap();
let operation = 0;
// This host is a sibling of the runtime-owned prompt. Its cue therefore survives
// repeated prompt innerHTML writes and phase/proof-save updates without resets.
export function updateComputerBoardLoading(element, game, status = {}, {replaying = false, inspecting = false, scope = ''} = {}) {
  if (!element) return;
  element.dataset.loadingSuppressed = String(inspecting);
  const pending = Boolean(game?.computer && !game.inHistoryMode && !replaying && !game.computer.paused
    && !['recovery','other-device','paused'].includes(status.phase)
    && (game.computerTurn || game.pendingComputerSaveStartedAt != null));
  const owner = `${scope}:${game?.id}`;
  if (!pending) {
    activeMessages.delete(element);
    setActivityActor(element,null);
    if (element.dataset.loadingState !== 'idle') element.dataset.loadingState = 'idle';
    if (element.hasAttribute('data-loading-key')) element.removeAttribute('data-loading-key');
    return;
  }
  let active = activeMessages.get(element);
  if (active?.owner !== owner) {
    active = {owner,actorSide:null,key:`computer-board:${owner}:${++operation}`};
    activeMessages.set(element,active);
  }
  active.actorSide=computerActivityActorSide(game,status) ?? active.actorSide;
  setActivityActor(element,active.actorSide);
  if (element.dataset.loadingKey !== active.key) element.dataset.loadingKey = active.key;
  if (element.dataset.loadingState !== 'pending') element.dataset.loadingState = 'pending';
}
