import {activityActorSide,setActivityActor} from './activity-affiliation.js';
import { COMPUTER_PROFILES } from '../generated/packages/shared-types/src/computer-play.js';
import { describeComputerMove, describeMove } from './computer-narration.js';

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

export function renderBoardMessageSlot({id, loading = false} = {}) {
  return `<div class="board-message-slot"><div class="board-message-live"><p class="board-preview-label"${id ? ` id="${escape(id)}"` : ''}${loading ? ' aria-hidden="true"' : ''}>${loading ? '' : 'Select a piece'}</p><span class="board-message-activity" aria-hidden="true" data-loading-state="idle" data-loading-context="external"></span></div>${narrationSizes.map(text => `<p class="board-preview-label board-message-sizing" aria-hidden="true" inert>${escape(text)} <button type="button" class="board-preview-inline-button" disabled tabindex="-1">Pass</button> <button type="button" class="board-preview-inline-button" disabled tabindex="-1">Show me again</button></p>`).join('')}</div>`;
}

export function renderBoardHeadingSlot({loading = false} = {}) {
  const caption = turn => `Board <span class="board-heading-separator">-</span> <span>${turn}</span>`;
  return `<div class="board-heading-slot"><h2 class="board-heading">${loading ? 'Board' : 'Board <span class="board-heading-separator">-</span> <span id="shell-board-turn-indicator">-</span>'}</h2>${['Player 1 to play','Player 2 to play'].map(turn => `<h2 class="board-heading board-heading-sizing" aria-hidden="true" inert role="presentation">${caption(turn)}</h2>`).join('')}</div>`;
}

const activeMessages = new WeakMap();
let operation = 0;
// This host is a sibling of the runtime-owned prompt. Its cue therefore survives
// repeated prompt innerHTML writes and phase/proof-save updates without resets.
export function updateComputerBoardLoading(element, game, status = {}, {replaying = false, scope = ''} = {}) {
  if (!element) return;
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
  active.actorSide=activityActorSide(game,{thinking:true}) ?? active.actorSide;
  setActivityActor(element,active.actorSide);
  if (element.dataset.loadingKey !== active.key) element.dataset.loadingKey = active.key;
  if (element.dataset.loadingState !== 'pending') element.dataset.loadingState = 'pending';
}
