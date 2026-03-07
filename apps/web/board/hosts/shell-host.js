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
    if (action?.type === "pass") {
      const current = transport.getGameViewModel(gameId);
      if (!current?.canEndTurn) {
        return {
          ok: true,
          accepted: false,
          validation: { ok: false, code: "turn_has_no_moves", message: "Turn has no moves to end yet." },
          state,
          legalActions: Array.isArray(current?.legalActions) ? current.legalActions : [],
        };
      }
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
      };
    }
    return transport.applyGameAction({ gameId, state, action });
  },
  canInteract,
});
