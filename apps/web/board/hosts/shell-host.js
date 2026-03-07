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
    return transport.applyGameAction({ gameId, state, action });
  },
  canInteract,
});
