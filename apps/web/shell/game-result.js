const terminal = new Set(["p1_win", "p2_win", "draw"]);
export const getGameResult = (game, identityId) => {
  const outcome = game?.board?.state?.outcome;
  if (!terminal.has(outcome?.status)) return null;
  const ownsSeat = game.player1?.identityId === identityId || game.player2?.identityId === identityId;
  const side = game.selfPlayMode && ownsSeat ? game.selfPlayStartSide || "p1" : game.player1?.identityId === identityId ? "p1" : game.player2?.identityId === identityId ? "p2" : null;
  const winner = outcome.status === "draw" ? null : outcome.status.slice(0, 2);
  const title = !winner ? "Draw" : side ? winner === side ? "Win" : "Loss" : `Player ${winner === "p1" ? "1" : "2"} wins`;
  const reasons = { both_commanders_unsupplied: "Both commanders lost their supply.", p1_commander_unsupplied: "Player 1’s commander lost its supply.", p2_commander_unsupplied: "Player 2’s commander lost its supply." };
  return { title, side, reason: reasons[outcome.reason] || "The game has finished.", opponent: game.selfPlayMode ? "self" : "friend", rematchSide: side === "p1" ? "p2" : "p1" };
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

export const createRematchDialog = ({ createModal, document = globalThis.document, onStart }) => {
  let session = 0, busy = false;
  const modal = createModal({ document, labelId: "rematch-title", onClose: () => { session++; busy = false; } });
  modal.element.addEventListener("click", async event => {
    if (!event.target.closest("[data-rematch-start]") || busy) return;
    const opponent = modal.element.querySelector("[name=rematch-opponent]").value;
    const side = modal.element.querySelector("[name=rematch-side]:checked").value;
    const request = session;
    busy = true; modal.element.querySelector("[data-rematch-start]").disabled = true;
    try {
      await onStart({ opponent, side }, { isCurrent: () => request === session && modal.element.open });
      if (request === session) modal.close();
    } catch {
      if (request !== session) return;
      busy = false; modal.element.querySelector("[data-rematch-start]").disabled = false;
      modal.element.querySelector("[role=status]").textContent = "Could not start. Try again.";
    }
  });
  return { close: modal.close, open(result, trigger) {
    session++; busy = false;
    modal.open(`<h2 id="rematch-title">Play again</h2><label>Opponent<select name="rematch-opponent">${[["babs","Babs · Easy"],["tau","Tau · Medium"],["horus","Horus · Hard"],["friend","Friend"],["self","Self-play"]].map(([id,label]) => `<option value="${id}" ${result.opponent === id ? "selected" : ""}>${label}</option>`).join("")}</select></label><fieldset><legend>Your side</legend>${[["p1","Player 1 · Red"],["p2","Player 2 · Blue"]].map(([id,label]) => `<label><input type="radio" name="rematch-side" value="${id}" ${result.rematchSide === id ? "checked" : ""}>${label}</label>`).join("")}</fieldset><p class="small">Friend starts a new invitation. Your friend chooses whether to join.</p><p role="status"></p><div class="story-modal-actions"><button data-rematch-start>Start game</button><button class="secondary" data-modal-close>Cancel</button></div>`, trigger);
    modal.element.dataset.actionAffiliation = result.rematchSide === "p2" ? "blue" : "red";
  } };
};
