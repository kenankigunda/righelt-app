import { deterministicStateHash } from "../generated/packages/game-engine/src/hash.js";

export const gamePlayRevision = (game) => game?.board?.state ? deterministicStateHash(game.board.state) : null;
export const canRestoreGameView = (saved, game, identity) => Boolean(saved && saved.identity === identity && saved.revision === gamePlayRevision(game));

export const createContextualHelp = ({ storage, key } = {}) => {
  let saved = [];
  try { const value = JSON.parse(storage?.getItem(key) || "[]"); if (Array.isArray(value)) saved = value.filter(reason => typeof reason === "string" && reason.length <= 200).slice(0, 100); } catch {}
  const dismissed = new Set(saved);
  let manual = false;
  let expanded = false;
  let reason = "";
  let text = "Select a piece to inspect its supply, command and available actions.";
  return {
    getState: () => ({ manual, expanded, reason, text }),
    explain(nextReason, nextText) { reason = nextReason; text = nextText; expanded = manual || !dismissed.has(reason); },
    select(nextText) { text = nextText; },
    setManual(value) { manual = Boolean(value); expanded = manual; },
    toggleManual() { manual = !manual; expanded = manual; },
    expand() { expanded = true; },
    dismiss() { if (reason) dismissed.add(reason); try { if (key) storage?.setItem(key, JSON.stringify([...dismissed])); } catch {} expanded = false; },
    commit(nextText = "Select a piece to inspect its supply, command and available actions.") { reason = ""; text = nextText; if (!manual) expanded = false; },
    collapseForBoard() { expanded = false; },
  };
};
