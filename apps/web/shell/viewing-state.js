import { applyHistoryIntent } from './recovery-view.js';

// Inspection is personal. Narrow History must never change live Board authority.
export function deriveBoardView(game, { narrow = false, identityId = '' } = {}) {
  if (!game || !narrow || !game.inHistoryMode) return game;
  const live = structuredClone(game);
  live.board.state = structuredClone(game.liveCurrentSnapshot ?? game.board.state);
  applyHistoryIntent(live, { moveId: null }, identityId);
  if (live.sharedMutationsBlocked) live.canRecordMove = live.canEndTurn = false;
  return live;
}

export function createViewingIntent() {
  const generations = new Map(), undos = new Map(), scroll = new Map();
  const generation = id => generations.get(id) ?? 0;
  return {
    generation,
    navigate(id) { generations.set(id, generation(id) + 1); },
    beginUndo(id, { targetMoveId, revision, scope }) {
      const token = { targetMoveId, revision, scope, generation: generation(id), committed: false };
      undos.set(id, token); return token;
    },
    commitUndo(id, token) { if (undos.get(id) === token) token.committed = true; },
    observeUndo(id, game, scope) {
      const token = undos.get(id);
      if (!token) return false;
      if (scope !== token.scope || generation(id) !== token.generation) { undos.delete(id); return false; }
      const target = game?.moves?.find(move => move.moveId === token.targetMoveId);
      const pending = game?.myPendingRevertRequest ?? game?.pendingRevertRequest;
      if (!token.committed || pending || !(game?.gameplayRevision > token.revision) || !(target?.undone || game?.lastRestoration?.decisionId === token.targetMoveId)) return false;
      undos.delete(id); return true;
    },
    cancelUndo(id, token) { if (token === undefined || undos.get(id) === token) undos.delete(id); },
    saveScroll(id, panel, top) { scroll.set(`${id}:${panel}`, Math.max(0, top)); },
    scrollTop(id, panel) { return scroll.get(`${id}:${panel}`) ?? 0; },
    clear() { generations.clear(); undos.clear(); scroll.clear(); },
  };
}
