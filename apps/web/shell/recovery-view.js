import { computerProfileFor } from '../generated/packages/shared-types/src/computer-play.js';
import { SYNC_TIMING } from "../generated/packages/shared-types/src/sync-protocol.js";
// Personal viewing intent is local to a tab; snapshots cannot move a reader's selection.
export const historyMoveKey = (move) => move.moveId ?? (move.clientCommandId ? `pending:${move.clientCommandId}` : null);
export const applyHistoryIntent = (game, intent, identityId) => {
  if (!intent) return game;
  const moves = [...(game.moves ?? []), ...(game.pendingMoves ?? [])];
  let selected = intent.moveId ? moves.find((move) => historyMoveKey(move) === intent.moveId || (intent.clientCommandId && move.clientCommandId === intent.clientCommandId)) : null;
  const currentIndex = selected?.index ?? null;
  if (intent.frozen && intent.moveId) {
    if (!intent.frozen.moveId && selected?.moveId) intent.frozen = structuredClone({ ...intent.frozen, ...selected, snapshot: selected.snapshot ?? intent.frozen.snapshot, selectionSnapshot: selected.selectionSnapshot ?? intent.frozen.selectionSnapshot });
    selected = intent.frozen;
  }
  if (intent.moveId && !selected) {
    const oldOrder = intent.order ?? [];
    selected = moves.filter((move) => oldOrder.includes(historyMoveKey(move))).sort((a, b) => {
      const ai = oldOrder.indexOf(historyMoveKey(a)), bi = oldOrder.indexOf(historyMoveKey(b));
      return Math.abs(ai - intent.position) - Math.abs(bi - intent.position) || ai - bi;
    })[0] ?? moves[Math.min(intent.position, moves.length - 1)];
    intent.moveId = selected ? historyMoveKey(selected) : null;
    intent.notice = selected ? "History changed. Showing the closest available move." : "History changed. You’re back at the current board.";
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
  if (selected && Array.isArray(game.moves)) game.moves=game.moves.map(move=>historyMoveKey(move)===historyMoveKey(selected) ? {...move,snapshot:selected.snapshot ?? move.snapshot,selectionSnapshot:selected.selectionSnapshot ?? move.selectionSnapshot} : move);
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
    game.canEndTurn = !game.computerTurn && game.control === "turn-owner" && seatIdentity(game.turnOwnerSeat) === identityId && game.legalActions?.some(action => action.type === "end_turn") === true;
  }
  return game;
};

export const isBoardRecoveryPending = game => Boolean(game?.sharedMutationsBlocked
  && !game.inHistoryMode && !game.storageBlocked && !game.upgradeRequired
  && !["session_changed", "invalid_credentials"].includes(game.recoveryIssue)
  && (game.recovering || game.syncStatus === "confirming"));

export const recoveryMessage = (game, now = Date.now()) => {
  if (game.upgradeRequired) return "Righelt has an update. Refresh to keep playing.";
  if (game.storageBlocked) return game.storageLimitReached
    ? "Still recording earlier moves. Please wait before making another."
    : game.unsavedCommand ? "We couldn’t save your move. Please try again."
      : "We’re having trouble saving. Please try again.";
  if (!game.recovering && game.syncStatus !== "confirming" && !game.confirmationOverdue) return "";
  if (["session_changed", "invalid_credentials"].includes(game.recoveryIssue)) return "Please sign in again to continue.";
  const elapsed = game.recoveryStartedAt ? Math.max(0, now - game.recoveryStartedAt) : 0;
  if (elapsed < SYNC_TIMING.reconnectAlertMs && !game.confirmationOverdue) return "";
  if (elapsed < SYNC_TIMING.confirmationBudgetMs && !game.confirmationOverdue) return game.pendingCommandCount > 0 ? "Recording your move" : "Reconnecting";
  return game.pendingCommandCount > 0 ? "Still checking your move. You can retry or view details." : "Still reconnecting. You can retry or view details.";
};

export const sharedMutationActions = new Set([
  "end-turn", "undo-last-move", "revert-to-move", "launch-history-branch", "play-as-both-players",
  "join-player", "accept-invite-player", "approve-request", "accept-request", "accept-revert-request",
  "reject-revert-request", "rescind-revert-request",
]);
