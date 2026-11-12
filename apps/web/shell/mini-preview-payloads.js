// Mounted shell roots own payloads; rendering uncommitted markup does not.
export const collectMountedMiniPreviewPayloads = ({ appEl, payloads }) => {
  const mountedIds = new Set();
  const previews = [];
  for (const rootEl of appEl.querySelectorAll("[data-mini-board-preview]")) {
    if (!(rootEl instanceof HTMLElement)) continue;
    const previewId = rootEl.getAttribute("data-preview-id");
    const payload = previewId ? payloads.get(previewId) : null;
    if (!payload) continue;
    mountedIds.add(previewId);
    previews.push({ rootEl, ...payload });
  }

  // Collect every root first, including duplicate IDs and retained/closing DOM.
  // Never rewrite the payload objects or the models they reference.
  for (const previewId of payloads.keys()) {
    if (!mountedIds.has(previewId)) payloads.delete(previewId);
  }
  return previews;
};

// Rendering registers fresh acknowledged preview references; mounted DOM alone
// determines which registrations survive reconciliation.
export const createMiniPreviewRendering = ({ payloads, escapeHtml }) => {
const registerMiniBoardPreview = ({
  previewId,
  snapshot,
  selection = null,
  overlay = { mode: "none" },
  legalActions = [],
  selectedPieceId = null,
  selectedPieceMoves = [],
  selectedPieceMovePreviews = [],
  currentActionType = "pass",
  selectedPieceOverlayPhase = "actionPreviews",
  previewKey,
  sizeVariant = "compact",
}) => {
  payloads.set(previewId, {
    snapshot: snapshot ?? null,
    selection: selection ?? null,
    overlay,
    legalActions,
    selectedPieceId,
    selectedPieceMoves,
    selectedPieceMovePreviews,
    currentActionType,
    selectedPieceOverlayPhase,
    previewKey,
    sizeVariant,
  });
  return previewId;
};

const renderMiniBoardPreviewRoot = ({
  previewId,
  snapshot,
  selection = null,
  overlay = { mode: "none" },
  legalActions = [],
  selectedPieceId = null,
  selectedPieceMoves = [],
  selectedPieceMovePreviews = [],
  currentActionType = "pass",
  selectedPieceOverlayPhase = "actionPreviews",
  previewKey,
  sizeVariant = "compact",
}) => {
  const stablePreviewId = registerMiniBoardPreview({
    previewId,
    snapshot,
    selection,
    overlay,
    legalActions,
    selectedPieceId,
    selectedPieceMoves,
    selectedPieceMovePreviews,
    currentActionType,
    selectedPieceOverlayPhase,
    previewKey,
    sizeVariant,
  });
  return `<div class="mini-board-preview-surface" data-mini-board-preview data-preview-id="${escapeHtml(stablePreviewId)}"></div>`;
};

  return { renderMiniBoardPreviewRoot };
};
