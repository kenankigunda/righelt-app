import {renderBoardMessageHtml,renderBoardInlineAction} from '../board/message-presentation.js';
import {BOARD_TURN_CAPTIONS} from './perspective-labels.js';
import {computerActivityActorSide,setActivityActor} from './activity-affiliation.js';
import { COMPUTER_PROFILES } from '../generated/packages/shared-types/src/computer-play.js';
import { describeMove, describeTurn } from './computer-narration.js';
import { SELECTED_PIECE_EXPLANATIONS,SELECTED_CONTINUATION_LABELS } from '../board/piece-explanations.js';
import {renderCoordinateChip} from '../board/coordinate-chip.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
// Exercise the real formatter for every action and whole-turn summary. The
// bounded spectator name also reserves its actual unbreakable 12ch name box.
const maximumPoint = {row:9,col:9};
const maximumSpectatorName = 'W'.repeat(32);
const sizingActors = [
  ...['Your opponent','Red','Blue',...Object.values(COMPUTER_PROFILES).map(profile=>profile.name)].map(name=>({name})),
  {name:maximumSpectatorName,actorName:maximumSpectatorName},
];
const sizingDecision = (type,actorId) => ({action:{type,actorId,from:maximumPoint,to:maximumPoint}});
const sizingSequences = [
  [sizingDecision('rush','A'),sizingDecision('rush','B')],
  [sizingDecision('push','A'),sizingDecision('follow','B')],
  [sizingDecision('push','A'),sizingDecision('follow','B'),sizingDecision('follow','C')],
];
const narrationSizes = sizingActors.flatMap(({name,actorName}) => [
  ...['move','project','rush','push','retreat','follow'].flatMap(type=>[
    {text:describeMove(sizingDecision(type,'A'),name),actorName},
    // Finite single-step envelope, including one coordinate per removal owner.
    // Long variable destination lists are admitted from exact records below.
    {text:describeMove({...sizingDecision(type,'A'),actorSide:'P1',destroyedPieces:[
      {pieceId:'sizing-own',ownerSeat:'P1',position:maximumPoint},
      {pieceId:'sizing-opposing',ownerSeat:'P2',position:maximumPoint},
    ]},name),actorName},
  ]),
  ...sizingSequences.map(moves=>({text:describeTurn(moves,name),actorName})),
]);
const maximumCoordinate=renderCoordinateChip({row:9,col:9});
const explanationSizes = SELECTED_PIECE_EXPLANATIONS.flatMap(text => {
  const base=`Piece at ${maximumCoordinate} – ${escape(text)}`;
  return [
    `${base} ${renderBoardInlineAction({id:"end-turn",label:"End turn"},{sizing:true})}`,
    `${base} · ${SELECTED_CONTINUATION_LABELS.rushBlocker} ${maximumCoordinate}`,
    `${base} · ${SELECTED_CONTINUATION_LABELS.retreat}`,
    `${base} · ${SELECTED_CONTINUATION_LABELS.follow}`,
  ];
});

// Both font families use this one real formatter. The fallback remains present
// after Manrope loads, so a cold font swap cannot shrink the reserved message.
// The finite base uses the real grammar, with no actionable replicas.
const renderMessageSizing = fallback => {
  const fontClass=fallback?' board-message-fallback-sizing':'';
  const attrs=index=>`data-sizing-font="${fallback?'fallback':'primary'}" data-sizing-variant="${index}" aria-hidden="true" inert`;
  return narrationSizes.map((message,index) => `<p class="board-preview-label board-message-sizing board-message-narration-sizing${fontClass}" ${attrs(`narration:${index}`)}>${renderBoardMessageHtml({rows:[{...message,coordinates:[maximumPoint],action:{id:"replay-computer",label:"Show me again"}},{text:"Select a piece or",action:{id:"pass",label:"Pass"}}]},{sizing:true})}</p>`).join('')
    + explanationSizes.map((text,index) => `<p class="board-preview-label board-message-sizing board-explanation-sizing${fontClass}" ${attrs(`explanation:${index}`)}>${text}</p>`).join('');
};

const narrationReservationStates=new WeakMap();
/** Retain exact acknowledged copy within one game/lineage/view intent. The
 * permanent enlarged fallback also covers the cold-to-primary font swap. */
export function retainNarrationReservations(slot,{scope,messages=[]}={}){
  if(!slot?.insertAdjacentHTML)return;
  let state=narrationReservationStates.get(slot);
  if(!state||state.scope!==scope){
    for(const node of slot.querySelectorAll('[data-narration-reservation]'))node.remove();
    state={scope,html:new Set(),serial:0};narrationReservationStates.set(slot,state);
  }
  for(const message of messages.filter(Boolean)){
    const rows=message.rows?message:{rows:[{...message,action:{id:'replay-computer',label:'Show me again'}},{text:'Select a piece or',action:{id:'pass',label:'Pass'}}]};
    const html=renderBoardMessageHtml(rows,{sizing:true});
    if(state.html.has(html))continue;
    state.html.add(html);const index=++state.serial;
    for(const fallback of [false,true])slot.insertAdjacentHTML('beforeend',`<p class="board-preview-label board-message-sizing${fallback?' board-message-fallback-sizing board-message-dynamic-fallback':''}" data-narration-reservation="${index}" data-sizing-font="${fallback?'fallback':'primary'}" data-sizing-variant="acknowledged:${index}" aria-hidden="true" inert>${html}</p>`);
  }
}

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
