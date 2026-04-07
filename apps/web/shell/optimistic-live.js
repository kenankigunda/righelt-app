import {
  applyAction,
  listLegalActions,
  resolveToStability,
  validateAction,
} from "../generated/packages/game-engine/src/index.js";
import {
  finalizeResolvedTurn,
  getControlSeatForTurn,
  getSideForSeat,
} from "../generated/packages/shared-types/src/shell-live-turn.js";

const clone = (value) => structuredClone(value);
const getActiveTurn = (game) => game.turns?.[game.turns.length - 1] ?? null;
const getSideToMoveSeat = (game) => (game.board?.state?.sideToMove === "P1" ? "Player 1" : "Player 2");
const getSeatIdentity = (game, seat) => (seat === "Player 1" ? game.player1?.identityId ?? null : game.player2?.identityId ?? null);

const formatCoordinate = (coord) => (coord ? `(${coord.row},${coord.col})` : "(?,?)");

export const defaultNotationForAction = (action) => {
  if (action?.type === "pass") {
    return "PASS";
  }
  return `${String(action?.type || "move").toUpperCase()} ${formatCoordinate(action?.from)} -> ${formatCoordinate(action?.to)}`;
};

const collectRemovedPieceNotices = (before, afterApply, afterStability, action) => {
  const afterApplyIds = new Set(afterApply.pieces.map((piece) => piece.id));
  const afterStableIds = new Set(afterStability.pieces.map((piece) => piece.id));
  const notices = [];

  for (const piece of before.pieces) {
    if (!afterApplyIds.has(piece.id)) {
      const reason = piece.pushed || action.type === "push" || action.type === "retreat" ? "no_retreat" : "loss_of_supply";
      notices.push({
        pieceId: piece.id,
        position: { ...piece.position },
        reason,
        message:
          reason === "no_retreat"
            ? `Piece at (${piece.position.row}, ${piece.position.col}) destroyed because it could not retreat`
            : `Piece at (${piece.position.row}, ${piece.position.col}) destroyed due to loss of supply`,
      });
    }
  }

  for (const piece of afterApply.pieces) {
    if (!afterStableIds.has(piece.id)) {
      notices.push({
        pieceId: piece.id,
        position: { ...piece.position },
        reason: "loss_of_supply",
        message: `Piece at (${piece.position.row}, ${piece.position.col}) destroyed due to loss of supply`,
      });
    }
  }

  return notices;
};

/**
 * Collect DestroyedPieceRecord entries for a single move resolution.
 *
 * Invariant: A Commander removal always produces a terminal outcome (p1_win,
 * p2_win, or draw). When piece.kind === "commander" the reason is classified
 * as "commander_unsupplied" rather than "loss_of_supply". A move with
 * outcome.status === "ongoing" will never produce a Commander record here.
 *
 * TypeScript reference: packages/api-handler/src/shell-live-core.ts
 * (`collectDestroyedPieceRecords`). Keep both in sync; U-17 is the parity guard.
 *
 * @param {object} before - Board state before the action was applied.
 * @param {object} afterApply - Board state immediately after applying the action.
 * @param {object} afterStability - Board state after full stability resolution.
 * @param {object} action - The action that was applied.
 * @returns {Array<{position: {row: number, col: number}, ownerSeat: "p1"|"p2", supplied: boolean, commanded: boolean, reason: "no_retreat"|"loss_of_supply"|"commander_unsupplied"}>}
 */
export const collectDestroyedPieceRecords = (before, afterApply, afterStability, action) => {
  const afterApplyIds = new Set(afterApply.pieces.map((piece) => piece.id));
  const afterStableIds = new Set(afterStability.pieces.map((piece) => piece.id));
  const records = [];

  for (const piece of before.pieces) {
    if (!afterApplyIds.has(piece.id)) {
      const reason =
        piece.kind === "commander"
          ? "commander_unsupplied"
          : piece.pushed || action.type === "push" || action.type === "retreat"
            ? "no_retreat"
            : "loss_of_supply";
      records.push({
        position: { ...piece.position },
        ownerSeat: piece.owner === "P1" ? "p1" : "p2",
        supplied: piece.supplied !== false,
        commanded: piece.commanded !== false,
        reason,
      });
    }
  }

  for (const piece of afterApply.pieces) {
    if (!afterStableIds.has(piece.id)) {
      const reason = piece.kind === "commander" ? "commander_unsupplied" : "loss_of_supply";
      records.push({
        position: { ...piece.position },
        ownerSeat: piece.owner === "P1" ? "p1" : "p2",
        supplied: piece.supplied !== false,
        commanded: piece.commanded !== false,
        reason,
      });
    }
  }

  return records;
};

const completeTurn = (game, queuedAt) => {
  const activeTurn = getActiveTurn(game);
  if (!activeTurn) {
    return { ok: false, error: "turn_not_initialized" };
  }
  if (activeTurn.moveIndexes.length === 0) {
    return { ok: false, error: "turn_has_no_moves" };
  }

  const endedAt = queuedAt;
  activeTurn.endedAt = endedAt;
  activeTurn.status = "complete";
  const { nextState, nextTurn } = finalizeResolvedTurn({
    state: game.board.state,
    activeTurn,
    endedAt,
    resolveToStability,
  });
  game.turns.push(nextTurn);
  game.board.state = nextState;
  game.updatedAt = endedAt;
  return { ok: true, nextTurn };
};

const buildPendingMoveEntry = ({ command, selectionSnapshot, snapshot, activeTurn, index }) => ({
  index,
  turnIndex: activeTurn.index,
  turnMoveIndex: activeTurn.moveIndexes.length - 1,
  actorSide: selectionSnapshot.sideToMove,
  at: command.queuedAt,
  notation: command.notation,
  action: clone(command.action),
  clientCommandId: command.clientCommandId,
  selectionSnapshot,
  snapshot,
  pending: true,
});

const finalizeProjectedView = ({ authoritativeGame, workingGame, identityId, queue, pendingMoves }) => {
  const next = clone(workingGame);
  const activeTurn = getActiveTurn(next);
  const turnOwnerSeat = activeTurn?.playerSeat ?? getSideToMoveSeat(next);
  const controlSeat = getControlSeatForTurn(next.board.state, turnOwnerSeat);
  const controlIdentity = getSeatIdentity(next, controlSeat);
  const turnOwnerIdentity = getSeatIdentity(next, turnOwnerSeat);
  const liveLegalActions = listLegalActions(next.board.state);
  const isPlayer = next.myRole === "Player 1" || next.myRole === "Player 2";

  next.turnOwnerSeat = turnOwnerSeat;
  next.controlSeat = controlSeat;
  next.control = controlSeat === turnOwnerSeat ? "turn-owner" : "opponent";
  next.currentTurn = activeTurn ? clone(activeTurn) : null;
  next.legalActions = liveLegalActions;
  next.pendingMoves = pendingMoves.map((move) => clone(move));
  next.pendingCommandCount = queue.length;
  next.liveCurrentSnapshot = clone(next.board.state);
  next.currentSnapshot = next.inHistoryMode ? authoritativeGame.currentSnapshot : clone(next.board.state);
  next.canRecordMove = isPlayer && !next.inHistoryMode && controlIdentity === identityId && liveLegalActions.length > 0;
  next.canEndTurn =
    isPlayer &&
    !next.inHistoryMode &&
    controlSeat === turnOwnerSeat &&
    turnOwnerIdentity === identityId &&
    Boolean(activeTurn?.moveIndexes?.length);
  return next;
};

export const projectOptimisticGame = ({ authoritativeGame, identityId, queue }) => {
  const workingGame = clone(authoritativeGame);
  workingGame.board = {
    ...(workingGame.board ?? {}),
    state: clone(authoritativeGame.board?.state ?? authoritativeGame.currentSnapshot),
  };

  const pendingMoves = [];
  const commandResults = new Map();

  for (const command of queue) {
    if (command.kind === "apply") {
      const activeTurn = getActiveTurn(workingGame);
      if (!activeTurn) {
        return { ok: false, error: "turn_not_initialized", clientCommandId: command.clientCommandId };
      }

      const stable = resolveToStability(workingGame.board.state, { artifactMode: "full" });
      const validation = validateAction(stable, command.action);
      if (!validation.ok) {
        return {
          ok: false,
          error: validation.code || "invalid_action",
          validation,
          clientCommandId: command.clientCommandId,
        };
      }

      const applied = applyAction(stable, command.action);
      const nextStable = resolveToStability(applied.state, { artifactMode: "full" });
      const removedPieces = collectRemovedPieceNotices(stable, applied.state, nextStable, command.action);
      const destroyedPieces = collectDestroyedPieceRecords(stable, applied.state, nextStable, command.action);
      const turnSettled = nextStable.continuation == null;
      const finalizedTurn = turnSettled
        ? finalizeResolvedTurn({
            state: nextStable,
            activeTurn,
            endedAt: command.queuedAt,
            resolveToStability,
          })
        : null;
      const settledState = finalizedTurn?.nextState ?? nextStable;
      if (!turnSettled) {
        nextStable.sideToMove = getSideForSeat(getControlSeatForTurn(nextStable, activeTurn.playerSeat));
        nextStable.turnIndex = activeTurn.index;
      }

      activeTurn.moveIndexes.push(workingGame.moves.length + pendingMoves.length);
      activeTurn.lastMoveAt = command.queuedAt;
      workingGame.board.state = settledState;
      workingGame.lastMoveAt = command.queuedAt;
      workingGame.updatedAt = command.queuedAt;
      if (turnSettled) {
        activeTurn.endedAt = command.queuedAt;
        activeTurn.status = "complete";
        workingGame.turns.push(finalizedTurn.nextTurn);
      }

      const pendingMove = buildPendingMoveEntry({
        command,
        selectionSnapshot: stable,
        snapshot: settledState,
        activeTurn,
        index: workingGame.moves.length + pendingMoves.length,
      });
      pendingMoves.push(pendingMove);
      commandResults.set(command.clientCommandId, {
        accepted: true,
        state: clone(settledState),
        legalActions: listLegalActions(settledState),
        removedPieces,
        destroyedPieces,
        outcome: settledState.outcome ?? null,
      });
      continue;
    }

    const ended = completeTurn(workingGame, command.queuedAt);
    if (!ended.ok) {
      return { ok: false, error: ended.error, clientCommandId: command.clientCommandId };
    }
    commandResults.set(command.clientCommandId, {
      accepted: true,
      state: clone(workingGame.board.state),
      legalActions: listLegalActions(workingGame.board.state),
      outcome: workingGame.board.state.outcome ?? null,
    });
  }

  return {
    ok: true,
    game: finalizeProjectedView({ authoritativeGame, workingGame, identityId, queue, pendingMoves }),
    commandResults,
  };
};
