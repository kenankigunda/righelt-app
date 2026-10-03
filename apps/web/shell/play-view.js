import { deterministicStateHash } from "../generated/packages/game-engine/src/hash.js";

export const gamePlayRevision = (game) => game?.board?.state ? deterministicStateHash(game.board.state) : null;
export const canRestoreGameView = (saved, game, identity) => Boolean(saved && saved.identity === identity && saved.revision === gamePlayRevision(game));

export const createContextualHelp = () => {
  const dismissed = new Set();
  let manual = false;
  let expanded = false;
  let reason = "";
  let text = "Select a piece to inspect its supply, command and available actions.";
  return {
    getState: () => ({ manual, expanded, reason, text }),
    explain(nextReason, nextText) { reason = nextReason; text = nextText; expanded = manual || !dismissed.has(reason); },
    select(nextText) { text = nextText; },
    toggleManual() { manual = !manual; expanded = manual; },
    expand() { expanded = true; },
    dismiss() { if (reason) dismissed.add(reason); expanded = false; },
    commit(nextText = "Select a piece to inspect its supply, command and available actions.") { reason = ""; text = nextText; if (!manual) expanded = false; },
    collapseForBoard() { expanded = false; },
  };
};
