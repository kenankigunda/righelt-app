import { gameDateInlayModel } from "./game-date-inlay.js";
import { celestialMarkMarkup } from "./celestial-mark.js";

export const DOCUMENT_ICON = Object.freeze({
  base: "./favicon-overlap.svg",
  attention: "./favicon-overlap-attention.svg",
});

const escapeXml = (value) => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[character]);

const svgDataUrl = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

export const gameDocumentIconSvg = (startedAt, { attention = false, locale, timeZone } = {}) => {
  const model = gameDateInlayModel(startedAt, { locale, timeZone });
  if (!model) return null;
  const mask = attention
    ? '<defs><mask id="attention-gap"><rect width="64" height="64" fill="white"/><circle cx="51" cy="13" r="9" fill="black"/></mask></defs>'
    : "";
  const contentMask = attention ? ' mask="url(#attention-gap)"' : "";
  const dot = attention ? '<circle cx="51" cy="13" r="6" fill="#d47a16"/>' : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Righelt game started ${escapeXml(model.label)}">${mask}<g${contentMask}><path d="M11 41V14l7-7h28l7 7v27" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity=".78"/><path d="M11 41V14l7-7h28l7 7v27" fill="none" stroke="${model.palette[0]}" stroke-width=".85" stroke-linecap="round" stroke-linejoin="round"/>${celestialMarkMarkup(model, { offset: [8, 4] })}<text x="32" y="23" fill="#27313a" font-family="system-ui,sans-serif" font-size="11" font-weight="650" text-anchor="middle" dominant-baseline="middle">${escapeXml(model.month)}</text><text x="32" y="40" fill="#27313a" font-family="system-ui,sans-serif" font-size="19" font-weight="650" text-anchor="middle" dominant-baseline="middle">${escapeXml(model.day)}</text></g>${dot}</svg>`;
};

export const documentIconHref = ({ startedAt = null, attention = false, locale, timeZone } = {}) => {
  const gameSvg = gameDocumentIconSvg(startedAt, { attention, locale, timeZone });
  return gameSvg ? svgDataUrl(gameSvg) : attention ? DOCUMENT_ICON.attention : DOCUMENT_ICON.base;
};

// This presentation gate consumes the app's final action-authority answer. It
// never infers authority from turn color, legal actions, or unseen updates.
export const actionAwaitsPlayer = ({ currentGame = false, canControl = false, ownsActor = false, computerTurn = false } = {}) =>
  Boolean(currentGame && canControl && ownsActor && !computerTurn);

export const gameDocumentStartedAt = (gameId, currentGame) => {
  if (!gameId || !currentGame || currentGame.id !== gameId) return null;
  return currentGame.createdAt ?? null;
};

export const createDocumentIconOwner = ({ documentObject = document } = {}) => {
  let current = null;
  const sync = (nextState = {}) => {
    const next = typeof nextState === "boolean" ? { attention: nextState } : nextState;
    const link = documentObject.querySelector?.("#righelt-favicon");
    if (!link) return false;
    const href = documentIconHref(next);
    if (current?.href === href && link.getAttribute("href") === href) return false;
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    current = { href, attention: next.attention === true, kind: gameDateInlayModel(next.startedAt) ? "game" : "home" };
    return true;
  };
  return { sync, snapshot: () => current ? { attention: current.attention, kind: current.kind } : { attention: false, kind: "home" } };
};
