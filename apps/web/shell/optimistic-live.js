import { computerProfileFor } from '../generated/packages/shared-types/src/computer-play.js';
import { destructionRecords, removalNotices } from "../generated/packages/game-engine/src/removals.js";
export { collectDestroyedPieceRecords } from "../generated/packages/game-engine/src/removals.js";
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
  if (action?.type === "end_turn") return "END TURN";
  if (action?.type === "pass") {
    return "PASS";
  }
  return `${String(action?.type || "move").toUpperCase()} ${formatCoordinate(action?.from)} -> ${formatCoordinate(action?.to)}`;
};

const completeTurn = (game, queuedAt, pendingMoves, operationId) => {
  const events = [];
  const activeTurn = getActiveTurn(game);
  if (!activeTurn) {
    return { ok: false, error: "turn_not_initialized" };
  }
  if (activeTurn.moveIndexes.length === 0 && !game.board.state.continuation) {
    return { ok: false, error: "turn_has_no_moves" };
  }

  const validation = validateAction(game.board.state, { type: "end_turn" });
  if (!validation.ok) return { ok: false, error: validation.code, validation };
  const closed = applyAction(game.board.state, { type: "end_turn" }).state;
  const endedAt = queuedAt;
  activeTurn.endedAt = endedAt;
  activeTurn.status = "complete";
  const { nextState, nextTurn } = finalizeResolvedTurn({
    state: closed,
    activeTurn,
    endedAt,
    resolveToStability,
    onRemoval: (event) => events.push(event),
  });
  const lastMove = [...game.moves, ...pendingMoves].reverse().find((move) => !move.undone && move.turnIndex === activeTurn.index);
  if (lastMove) {
    lastMove.snapshot = clone(nextState);
    lastMove.destroyedPieces = [...(lastMove.destroyedPieces ?? []), ...destructionRecords(events, operationId)];
  }
  game.turns.push(nextTurn);
  game.board.state = nextState;
  game.updatedAt = endedAt;
  return { ok: true, nextTurn, events };
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
  if (next.awaitingCreation) { next.sharedMutationsBlocked = true; }
  next.computerTurn = computerProfileFor(next.computer, getSideForSeat(controlSeat), activeTurn?.index ?? next.board.state.turnIndex ?? 0);
  next.canRecordMove = !next.awaitingCreation && !next.computerTurn && isPlayer && !next.inHistoryMode && controlIdentity === identityId && liveLegalActions.length > 0;
  next.canEndTurn =
    !next.computerTurn && isPlayer &&
    !next.inHistoryMode &&
    controlSeat === turnOwnerSeat &&
    turnOwnerIdentity === identityId &&
    validateAction(next.board.state, { type: "end_turn" }).ok;
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
    if (command.kind === "apply" && command.action?.type !== "end_turn") {
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

      const events = [];
      const onRemoval = (event) => events.push(event);
      const applied = applyAction(stable, command.action, { onRemoval });
      const nextStable = resolveToStability(applied.state, { artifactMode: "full", onRemoval });
      const turnSettled = nextStable.continuation == null;
      const finalizedTurn = turnSettled
        ? finalizeResolvedTurn({
            state: nextStable,
            activeTurn,
            endedAt: command.queuedAt,
            resolveToStability,
            onRemoval,
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
      pendingMove.destroyedPieces = destructionRecords(events, command.clientCommandId);
      pendingMoves.push(pendingMove);
      commandResults.set(command.clientCommandId, {
        accepted: true,
        state: clone(settledState),
        legalActions: listLegalActions(settledState),
        removedPieces: removalNotices(events, command.clientCommandId),
        destroyedPieces: destructionRecords(events, command.clientCommandId),
        outcome: settledState.outcome ?? null,
      });
      continue;
    }

    const ended = completeTurn(workingGame, command.queuedAt, pendingMoves, command.clientCommandId);
    if (!ended.ok) {
      return { ok: false, error: ended.error, clientCommandId: command.clientCommandId };
    }
    commandResults.set(command.clientCommandId, {
      accepted: true,
      removedPieces: removalNotices(ended.events, command.clientCommandId),
      destroyedPieces: destructionRecords(ended.events, command.clientCommandId),
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
