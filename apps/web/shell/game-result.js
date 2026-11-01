import {isTerminalOutcome} from './game-lifecycle.js';
import {owningPerspective,playerDisplayName,sideColorName} from './perspective-labels.js';
import { icon } from './ui.js';
import { commanderOutcome } from '../generated/packages/shared-types/src/commander-outcome.js';
export const RESULT_HEADING_CONTRACT = 'named-perspective-v3';
export const REMATCH_CHOICES_CONTRACT = 'colors-v1';

export const getGameResult = (game, identityId) => {
  const outcome = game?.board?.state?.outcome;
  if (!isTerminalOutcome(outcome?.status)) return null;
  // Authoritative snapshots have no personalized roles. Derive them only
  // from a nonempty captured identity, then use the shared seat perspective.
  const roles = identityId ? ['p1','p2'].filter(side => game[side === 'p1' ? 'player1' : 'player2']?.identityId === identityId).map(side => side === 'p1' ? 'Player 1' : 'Player 2') : [];
  const perspective = owningPerspective({...game, myRoles: roles, myRole: roles[0] ?? 'Viewer'}, {identityId});
  const both = perspective.kind === 'self';
  const side = both ? game.selfPlayStartSide || 'p1' : perspective.sides[0]?.toLowerCase() ?? null;
  const winner = outcome.status === "draw" ? null : outcome.status.slice(0, 2);
  const humanSelfPlay = Boolean(game.selfPlayMode && game.player1?.identityId && game.player1.identityId === game.player2?.identityId
    && !game.player1?.computerProfile && !game.player2?.computerProfile && !game.computer?.seats?.p1 && !game.computer?.seats?.p2);
  const winnerName = winner ? both || winner === side ? 'You' : playerDisplayName(game,winner) : null;
  const titleParts = !winner ? [{text:'Draw'}] : humanSelfPlay
    ? [{text:`${winnerName} won as ${sideColorName(winner)}`,side:winner,colorNamed:true}]
    : [{text:winnerName,side:winner},{text:' won'}];
  const title = titleParts.map(part=>part.text).join('');
  const commander = owner => ({text:both ? `Your ${sideColorName(owner)} commander` : side === owner ? 'Your commander' : `${playerDisplayName(game,owner)}’s commander`,side:owner,...(both?{colorNamed:true}:{})});
  const sentence = (owner,ending) => [commander(owner),{text:ending}];
  const reasons = {
    both_commanders_unsupplied:[{text:'Both commanders lost their supply.'}],
    p1_commander_unsupplied:sentence('p1',' lost its supply.'),p2_commander_unsupplied:sentence('p2',' lost its supply.'),
    p1_commander_destroyed:sentence('p1',' was destroyed.'),p2_commander_destroyed:sentence('p2',' was destroyed.'),
    both_commanders_destroyed:[{text:'Both commanders were destroyed.'}],
    p1_commander_destroyed_p2_unsupplied:[...sentence('p1',' was destroyed. '),...sentence('p2',' lost its supply.')],
    p1_commander_unsupplied_p2_destroyed:[...sentence('p1',' lost its supply. '),...sentence('p2',' was destroyed.')],
  };
  // Old outcomes used 'unsupplied' even after a commander was removed by a
  // push. Read the saved terminal position without rewriting that record.
  const legacy = Array.isArray(game.board.state.pieces) && ['both_commanders_unsupplied','p1_commander_unsupplied','p2_commander_unsupplied'].includes(outcome.reason) ? commanderOutcome(game.board.state.pieces) : null;
  const reason = legacy?.status === outcome.status ? legacy.reason : outcome.reason;
  const tone = !winner ? 'draw' : !side ? 'neutral' : both || winner === side ? 'victory' : 'defeat';
  const reasonParts=reasons[reason] ?? [{text:'The game has finished.'}];
  return { title, titleParts, side, winner, tone, controlsBothSides: both, reason: reasonParts.map(part=>part.text).join(''), reasonParts, opponent: game.computer?.seats?.p1 || game.computer?.seats?.p2 || game.player1?.computerProfile || game.player2?.computerProfile || (game.selfPlayMode ? "self" : "friend"), rematchSide: side === "p1" ? "p2" : "p1" };
};

const escapeResult = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Structured owner references avoid guessing identities from duplicate names or user text.
export const renderResultText = (result,field) => (result?.[`${field}Parts`] ?? [{text:result?.[field] ?? ''}]).map(part=>
  part.side ? `<span class="player-tone-${part.side}">${part.colorNamed?'':`<span class="sr-only">${sideColorName(part.side)}: </span>`}<bdi dir="auto">${escapeResult(part.text)}</bdi></span>` : escapeResult(part.text)
).join('');
export const renderHistoryResult = (game,identityId) => {
  const result=getGameResult(game,identityId);
  if(!result)return '';
  const color=result.winner?sideColorName(result.winner):null;
  const accessible=result.title + (color && !result.title.endsWith(` as ${color}`) ? `, ${color}` : '');
  return `<p class="history-result-summary" data-testid="history-result-summary" role="status"><strong class="player-tone-neutral" aria-label="${escapeResult(accessible)}">${renderResultText(result,'title')}</strong></p>`;
};

// Only an observed live transition opens automatically. Initial hydration,
// history, hidden tabs and a currently open story consume the transition silently.
export const createResultTransitions = () => {
  const statuses = new Map();
  return {
    clear() { statuses.clear(); },
    observe(game, { inHistory = false, hidden = false, storyOpen = false } = {}) {
      if (!game?.id || !game.board?.state?.outcome) return false;
      const next = game.board.state.outcome.status;
      const previous = statuses.get(game.id);
      statuses.set(game.id, next);
      return previous === "ongoing" && isTerminalOutcome(next) && !inHistory && !hidden && !storyOpen;
    },
  };
};

export const createRematchDialog = ({ createModal, document = globalThis.document, onStart, title = "Play again", labelId = "rematch-title", getReadiness = () => ({ state: 'ready', message: '' }), onOpponentChange = () => {}, onRetry = () => {}, onClose = () => {} }) => {
  let session = 0, busy = false, startFailure = null;
  const modal = createModal({ document, labelId, className: "rematch-modal", onClose: () => { session++; busy = false; startFailure = null; onClose(); } });
  const opponent = () => modal.element.querySelector("[name=rematch-opponent]:checked")?.value;
  const refresh = () => {
    if (!modal.element.open) return;
    const readiness = getReadiness(opponent());
    const start = modal.element.querySelector("[data-rematch-start]");
    start.disabled = busy || readiness.state !== 'ready';
    start.dataset.loadingState = busy ? 'pending' : 'idle'; start.setAttribute('aria-busy', String(busy));
    for (const control of modal.element.querySelectorAll?.('select,input') ?? []) control.disabled = busy;
    const status = modal.element.querySelector('[role=status]');
    status.textContent = startFailure ?? readiness.message ?? '';
    if (status.dataset) {
      status.dataset.loadingState = !startFailure && readiness.state === 'preparing' ? 'pending' : 'idle';
      status.dataset.loadingKey = `${labelId}:preparation:${session}`;
      status.dataset.loadingContext = 'external';
    }
    const retry = modal.element.querySelector('[data-rematch-retry]');
    if (retry) { retry.hidden = readiness.state !== 'error'; retry.disabled = busy; }
  };
  modal.element.addEventListener("change", event => {
    if (event.target.name === "rematch-side") modal.element.dataset.actionAffiliation = event.target.value === "p2" ? "blue" : "red";
    if (event.target.name === 'rematch-opponent') { startFailure = null; onOpponentChange(opponent()); refresh(); }
  });
  modal.element.addEventListener("click", async event => {
    if (busy || !modal.element.open) return;
    if (event.target.closest('[data-rematch-retry]')) { startFailure = null; await onRetry(opponent()); refresh(); return; }
    if (!event.target.closest("[data-rematch-start]") || getReadiness(opponent()).state !== 'ready') return;
    const intent = { opponent: opponent(), side: modal.element.querySelector("[name=rematch-side]:checked").value };
    const request = session;
    startFailure = null; busy = true; refresh();
    try {
      await onStart(intent, { isCurrent: () => request === session && modal.element.open });
      if (request === session) modal.close();
    } catch {
      if (request !== session) return;
      startFailure = "Could not start. Try again."; busy = false; refresh();
    }
  });
  return { close: modal.close, refresh, isOpen: () => modal.element.open, opponent, open(result, trigger) {
    session++; busy = false; startFailure = null;
    modal.open(`<h2 id="${labelId}">${title}</h2><fieldset class="rematch-opponents"><legend>Opponent</legend><div class="rematch-opponent-cards">${[["babs","Babs"],["tau","Tau"],["horus","Horus"],["friend","Friend"],["self","Play both sides"]].map(([id,label]) => `<label class="rematch-opponent-card"><input type="radio" name="rematch-opponent" value="${id}" ${result.opponent === id ? "checked autofocus" : ""}><span class="rematch-opponent-mark" aria-hidden="true">${id === 'self' ? icon('board') : `<img src="${new URL(`../assets/opponents/${id}-portrait.webp`,import.meta.url).href}" alt="" width="36" height="36">`}</span><span>${label}</span></label>`).join("")}</div></fieldset><fieldset><legend>Your side</legend>${[["p1","Red"],["p2","Blue"]].map(([id,label]) => `<label><input type="radio" name="rematch-side" value="${id}" ${result.rematchSide === id ? "checked" : ""}>${label}</label>`).join("")}</fieldset><p role="status"></p><div class="story-modal-actions"><button data-rematch-start data-loading-state="idle" data-loading-message="Starting your game is taking a little longer than usual.">${icon('play')}Start game</button><button class="secondary" data-rematch-retry hidden>${icon('rematch')}Retry</button><button class="secondary" data-modal-close>${icon('close')}Cancel</button></div>`, trigger);
    modal.element.dataset.actionAffiliation = result.rematchSide === "p2" ? "blue" : "red";
    onOpponentChange(opponent()); refresh();
  } };
};
