export const DOCUMENT_ICON = Object.freeze({
  base: "./favicon-marble.svg",
  attention: "./favicon-attention.svg",
});

// This presentation gate consumes the app's final action-authority answer. It
// never infers authority from turn color, legal actions, or unseen updates.
export const actionAwaitsPlayer = ({ currentGame = false, canControl = false, ownsActor = false, computerTurn = false } = {}) =>
  Boolean(currentGame && canControl && ownsActor && !computerTurn);

export const createDocumentIconOwner = ({ documentObject = document } = {}) => {
  let attention = null;
  const sync = (nextAttention) => {
    const next = nextAttention === true;
    const link = documentObject.querySelector?.("#righelt-favicon");
    if (!link) return false;
    const href = next ? DOCUMENT_ICON.attention : DOCUMENT_ICON.base;
    if (attention === next && link.getAttribute("href") === href) return false;
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    attention = next;
    return true;
  };
  return { sync, snapshot: () => ({ attention: attention === true }) };
};
