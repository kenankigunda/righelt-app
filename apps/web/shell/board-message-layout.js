import {isCompletedGame} from './game-lifecycle.js';
import {renderBoardMessageHtml,renderBoardInlineAction} from '../board/message-presentation.js';
import {BOARD_TURN_CAPTIONS} from './perspective-labels.js';
import {computerActivityActorSide,setActivityActor} from './activity-affiliation.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
// Routine grammar alone establishes the floor; current narration and History
// content grow naturally instead of reserving every possible opponent summary.
const maximumPoint={row:9,col:9};
const routineMessages=[
 {text:'Select a piece or',action:{id:'pass',label:'Pass'}},
 {text:'Select a move for piece at (9, 9)',coordinates:[maximumPoint]},
 {text:'Select a rush or',action:{id:'end-turn',label:'End turn'}},
 {text:'Select a retreat'}, {text:'Select a follow'},
];
const renderMessageSizing=fallback=>routineMessages.map((message,index)=>`<p class="board-preview-label board-message-sizing${fallback?' board-message-fallback-sizing':''}" data-sizing-font="${fallback?'fallback':'primary'}" data-sizing-variant="routine:${index}" aria-hidden="true" inert>${renderBoardMessageHtml(message,{sizing:true})}</p>`).join('');

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
  const pending = Boolean(game?.computer && (!isCompletedGame(game) || game.pendingComputerSaveStartedAt != null) && !game.inHistoryMode && !replaying && !game.computer.paused
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
