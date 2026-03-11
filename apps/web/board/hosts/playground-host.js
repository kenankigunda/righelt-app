import { buildPieceMoveResponse, getStateKey } from "../client-move-generation.js";

export const createPlaygroundBoardHost = (fetcher = fetch) => ({
  _cachedStateKey: null,
  _cachedState: null,
  _cachedLegalActions: [],
  _cacheResponse(body) {
    this._cachedState = body?.state ?? null;
    this._cachedStateKey = getStateKey(this._cachedState);
    this._cachedLegalActions = Array.isArray(body?.legalActions) ? body.legalActions : [];
    return body;
  },
  async loadInitialState() {
    const response = await fetcher("/api/engine/playground/state", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load initial state: HTTP ${response.status}`);
    }
    return this._cacheResponse(await response.json());
  },
  async loadLegalActions(state) {
    if (this._cachedStateKey === getStateKey(state)) {
      return {
        ok: true,
        state: this._cachedState ?? state,
        legalActions: this._cachedLegalActions,
      };
    }
    const response = await fetcher("/api/engine/playground/legal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch legal actions: HTTP ${response.status}`);
    }
    return this._cacheResponse(await response.json());
  },
  async loadPieceMoves(state, pieceId) {
    const stateKey = getStateKey(state);
    if (this._cachedStateKey !== stateKey) {
      await this.loadLegalActions(state);
    }
    return buildPieceMoveResponse({
      state: this._cachedStateKey === stateKey ? (this._cachedState ?? state) : state,
      legalActions: this._cachedLegalActions,
      pieceId,
    });
  },
  async applyAction(state, action) {
    const response = await fetcher("/api/engine/playground/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, action }),
    });
    return this._cacheResponse(await response.json());
  },
  async endTurn(state) {
    const response = await fetcher("/api/engine/playground/end-turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    return this._cacheResponse(await response.json());
  },
  canInteract() {
    return true;
  },
});
