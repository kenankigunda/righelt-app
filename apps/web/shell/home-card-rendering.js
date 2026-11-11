import {isTerminalOutcome} from './game-lifecycle.js';
import {homeCardResult} from './home-card-result.js';
import {renderHomeCardIdentity,renderHomeCardTurn} from './home-card-identity.js';
export const formatSideToMoveLabel = (snapshot) => {
  if (snapshot?.sideToMove === "P1") {
    return "Red to play";
  }
  if (snapshot?.sideToMove === "P2") {
    return "Blue to play";
  }
  return "Turn unknown";
};

export const getStaticCardPreviewSnapshot = (card) => card?.previewSnapshot ?? null;
export const getStaticCardPreviewSelection = (card) =>
  card?.previewSelection?.source
    ? {
        selectedPieceId: null,
        source: card.previewSelection.source,
        target: card.previewSelection.target ?? null,
      }
    : null;
export const getStaticCardPreviewPayload = (card) => ({
  snapshot: getStaticCardPreviewSnapshot(card),
  selection: getStaticCardPreviewSelection(card),
  overlay: { mode: "none" },
  legalActions: [],
  selectedPieceId: null,
  selectedPieceMoves: [],
  selectedPieceMovePreviews: [],
  currentActionType: "pass",
  selectedPieceOverlayPhase: "actionPreviews",
});

/** Scenario miniatures describe that preview position, never live authority. */
export function scenarioPreviewStatus(game,snapshot) {
  if(!snapshot)return {statusText:'Snapshot unavailable',statusMarkup:null};
  if(isTerminalOutcome(snapshot.outcome?.status))return {statusText:'Preview finished',statusMarkup:null};
  if(snapshot.outcome?.status!=='ongoing')return {statusText:'Preview status unavailable',statusMarkup:null};
  return {
    statusText:`Preview: ${formatSideToMoveLabel(snapshot)}`,
    statusMarkup:game ? `Preview: ${renderHomeCardTurn(game,snapshot)}` : null,
  };
}

/** Render acknowledged Home cards and static previews without changing authority. */
export function createHomeCardRendering({getTransport,toStableKey,escapeHtml,renderMiniBoardPreviewRoot,buildGameHash,getCurrentFlyoutState,formatDisplayGameId,formatClientDateTime}) {
const renderStaticMiniBoardCard = ({ card, variant = "home", href = null, flyoutLink = null, gameId = null, header, meta, statusText, winnerSide = null, statusMarkup = null }) => {
  const previewPayload = card?.previewPayload ?? getStaticCardPreviewPayload(card);
  const previewKey = toStableKey({
    snapshot: previewPayload.snapshot,
    selection: previewPayload.selection,
    overlay: previewPayload.overlay,
    legalActions: previewPayload.legalActions,
    selectedPieceId: previewPayload.selectedPieceId,
    selectedPieceMoves: previewPayload.selectedPieceMoves,
    selectedPieceMovePreviews: previewPayload.selectedPieceMovePreviews,
    currentActionType: previewPayload.currentActionType,
    selectedPieceOverlayPhase: previewPayload.selectedPieceOverlayPhase,
  });
  const body = `<div class="mini-board-card-header">
      ${header}
    </div>
    <div class="mini-board-card-copy">
      ${meta}
    </div>
    ${renderMiniBoardPreviewRoot({
      previewId: `${variant}:${card.id}`,
      snapshot: previewPayload.snapshot,
      selection: previewPayload.selection,
      overlay: previewPayload.overlay,
      legalActions: previewPayload.legalActions,
      selectedPieceId: previewPayload.selectedPieceId,
      selectedPieceMoves: previewPayload.selectedPieceMoves,
      selectedPieceMovePreviews: previewPayload.selectedPieceMovePreviews,
      currentActionType: previewPayload.currentActionType,
      selectedPieceOverlayPhase: previewPayload.selectedPieceOverlayPhase,
      previewKey,
      sizeVariant: "compact",
    })}
    <p class="small mini-board-preview-status">${statusMarkup ?? escapeHtml(statusText)}</p>`;
  if (!href) {
    return `<div class="mini-board-card mini-board-card-${escapeHtml(variant)}">${body}</div>`;
  }
  return `<article class="mini-board-card"${winnerSide ? ` data-winner-side="${winnerSide.toLowerCase()}"` : ''}>
    <a
      class="mini-board-card-link-surface"
      href="${href}"
      ${flyoutLink ? `data-flyout-link="${escapeHtml(flyoutLink)}"` : ""}
      ${gameId ? `data-game-id="${escapeHtml(gameId)}"` : ""}
    >
      ${body}
    </a>
  </article>`;
};

const renderHomeGameCard = (game) => {
  const snapshot = getStaticCardPreviewSnapshot(game);
  const result = homeCardResult(game, {identityId:getTransport().getIdentityId()});
  const completed = result.kind === 'completed';
  const statusText = result.kind === 'ongoing' ? snapshot ? formatSideToMoveLabel(snapshot) : "Snapshot unavailable" : result.label;
  const moveLabel = completed ? `${game.moveCount} ${game.moveCount === 1 ? 'move' : 'moves'}` : `Move ${game.moveCount + 1}`;
  const resultHtml = completed ? `<div class="home-card-result${result.winnerSide ? ` player-tone-${result.winnerSide.toLowerCase()}` : ''}"><strong><bdi>${escapeHtml(result.label)}</bdi></strong>${result.detail ? `<span class="small">${escapeHtml(result.detail)}</span>` : ''}</div>` : '';
  const recoveryChip =
    game.pendingPreviewSnapshot ? '<span class="status-chip">Update pending</span>' : game.syncStatus === "desynced" || game.syncStatus === "confirming" ? '<span class="status-chip">Recovering</span>' : "";
  return renderStaticMiniBoardCard({
    card: game,
    href: buildGameHash(game.id, null, getCurrentFlyoutState()),
    flyoutLink: "game",
    gameId: game.id,
    header: `<div>
        <span class="mini-board-card-link">${escapeHtml(formatDisplayGameId(game.id))}</span>
        <p class="small mini-board-card-subtitle">Last move on ${escapeHtml(formatClientDateTime(game.lastMoveAt || game.createdAt))}</p>
      </div>
      ${recoveryChip}`,
    meta: `<div class="mini-board-card-meta mini-board-card-meta-primary">
        ${renderHomeCardIdentity(game, {identityId: getTransport().getIdentityId(), quiet:completed})}
        <span class="small">${escapeHtml(moveLabel)}</span>
      </div>${resultHtml}`,
    statusText: completed ? result.action : result.kind === 'pending' ? `${statusText} · ${result.action}` : statusText,
    winnerSide: completed ? result.winnerSide : null,
    statusMarkup: result.kind === 'ongoing' && snapshot?.outcome?.status === 'ongoing' ? renderHomeCardTurn(game, snapshot) : null,
  });
};

return {renderStaticMiniBoardCard,renderHomeGameCard};
}
