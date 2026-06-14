import { DEFAULT_ACTION_TYPE } from "../interaction.js";

const DEFAULT_SELECTION = { selectedPieceId: null, source: null, target: null };
const DEFAULT_OVERLAY = { mode: "none" };

const createPreviewElements = ({ rootEl, sizeVariant = "compact" }) => {
  rootEl.replaceChildren();
  rootEl.classList.add("mini-board-preview-root");
  rootEl.setAttribute("data-preview-size-variant", sizeVariant);

  const wrapEl = document.createElement("div");
  wrapEl.className = "board-wrap mini-board-preview-wrap";

  const boardEl = document.createElement("div");
  boardEl.className = "board mini-board-preview-board";
  boardEl.setAttribute("aria-hidden", "true");

  const overlayLinesEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlayLinesEl.classList.add("overlay-lines", "mini-board-preview-overlay");
  overlayLinesEl.setAttribute("aria-hidden", "true");

  wrapEl.appendChild(boardEl);
  wrapEl.appendChild(overlayLinesEl);
  rootEl.appendChild(wrapEl);

  return { boardEl, overlayLinesEl };
};

const normalizePreviewPayload = (payload) => ({
  snapshot: payload?.snapshot ?? null,
  selection: payload?.selection ?? DEFAULT_SELECTION,
  overlay: payload?.overlay ?? DEFAULT_OVERLAY,
  legalActions: Array.isArray(payload?.legalActions) ? payload.legalActions : [],
  selectedPieceId: payload?.selectedPieceId ?? payload?.selection?.selectedPieceId ?? null,
  selectedPieceMoves: Array.isArray(payload?.selectedPieceMoves) ? payload.selectedPieceMoves : [],
  selectedPieceMovePreviews: Array.isArray(payload?.selectedPieceMovePreviews) ? payload.selectedPieceMovePreviews : [],
  currentActionType: payload?.currentActionType ?? DEFAULT_ACTION_TYPE,
  selectedPieceOverlayPhase: payload?.selectedPieceOverlayPhase ?? "actionPreviews",
  previewKey: payload?.previewKey ?? "null",
});

export const createMiniBoardPreview = ({ rootEl, preview, createAdapter, sizeVariant = "compact" }) => {
  if (!(rootEl instanceof HTMLElement)) {
    throw new Error("Mini board preview root must be an element");
  }
  if (typeof createAdapter !== "function") {
    throw new Error("Mini board preview requires an adapter factory");
  }

  const adapter = createAdapter();
  const elements = createPreviewElements({ rootEl, sizeVariant });
  let lastPreviewKey = null;

  adapter.mount({
    boardEl: elements.boardEl,
    overlayLinesEl: elements.overlayLinesEl,
    interactionMode: "static",
    onCellClick: () => {},
  });

  const renderPreview = (nextPreview) => {
    const normalized = normalizePreviewPayload(nextPreview);
    if (!normalized.snapshot) {
      elements.boardEl.replaceChildren();
      elements.overlayLinesEl.replaceChildren();
      lastPreviewKey = normalized.previewKey;
      return;
    }
    adapter.render({
      snapshot: normalized.snapshot,
      selection: normalized.selection,
      overlay: normalized.overlay,
      legalActions: normalized.legalActions,
      selectedPieceId: normalized.selectedPieceId,
      selectedPieceMoves: normalized.selectedPieceMoves,
      selectedPieceMovePreviews: normalized.selectedPieceMovePreviews,
      removalEffects: [],
      allowFreeSelection: false,
      currentActionType: normalized.currentActionType,
      selectedPieceOverlayPhase: normalized.selectedPieceOverlayPhase,
      interactionMode: "static",
    });
    lastPreviewKey = normalized.previewKey;
  };

  renderPreview(preview);

  return {
    update(nextPreview) {
      const normalized = normalizePreviewPayload(nextPreview);
      if (normalized.previewKey === lastPreviewKey) {
        return;
      }
      renderPreview(normalized);
    },
    destroy() {
      adapter.unmount();
      rootEl.replaceChildren();
      rootEl.classList.remove("mini-board-preview-root");
      rootEl.removeAttribute("data-preview-size-variant");
    },
  };
};

export const syncMiniBoardPreviews = ({ previews, registry, createAdapter }) => {
  const nextRoots = new Set();

  for (const preview of Array.isArray(previews) ? previews : []) {
    if (!(preview?.rootEl instanceof HTMLElement)) {
      continue;
    }
    nextRoots.add(preview.rootEl);

    const existing = registry.get(preview.rootEl);
    if (existing) {
      existing.update(preview);
      continue;
    }

    registry.set(
      preview.rootEl,
      createMiniBoardPreview({
        rootEl: preview.rootEl,
        preview,
        createAdapter,
        sizeVariant: preview.sizeVariant ?? "compact",
      }),
    );
  }

  for (const [rootEl, preview] of registry.entries()) {
    if (nextRoots.has(rootEl)) {
      continue;
    }
    preview.destroy();
    registry.delete(rootEl);
  }
};
