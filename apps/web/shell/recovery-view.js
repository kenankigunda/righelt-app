import { computerProfileFor } from '../generated/packages/shared-types/src/computer-play.js';
// Personal viewing intent is local to a tab; snapshots cannot move a reader's selection.
export const historyMoveKey = (move) => move.moveId ?? (move.clientCommandId ? `pending:${move.clientCommandId}` : null);
export const applyHistoryIntent = (game, intent, identityId) => {
  if (!intent) return game;
  const moves = [...(game.moves ?? []), ...(game.pendingMoves ?? [])];
  let selected = intent.moveId ? moves.find((move) => historyMoveKey(move) === intent.moveId || (intent.clientCommandId && move.clientCommandId === intent.clientCommandId)) : null;
  const currentIndex = selected?.index ?? null;
  if (intent.frozen && intent.moveId) {
    if (!intent.frozen.moveId && selected?.moveId) intent.frozen = structuredClone(selected);
    selected = intent.frozen;
  }
  if (intent.moveId && !selected) {
    const oldOrder = intent.order ?? [];
    selected = moves.filter((move) => oldOrder.includes(historyMoveKey(move))).sort((a, b) => {
      const ai = oldOrder.indexOf(historyMoveKey(a)), bi = oldOrder.indexOf(historyMoveKey(b));
      return Math.abs(ai - intent.position) - Math.abs(bi - intent.position) || ai - bi;
    })[0] ?? moves[Math.min(intent.position, moves.length - 1)];
    intent.moveId = selected ? historyMoveKey(selected) : null;
    intent.notice = selected ? "History changed. Showing the nearest available move." : "History changed. Showing the current board.";
  }
  if (selected) {
    intent.moveId = historyMoveKey(selected);
    intent.clientCommandId = selected.clientCommandId;
    intent.order = moves.map(historyMoveKey);
    intent.position = moves.indexOf(selected);
  }
  game.historyNotice = intent.notice ?? "";
  game.inHistoryMode = Boolean(selected);
  game.historyIndex = intent.frozen ? currentIndex : selected?.index ?? null;
  game.inspectedDecision = selected ? structuredClone(selected) : null;
  game.inspectedAtRevision = intent.revision;
  game.historySelectionAction = selected?.action ?? null;
  game.currentSnapshot = structuredClone(selected?.snapshot ?? selected?.selectionSnapshot ?? game.board.state);
  if (selected) {
    game.canRecordMove = false;
    game.canEndTurn = false;
    game.currentTurn = game.turns?.find((turn) => turn.index === game.currentSnapshot.turnIndex) ?? {
      index: game.currentSnapshot.turnIndex,
      playerSeat: (game.currentSnapshot.continuation?.owner ?? game.currentSnapshot.sideToMove) === 'P1' ? 'Player 1' : 'Player 2',
      moveIndexes: [],
    };
  } else {
    game.currentTurn = game.turns?.at(-1) ?? game.currentTurn;
  }
  game.turnOwnerSeat = game.currentTurn?.playerSeat ?? (game.currentSnapshot.sideToMove === "P1" ? "Player 1" : "Player 2");
  const continuation = game.currentSnapshot.continuation;
  game.controlSeat = continuation?.type === "push" && continuation.phase === "retreat"
    ? (game.turnOwnerSeat === "Player 1" ? "Player 2" : "Player 1") : game.turnOwnerSeat;
  game.control = game.controlSeat === game.turnOwnerSeat ? "turn-owner" : "opponent";
  if (!selected && (game.player1 || game.player2)) {
    const seatIdentity = (seat) => (seat === "Player 1" ? game.player1 : game.player2)?.identityId;
    game.computerTurn = computerProfileFor(game.computer, game.board.state.sideToMove, game.board.state.turnIndex ?? 0);
    game.canRecordMove = !game.computerTurn && seatIdentity(game.controlSeat) === identityId && game.legalActions?.length > 0;
    game.canEndTurn = !game.computerTurn && game.control === "turn-owner" && seatIdentity(game.turnOwnerSeat) === identityId && Boolean(game.currentTurn?.moveIndexes?.length);
  }
  return game;
};

export const recoveryMessage = (game) => {
  if (game.upgradeRequired) return "This game needs an update. Refresh to continue.";
  if (game.storageBlocked) return game.storageLimitReached
    ? "Earlier moves are still being checked. Wait for them to finish before making another move."
    : game.unsavedCommand ? "Your browser couldn't save this move. It wasn't sent."
      : "Your browser couldn't save recovery information. Retry saving to continue.";
  if (!game.recovering && game.syncStatus !== "confirming" && !game.confirmationOverdue) return "";
  const plural = game.pendingCommandCount > 1;
  if (game.pendingCommandCount > 0) return game.confirmationOverdue
    ? `Your ${plural ? "moves are" : "move is"} still being checked.`
    : `Checking your ${plural ? "moves" : "move"}…`;
  return "Reconnecting. Your board will update shortly.";
};

export const sharedMutationActions = new Set([
  "end-turn", "undo-last-move", "revert-to-move", "launch-history-branch", "play-as-both-players",
  "join-player", "accept-invite-player", "approve-request", "accept-request", "accept-revert-request",
  "reject-revert-request", "rescind-revert-request",
]);
