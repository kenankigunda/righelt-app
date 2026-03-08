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

export const createShellBoardHost = ({ transport, gameId, canInteract }) => ({
  async loadInitialState() {
    const game = transport.getGameViewModel(gameId);
    return {
      state: game?.currentSnapshot ?? null,
      legalActions: Array.isArray(game?.legalActions) ? game.legalActions : [],
    };
  },
  async loadLegalActions(state) {
    return transport.loadGameLegalActions({ gameId, state });
  },
  async loadPieceMoves(state, pieceId) {
    return transport.loadGamePieceMoves({ gameId, state, pieceId });
  },
  async applyAction(state, action) {
    const response = await transport.applyGameAction({ gameId, state, action });
    if (response?.accepted) {
      const current = response.game ?? transport.getGameViewModel(gameId);
      return {
        ...response,
        boardMessage: {
          type: "move_sent",
          control: getControlLabel({ state: response.state, currentTurn: current?.currentTurn }),
        },
      };
    }
    return response;
  },
  async endTurn(state) {
    try {
      const result = await transport.endTurn({ gameId });
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
