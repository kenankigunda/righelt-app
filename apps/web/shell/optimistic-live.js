import {
  applyAction,
  listLegalActions,
  resolveToStability,
  validateAction,
} from "../generated/packages/game-engine/src/index.js";

const clone = (value) => structuredClone(value);
const getSideForSeat = (seat) => (seat === "Player 1" ? "P1" : "P2");
const getNextSeat = (seat) => (seat === "Player 1" ? "Player 2" : "Player 1");
const getActiveTurn = (game) => game.turns?.[game.turns.length - 1] ?? null;
const getSideToMoveSeat = (game) => (game.board?.state?.sideToMove === "P1" ? "Player 1" : "Player 2");
const getSeatIdentity = (game, seat) => (seat === "Player 1" ? game.player1?.identityId ?? null : game.player2?.identityId ?? null);

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

const settleResolvedTurnState = (state) =>
  resolveToStability(
    {
      ...state,
      sideToMove: state.sideToMove === "P1" ? "P2" : "P1",
      turnIndex: (state.turnIndex ?? 0) + 1,
      continuation: null,
      pieces: state.pieces.map((piece) => ({
        ...piece,
        shifted: false,
        pushed: false,
      })),
    },
    { artifactMode: "full" },
  );

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
  game.turns.push(nextTurn);
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

const finalizeProjectedView = ({ authoritativeGame, workingGame, identityId, queue, pendingMoves, liveLegalActions = null }) => {
  const next = clone(workingGame);
  const activeTurn = getActiveTurn(next);
  const turnOwnerSeat = activeTurn?.playerSeat ?? getSideToMoveSeat(next);
  const controlSeat = getControlSeatForTurn(next.board.state, turnOwnerSeat);
  const controlIdentity = getSeatIdentity(next, controlSeat);
  const turnOwnerIdentity = getSeatIdentity(next, turnOwnerSeat);
  const resolvedLegalActions = Array.isArray(liveLegalActions) ? clone(liveLegalActions) : listLegalActions(next.board.state);
  const isPlayer = next.myRole === "Player 1" || next.myRole === "Player 2";

  next.turnOwnerSeat = turnOwnerSeat;
  next.controlSeat = controlSeat;
  next.control = controlSeat === turnOwnerSeat ? "turn-owner" : "opponent";
  next.currentTurn = activeTurn ? clone(activeTurn) : null;
  next.legalActions = resolvedLegalActions;
  next.pendingMoves = pendingMoves.map((move) => clone(move));
  next.pendingCommandCount = queue.length;
  next.liveCurrentSnapshot = clone(next.board.state);
  next.currentSnapshot = next.inHistoryMode ? authoritativeGame.currentSnapshot : clone(next.board.state);
  next.canRecordMove = isPlayer && !next.inHistoryMode && controlIdentity === identityId && resolvedLegalActions.length > 0;
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
  let latestLegalActions = null;

  for (const command of queue) {
    if (command.kind === "apply") {
      const activeTurn = getActiveTurn(workingGame);
      if (!activeTurn) {
        return { ok: false, error: "turn_not_initialized", clientCommandId: command.clientCommandId };
      }

      const stable = workingGame.board.state;
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
      const settledState = nextStable.continuation == null ? settleResolvedTurnState(nextStable) : nextStable;
      const removedPieces = collectRemovedPieceNotices(stable, applied.state, nextStable, command.action);
      const turnSettled = nextStable.continuation == null;
      const settledLegalActions = listLegalActions(settledState);
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
        workingGame.turns.push({
          index: settledState.turnIndex,
          startedAt: command.queuedAt,
          endedAt: null,
          playerSeat: getSideToMoveSeat({ board: { state: settledState } }),
          status: "active",
          moveIndexes: [],
          lastMoveAt: null,
        });
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
        legalActions: settledLegalActions,
        removedPieces,
        outcome: settledState.outcome ?? null,
      });
      latestLegalActions = settledLegalActions;
      continue;
    }

    const ended = completeTurn(workingGame, command.queuedAt);
    if (!ended.ok) {
      return { ok: false, error: ended.error, clientCommandId: command.clientCommandId };
    }
    latestLegalActions = listLegalActions(workingGame.board.state);
    commandResults.set(command.clientCommandId, {
      accepted: true,
      state: clone(workingGame.board.state),
      legalActions: latestLegalActions,
      outcome: workingGame.board.state.outcome ?? null,
    });
  }

  return {
    ok: true,
    game: finalizeProjectedView({ authoritativeGame, workingGame, identityId, queue, pendingMoves, liveLegalActions: latestLegalActions }),
    commandResults,
  };
};
