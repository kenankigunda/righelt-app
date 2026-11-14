import { createRulesExecutor } from "../rules-runtime.js";

const getControlLabel = ({ state, currentTurn }) => {
  if (!state || !currentTurn) {
    return "turn-owner";
  }
  const continuation = state.continuation;
  if (continuation?.type === "push" && continuation.phase === "retreat") {
    return "opponent";
  }
  return "turn-owner";
};

const unwrapOperationResult = async (value) => {
  const resolved = await value;
  if (resolved && typeof resolved === "object" && "result" in resolved && "committed" in resolved) {
    return resolved.result;
  }
  return resolved;
};

const samePosition = (left, right) =>
  left?.row === right?.row && left?.col === right?.col;

export const getPendingRecordingPieceIds = (game) => {
  const pending = Array.isArray(game?.pendingMoves) ? game.pendingMoves : [];
  const visibleIds = new Set((game?.currentSnapshot?.pieces ?? []).map((piece) => piece.id));
  const affected = new Set();
  for (const move of pending) {
    if (move?.undone) continue;
    const beforeById = new Map((move?.selectionSnapshot?.pieces ?? []).map((piece) => [piece.id, piece]));
    for (const piece of move?.snapshot?.pieces ?? []) {
      const before = beforeById.get(piece.id);
      if ((!before || !samePosition(before.position, piece.position)) && visibleIds.has(piece.id)) {
        affected.add(piece.id);
      }
    }
  }
  return affected;
};

export const createShellBoardHost = ({ transport, gameId, canInteract, canPresentActions, canSelect, getMutationSurface, getInspectionSnapshot = () => null, getGameView = () => transport.getGameViewModel(gameId), rulesExecutor = createRulesExecutor() }) => ({
  confirmedRemovalsOnly: true,
  getPendingRemovalEffects: () => (getGameView()?.pendingMoves ?? []).filter(move => !move.undone).flatMap(move => move.destroyedPieces ?? []),
  getPendingRecordingPieceIds: () => getPendingRecordingPieceIds(getGameView()),
  asyncPieceMoves: rulesExecutor.asynchronous,
  cancelPieceMoves: () => rulesExecutor.cancelAll(),
  async loadInitialState() {
    const game = getGameView();
    const legalActions = Array.isArray(game?.legalActions) ? game.legalActions : [];
    return {
      state: game?.currentSnapshot ?? null,
      legalActions,
    };
  },
  async loadLegalActions(state) {
    const inspection = getInspectionSnapshot();
    if (inspection) return { ok: true, state: inspection, legalActions: [] };
    const game = getGameView();
    return {
      ok: true,
      state: game?.currentSnapshot ?? state,
      legalActions: Array.isArray(game?.legalActions) ? game.legalActions : [],
    };
  },
  async loadPieceMoves(state, pieceId) {
    const inspection = getInspectionSnapshot();
    if (inspection) return rulesExecutor.previews("piece", { state: inspection, legalActions: [], pieceId });
    const game = getGameView();
    const snapshot = game?.currentSnapshot ?? state;
    const legalActions = Array.isArray(game?.legalActions) ? game.legalActions : [];
    return rulesExecutor.previews("piece", { state: snapshot, legalActions, pieceId });
  },
  async applyAction(state, action) {
    if (getInspectionSnapshot()) return { accepted: false, validation: { code: 'inspection_only' }, state, legalActions: [] };
    const response = await unwrapOperationResult(transport.applyGameAction({ gameId, state, action }));
    if (response?.accepted) {
      const current = response.game ?? getGameView();
      const snapshot = current?.currentSnapshot ?? response.state ?? state;
      const legalActions = Array.isArray(current?.legalActions)
        ? current.legalActions
        : Array.isArray(response.legalActions)
          ? response.legalActions
          : [];
      const turnChanged = state?.sideToMove !== snapshot?.sideToMove || state?.turnIndex !== snapshot?.turnIndex;
      return {
        ...response,
        state: snapshot,
        legalActions,
        boardMessage: {
          type: turnChanged ? "turn_ended" : "move_sent",
          control: getControlLabel({ state: snapshot, currentTurn: current?.currentTurn }),
        },
      };
    }
    return response;
  },
  async endTurn(state) {
    if (getInspectionSnapshot()) return { accepted: false, validation: { code: 'inspection_only' }, state, legalActions: [] };
    try {
      const result = await unwrapOperationResult(transport.endTurn({ gameId }));
      const game = result?.game ?? getGameView();
      const snapshot = game?.currentSnapshot ?? state;
      const legalActions = Array.isArray(game?.legalActions) ? game.legalActions : [];
      return {
        ok: true,
        accepted: true,
        state: snapshot,
        legalActions,
        outcome: snapshot?.outcome ?? null,
        removedPieces: result?.removedPieces ?? [],
        destroyedPieces: result?.destroyedPieces ?? [],
        clientCommandId: result?.clientCommandId,
        boardMessage: { type: "turn_ended" },
      };
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "end_turn_failed";
      const current = getGameView();
      return {
        ok: true,
        accepted: false,
        validation: { ok: false, code, message: "Turn could not be ended." },
        state: current?.currentSnapshot ?? state,
        legalActions: Array.isArray(current?.legalActions) ? current.legalActions : [],
      };
    }
  },
  canInteract,
  canPresentActions,
  canSelect: canSelect ?? canInteract,
  getMutationSurface,
});
