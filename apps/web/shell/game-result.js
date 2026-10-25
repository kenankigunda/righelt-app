import { icon } from './ui.js';
import { commanderOutcome } from '../generated/packages/shared-types/src/commander-outcome.js';

const terminal = new Set(["p1_win", "p2_win", "draw"]);
export const getGameResult = (game, identityId) => {
  const outcome = game?.board?.state?.outcome;
  if (!terminal.has(outcome?.status)) return null;
  const ownsSeat = game.player1?.identityId === identityId || game.player2?.identityId === identityId;
  const side = game.computer && !game.computer.manual ? (!ownsSeat || (game.computer.seats.p1 && game.computer.seats.p2) ? null : game.computer.seats.p1 ? "p2" : "p1") : game.selfPlayMode && ownsSeat ? game.selfPlayStartSide || "p1" : game.player1?.identityId === identityId ? "p1" : game.player2?.identityId === identityId ? "p2" : null;
  const winner = outcome.status === "draw" ? null : outcome.status.slice(0, 2);
  const title = !winner ? "Draw" : side ? winner === side ? "You won" : "Your opponent won" : `Player ${winner === "p1" ? "1" : "2"} wins`;
  const commander = owner => !side ? `Player ${owner === 'p1' ? '1' : '2'}’s commander` : side === owner ? 'Your commander' : 'Your opponent’s commander';
  const reasons = { both_commanders_unsupplied: "Both commanders lost their supply.", p1_commander_unsupplied: `${commander('p1')} lost its supply.`, p2_commander_unsupplied: `${commander('p2')} lost its supply.`, p1_commander_destroyed: `${commander('p1')} was destroyed.`, p2_commander_destroyed: `${commander('p2')} was destroyed.`, both_commanders_destroyed: "Both commanders were destroyed.", p1_commander_destroyed_p2_unsupplied: `${commander('p1')} was destroyed. ${commander('p2')} lost its supply.`, p1_commander_unsupplied_p2_destroyed: `${commander('p1')} lost its supply. ${commander('p2')} was destroyed.` };
  // Old outcomes used 'unsupplied' even after a commander was removed by a
  // push. Read the saved terminal position without rewriting that record.
  const legacy = Array.isArray(game.board.state.pieces) && ['both_commanders_unsupplied','p1_commander_unsupplied','p2_commander_unsupplied'].includes(outcome.reason) ? commanderOutcome(game.board.state.pieces) : null;
  const reason = legacy?.status === outcome.status ? legacy.reason : outcome.reason;
  const tone = !winner ? 'draw' : !side ? 'neutral' : winner === side ? 'victory' : 'defeat';
  return { title, side, winner, tone, reason: reasons[reason] || "The game has finished.", opponent: game.computer && !game.computer.manual ? (game.computer.seats.p1 || game.computer.seats.p2) : game.selfPlayMode ? "self" : "friend", rematchSide: side === "p1" ? "p2" : "p1" };
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
      return previous === "ongoing" && terminal.has(next) && !inHistory && !hidden && !storyOpen;
    },
  };
};

export const createRematchDialog = ({ createModal, document = globalThis.document, onStart, title = "Play again", labelId = "rematch-title", getReadiness = () => ({ state: 'ready', message: '' }), onOpponentChange = () => {}, onRetry = () => {}, onClose = () => {} }) => {
  let session = 0, busy = false, startFailure = null;
  const modal = createModal({ document, labelId, className: "rematch-modal", onClose: () => { session++; busy = false; startFailure = null; onClose(); } });
  const opponent = () => modal.element.querySelector("[name=rematch-opponent]:checked")?.value;
  const refresh = () => {
    if (!modal.element.open) return;
    const friendHelp = modal.element.querySelector('[data-rematch-friend-help]');
    if (friendHelp) friendHelp.hidden = opponent() !== 'friend';
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
    modal.open(`<h2 id="${labelId}">${title}</h2><fieldset class="rematch-opponents"><legend>Opponent</legend><div class="rematch-opponent-cards">${[["babs","Babs"],["tau","Tau"],["horus","Horus"],["friend","Friend"],["self","Self-play"]].map(([id,label]) => `<label class="rematch-opponent-card"><input type="radio" name="rematch-opponent" value="${id}" ${result.opponent === id ? "checked autofocus" : ""}><span class="rematch-opponent-mark" aria-hidden="true">${id === 'self' ? icon('board') : `<img src="${new URL(`../assets/opponents/${id}-portrait.webp`,import.meta.url).href}" alt="" width="36" height="36">`}</span><span>${label}</span></label>`).join("")}</div></fieldset><fieldset><legend>Your side</legend>${[["p1","Player 1 · Red"],["p2","Player 2 · Blue"]].map(([id,label]) => `<label><input type="radio" name="rematch-side" value="${id}" ${result.rematchSide === id ? "checked" : ""}>${label}</label>`).join("")}</fieldset><p class="small" data-rematch-friend-help hidden>Friend starts a new invitation. Your friend chooses whether to join.</p><p role="status"></p><div class="story-modal-actions"><button data-rematch-start data-loading-state="idle" data-loading-message="Starting your game is taking a little longer than usual.">${icon('play')}Start game</button><button class="secondary" data-rematch-retry hidden>${icon('rematch')}Retry</button><button class="secondary" data-modal-close>${icon('close')}Cancel</button></div>`, trigger);
    modal.element.dataset.actionAffiliation = result.rematchSide === "p2" ? "blue" : "red";
    onOpponentChange(opponent()); refresh();
  } };
};
