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
