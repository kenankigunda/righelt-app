export const createPlaygroundBoardHost = (fetcher = fetch) => ({
  async loadInitialState() {
    const response = await fetcher("/api/engine/playground/state", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load initial state: HTTP ${response.status}`);
    }
    return response.json();
  },
  async loadLegalActions(state) {
    const response = await fetcher("/api/engine/playground/legal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch legal actions: HTTP ${response.status}`);
    }
    return response.json();
  },
  async loadPieceMoves(state, pieceId) {
    const response = await fetcher("/api/engine/playground/piece-moves", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, pieceId }),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch selected piece moves: HTTP ${response.status}`);
    }
    return response.json();
  },
  async applyAction(state, action) {
    const response = await fetcher("/api/engine/playground/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, action }),
    });
    return response.json();
  },
  async endTurn(state) {
    const response = await fetcher("/api/engine/playground/end-turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    return response.json();
  },
  canInteract() {
    return true;
  },
});
