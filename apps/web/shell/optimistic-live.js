import {
  applyAction,
  listLegalActions,
  resolveToStability,
  validateAction,
} from "../generated/packages/game-engine/src/index.js";

const clone = (value) => structuredClone(value);
const getSideForSeat = (seat) => (seat === "Player 1" ? "P1" : "P2");
const getNextSeat = (seat) => (seat === "Player 1" ? "Player 2" : "Player 1");
const getSeatIdentity = (game, seat) => (seat === "Player 1" ? game.player1?.identityId ?? null : game.player2?.identityId ?? null);
const getSideToMoveSeat = (game) => (game.board?.state?.sideToMove === "P1" ? "Player 1" : "Player 2");
const getCurrentTurn = (game) => game.currentTurn ?? game.turns?.[game.turns.length - 1] ?? null;

const getControlSeatForTurn = (state, turnOwnerSeat) => {
  const continuation = state?.continuation;
  if (!continuation) {
    return turnOwnerSeat;
  }
  if (continuation.type === "push" && continuation.phase === "retreat") {
    return getNextSeat(turnOwnerSeat);
  }
  return turnOwnerSeat;
};

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

const completeTurn = (game, queuedAt) => {
  const activeTurn = getCurrentTurn(game);
  if (!activeTurn) {
    return { ok: false, error: "turn_not_initialized" };
  }
  if (!Array.isArray(activeTurn.moveIndexes) || activeTurn.moveIndexes.length === 0) {
    return { ok: false, error: "turn_has_no_moves" };
  }

  const endedAt = queuedAt;
  activeTurn.endedAt = endedAt;
  activeTurn.status = "complete";
  const nextSeat = getNextSeat(activeTurn.playerSeat);
  const nextTurn = {
    index: activeTurn.index + 1,
    startedAt: endedAt,
    endedAt: null,
    playerSeat: nextSeat,
    status: "active",
    moveIndexes: [],
    lastMoveAt: null,
  };
  game.currentTurn = nextTurn;
  game.board.state = resolveToStability(
    {
      ...game.board.state,
      sideToMove: getSideForSeat(nextSeat),
      turnIndex: nextTurn.index,
      continuation: null,
      pieces: game.board.state.pieces.map((piece) => ({
        ...piece,
        shifted: false,
        pushed: false,
      })),
    },
    { artifactMode: "full" },
  );
  game.currentSnapshot = clone(game.board.state);
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
  const activeTurn = getCurrentTurn(next);
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
  next.currentSnapshot = clone(next.board.state);
  next.canRecordMove = isPlayer && controlIdentity === identityId && liveLegalActions.length > 0;
  next.canEndTurn = isPlayer && turnOwnerIdentity === identityId && Boolean(activeTurn?.moveIndexes?.length);
  next.validatedMoveCount = authoritativeGame.validatedMoveCount ?? 0;
  next.validatedTurnCount = authoritativeGame.validatedTurnCount ?? 0;
  return next;
};

export const projectOptimisticGame = ({ authoritativeGame, identityId, queue, validatedMoveCount = 0 }) => {
  const workingGame = clone(authoritativeGame);
  workingGame.board = {
    ...(workingGame.board ?? {}),
    state: clone(authoritativeGame.board?.state ?? authoritativeGame.currentSnapshot),
  };
  workingGame.currentTurn = clone(getCurrentTurn(authoritativeGame));

  const pendingMoves = [];
  const commandResults = new Map();

  for (const command of queue) {
    if (command.kind === "apply") {
      const activeTurn = getCurrentTurn(workingGame);
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
      nextStable.sideToMove = getSideForSeat(getControlSeatForTurn(nextStable, activeTurn.playerSeat));
      nextStable.turnIndex = activeTurn.index;

      activeTurn.moveIndexes = [...(activeTurn.moveIndexes ?? []), validatedMoveCount + pendingMoves.length];
      activeTurn.lastMoveAt = command.queuedAt;
      workingGame.currentTurn = activeTurn;
      workingGame.board.state = nextStable;
      workingGame.currentSnapshot = clone(nextStable);
      workingGame.lastMoveAt = command.queuedAt;
      workingGame.updatedAt = command.queuedAt;

      const pendingMove = buildPendingMoveEntry({
        command,
        selectionSnapshot: stable,
        snapshot: nextStable,
        activeTurn,
        index: validatedMoveCount + pendingMoves.length,
      });
      pendingMoves.push(pendingMove);
      commandResults.set(command.clientCommandId, {
        accepted: true,
        state: clone(nextStable),
        legalActions: listLegalActions(nextStable),
        removedPieces,
        outcome: nextStable.outcome ?? null,
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
