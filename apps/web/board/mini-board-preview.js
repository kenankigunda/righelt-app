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

export const createMiniBoardPreview = ({ rootEl, snapshot, previewKey, createAdapter, sizeVariant = "compact" }) => {
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

  const renderPreview = (nextSnapshot, nextPreviewKey) => {
    if (!nextSnapshot) {
      elements.boardEl.replaceChildren();
      elements.overlayLinesEl.replaceChildren();
      lastPreviewKey = nextPreviewKey;
      return;
    }
    adapter.render({
      snapshot: nextSnapshot,
      selection: { selectedPieceId: null, source: null, target: null },
      overlay: { mode: "none" },
      legalActions: [],
      selectedPieceMoves: [],
      selectedPieceMovePreviews: [],
      removalEffects: [],
      allowFreeSelection: false,
      currentActionType: "pass",
      interactionMode: "static",
    });
    lastPreviewKey = nextPreviewKey;
  };

  renderPreview(snapshot, previewKey);

  return {
    update(nextSnapshot, nextPreviewKey) {
      if (nextPreviewKey === lastPreviewKey) {
        return;
      }
      renderPreview(nextSnapshot, nextPreviewKey);
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
      existing.update(preview.snapshot ?? null, preview.previewKey ?? "null");
      continue;
    }

    registry.set(
      preview.rootEl,
      createMiniBoardPreview({
        rootEl: preview.rootEl,
        snapshot: preview.snapshot ?? null,
        previewKey: preview.previewKey ?? "null",
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
