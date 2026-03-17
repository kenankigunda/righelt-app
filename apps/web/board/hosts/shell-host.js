import { buildPieceMoveResponse } from "../client-move-generation.js";

const getControlLabel = ({ game }) => {
  if (!game?.currentTurn) {
    return "turn-owner";
  }
  const controlSeat = typeof game.controlSeat === "string" ? game.controlSeat : game.currentTurn.playerSeat;
  return controlSeat === game.currentTurn.playerSeat ? "turn-owner" : "opponent";
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
    const response = await transport.applyGameAction({ gameId, state, action });
    if (response?.accepted) {
      const current = response.game ?? transport.getGameViewModel(gameId);
      const snapshot = current?.currentSnapshot ?? response.state ?? state;
      const legalActions = Array.isArray(current?.legalActions)
        ? current.legalActions
        : Array.isArray(response.legalActions)
          ? response.legalActions
          : [];
      return {
        ...response,
        state: snapshot,
        legalActions,
        boardMessage: {
          type: "move_sent",
          control: getControlLabel({ game: current }),
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
