import { icon } from './ui.js';

const terminal = new Set(["p1_win", "p2_win", "draw"]);
export const getGameResult = (game, identityId) => {
  const outcome = game?.board?.state?.outcome;
  if (!terminal.has(outcome?.status)) return null;
  const ownsSeat = game.player1?.identityId === identityId || game.player2?.identityId === identityId;
  const side = game.computer && !game.computer.manual ? (!ownsSeat || (game.computer.seats.p1 && game.computer.seats.p2) ? null : game.computer.seats.p1 ? "p2" : "p1") : game.selfPlayMode && ownsSeat ? game.selfPlayStartSide || "p1" : game.player1?.identityId === identityId ? "p1" : game.player2?.identityId === identityId ? "p2" : null;
  const winner = outcome.status === "draw" ? null : outcome.status.slice(0, 2);
  const title = !winner ? "Draw" : side ? winner === side ? "Win" : "Loss" : `Player ${winner === "p1" ? "1" : "2"} wins`;
  const reasons = { both_commanders_unsupplied: "Both commanders lost their supply.", p1_commander_unsupplied: "Player 1’s commander lost its supply.", p2_commander_unsupplied: "Player 2’s commander lost its supply." };
  return { title, side, reason: reasons[outcome.reason] || "The game has finished.", opponent: game.computer && !game.computer.manual ? (game.computer.seats.p1 || game.computer.seats.p2) : game.selfPlayMode ? "self" : "friend", rematchSide: side === "p1" ? "p2" : "p1" };
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
    modal.open(`<h2 id="${labelId}">${title}</h2><fieldset class="rematch-opponents"><legend>Opponent</legend><div class="rematch-opponent-cards">${[["babs","Babs"],["tau","Tau"],["horus","Horus"],["friend","Friend"],["self","Self-play"]].map(([id,label]) => `<label class="rematch-opponent-card"><input type="radio" name="rematch-opponent" value="${id}" ${result.opponent === id ? "checked autofocus" : ""}><span class="rematch-opponent-mark" aria-hidden="true">${id === 'self' ? icon('board') : `<img src="${new URL(`../assets/opponents/${id}-portrait.webp`,import.meta.url).href}" alt="" width="36" height="36">`}</span><span>${label}</span></label>`).join("")}</div></fieldset><fieldset><legend>Your side</legend>${[["p1","Player 1 · Red"],["p2","Player 2 · Blue"]].map(([id,label]) => `<label><input type="radio" name="rematch-side" value="${id}" ${result.rematchSide === id ? "checked" : ""}>${label}</label>`).join("")}</fieldset><p class="small" data-rematch-friend-help hidden>Friend starts a new invitation. Your friend chooses whether to join.</p><p role="status"></p><div class="story-modal-actions"><button data-rematch-start data-loading-state="idle" data-loading-message="Starting your game is taking a little longer than usual.">Start game</button><button class="secondary" data-rematch-retry hidden>Retry</button><button class="secondary" data-modal-close>Cancel</button></div>`, trigger);
    modal.element.dataset.actionAffiliation = result.rematchSide === "p2" ? "blue" : "red";
    onOpponentChange(opponent()); refresh();
  } };
};
