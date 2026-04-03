import { buildPieceMoveResponse } from "../client-move-generation.js";

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

export const createShellBoardHost = ({ transport, gameId, canInteract }) => ({
  async loadInitialState() {
    const game = transport.getGameViewModel(gameId);
    const legalActions = Array.isArray(game?.legalActions) ? game.legalActions : [];
    return {
      state: game?.currentSnapshot ?? null,
      legalActions,
    };
  },
  async loadLegalActions(state) {
    const game = transport.getGameViewModel(gameId);
    return {
      ok: true,
      state: game?.currentSnapshot ?? state,
      legalActions: Array.isArray(game?.legalActions) ? game.legalActions : [],
    };
  },
  async loadPieceMoves(state, pieceId) {
    const game = transport.getGameViewModel(gameId);
    const snapshot = game?.currentSnapshot ?? state;
    const legalActions = Array.isArray(game?.legalActions) ? game.legalActions : [];
    return buildPieceMoveResponse({ state: snapshot, legalActions, pieceId });
  },
  async applyAction(state, action) {
    const response = await unwrapOperationResult(transport.applyGameAction({ gameId, state, action }));
    if (response?.accepted) {
      const current = response.game ?? transport.getGameViewModel(gameId);
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
    try {
      const result = await unwrapOperationResult(transport.endTurn({ gameId }));
      const game = result?.game ?? transport.getGameViewModel(gameId);
      const snapshot = game?.currentSnapshot ?? state;
      const legalActions = Array.isArray(game?.legalActions) ? game.legalActions : [];
      return {
        ok: true,
        accepted: true,
        state: snapshot,
        legalActions,
        outcome: snapshot?.outcome ?? null,
        boardMessage: { type: "turn_ended" },
      };
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "end_turn_failed";
      const current = transport.getGameViewModel(gameId);
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
});
