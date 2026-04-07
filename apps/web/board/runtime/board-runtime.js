import {
  getBlockedPreviewLabel,
  buildActionPayload,
  deriveContinuationHighlightByPieceId,
  deriveAutoSelectedTarget,
  deriveForcedContinuationSelection,
  pickBestActionTypeForTarget,
  shouldAllowSelectionAtTarget,
  shouldResetSelectionOnDocumentClick,
  shouldSubmitOnEnter,
} from "../../interaction.js";
import {
  canCloseContinuationNow,
  getRushContinuationBlockingPiece,
} from "../../generated/packages/game-engine/src/continuation.js";
import { buildPieceMoveResponse } from "../client-move-generation.js";

const PLAYER_TONE_CLASSES = ["player-tone-p1", "player-tone-p2", "player-tone-both", "player-tone-neutral"];

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatCoordinate = (coord) => (coord ? `(${coord.row},${coord.col})` : "unset");
const sameCoordinate = (left, right) => Boolean(left && right && left.row === right.row && left.col === right.col);
const MOBILE_BOARD_PREVIEW_BREAKPOINT_QUERY = "(max-width: 430px)";

const defaultActionType = "pass";
const TARGET_ORIGIN = {
  AUTO: "auto",
  FORCED: "forced",
  HISTORY: "history",
  HOVER: "hover",
  MANUAL: "manual",
};
const OVERLAY_MODE = {
  INTERACTIVE: "interactive",
  NONE: "none",
  RECORDED_ACTION: "recorded-action",
};
const REMOVAL_EFFECT_DURATION_MS = 2400;

const shouldUseCompactBoardPreviewCta = () =>
  globalThis.window?.matchMedia?.(MOBILE_BOARD_PREVIEW_BREAKPOINT_QUERY)?.matches === true;

export function createBoardRuntime({ boardAdapter, host, controls = {} }) {
  let elements = {
    boardEl: null,
    overlayLinesEl: null,
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  };

  let state = null;
  let legalActions = [];
  let selectedPieceMoves = [];
  let selectedPieceMovePreviews = [];
  let selectedPieceMovesLoading = false;
  let removalEffects = [];
  let selectedPieceId = null;
  let selectedSource = null;
  let selectedTarget = null;
  let selectedTargetOrigin = null;
  /** @type {"actionPreviews" | "supplyCommand"} */
  let selectedPieceOverlayPhase = "actionPreviews";
  /** Used so `prime` resets overlay phase only when the selected piece id changes. */
  let lastPhaseInitializedForPieceId = null;
  let autoTargetSuppressed = false;
  let selectedPieceMovesRequestId = 0;
  let mounted = false;
  let removalEffectsTimer = null;
  let internalActionType = defaultActionType;
  let overlayMode = OVERLAY_MODE.INTERACTIVE;
  let lastUsesHoverTargetSelection = null;
  let recordedAction = null;
  let recordedActionStartPiece = null;
  /** @type {Array<{row: number, col: number, ownerSeat?: "p1" | "p2" | null, kind?: "unit" | "commander" | null, piece?: unknown | null}>} */
  let destroyedPieces = [];
  let pendingHistoryDestroyedPieces = [];
  let removalEffectsOnComplete = null;

  const getActionType = () => {
    const value = controls.getActionType?.();
    if (typeof value === "string" && value) {
      internalActionType = value;
      return value;
    }
    return internalActionType;
  };

  const setActionType = (next) => {
    internalActionType = typeof next === "string" && next ? next : defaultActionType;
    if (controls.setActionType) {
      controls.setActionType(internalActionType);
    }
  };

  const getAllowFreeSelection = () => Boolean(controls.getAllowFreeSelection?.());
  const getSupportsHover = () => Boolean(controls.getSupportsHover?.());
  const getUsesHoverTargetSelection = () => getSupportsHover() && !Boolean(controls.getForceClickTargetSelection?.());

  const getCurrentSelection = () => ({ selectedPieceId, source: selectedSource, target: selectedTarget });
  const getOverlay = () => ({
    mode: overlayMode,
    selection: overlayMode === OVERLAY_MODE.INTERACTIVE ? getCurrentSelection() : null,
    recordedAction: overlayMode === OVERLAY_MODE.RECORDED_ACTION ? recordedAction : null,
    recordedActionStartPiece: overlayMode === OVERLAY_MODE.RECORDED_ACTION ? recordedActionStartPiece : null,
    destroyedPieces,
  });

  const getBoardPieceById = (pieceId) => {
    if (!state || !pieceId || typeof boardAdapter.getPieceById !== "function") {
      return null;
    }
    return boardAdapter.getPieceById(state, pieceId) ?? null;
  };

  const hasActionLayer = (moves, previews) =>
    (Array.isArray(previews) ? previews : []).some((action) => Boolean(action?.to)) ||
    (Array.isArray(moves) ? moves : []).some((action) => Boolean(action?.to));

  const canToggleSelectedPieceOverlay = () => {
    if (!state || !selectedPieceId) {
      return false;
    }
    const selectedPiece = getBoardPieceById(selectedPieceId);
    if (!selectedPiece || selectedPiece.owner !== state.sideToMove) {
      return false;
    }
    return hasActionLayer(selectedPieceMoves, selectedPieceMovePreviews);
  };

  const defaultOverlayPhaseForSelection = () => {
    if (!state || !selectedPieceId) {
      return "actionPreviews";
    }
    const selectedPiece = getBoardPieceById(selectedPieceId);
    if (!selectedPiece || selectedPiece.owner !== state.sideToMove) {
      return "supplyCommand";
    }
    return hasActionLayer(selectedPieceMoves, selectedPieceMovePreviews) ? "actionPreviews" : "supplyCommand";
  };

  const getEffectiveSelectedPieceMovesForBoard = () => {
    if (selectedPieceOverlayPhase !== "supplyCommand") {
      return { selectedPieceMoves, selectedPieceMovePreviews };
    }
    const selectedPiece = getBoardPieceById(selectedPieceId);
    const opponentPiece = Boolean(selectedPiece && selectedPiece.owner !== state?.sideToMove);
    if (opponentPiece || canToggleSelectedPieceOverlay()) {
      return { selectedPieceMoves: [], selectedPieceMovePreviews: [] };
    }
    return { selectedPieceMoves, selectedPieceMovePreviews };
  };

  const setSelectedTarget = (target, origin = null) => {
    if (!target) {
      selectedTarget = null;
      selectedTargetOrigin = null;
      return;
    }
    selectedTarget = { ...target };
    selectedTargetOrigin = origin;
  };

  const maybeAutoSelectTarget = (actions, origin = TARGET_ORIGIN.AUTO) => {
    if (selectedTarget || autoTargetSuppressed) {
      return;
    }
    if (selectedPieceOverlayPhase === "supplyCommand" && canToggleSelectedPieceOverlay()) {
      return;
    }
    const autoSelectedTarget = deriveAutoSelectedTarget(actions);
    if (autoSelectedTarget) {
      setSelectedTarget(autoSelectedTarget, origin);
    }
  };

  const setPlayerTone = (element, player) => {
    if (!element) {
      return;
    }
    element.classList.remove(...PLAYER_TONE_CLASSES);
    if (player === "P1") {
      element.classList.add("player-tone-p1");
      return;
    }
    if (player === "P2") {
      element.classList.add("player-tone-p2");
      return;
    }
    element.classList.add("player-tone-neutral");
  };

  const setBoardPreviewPrompt = (text) => {
    if (elements.boardPreviewLabelEl) {
      elements.boardPreviewLabelEl.textContent = text;
    }
  };

  const setBoardPreviewPromptHtml = (html) => {
    if (elements.boardPreviewLabelEl) {
      elements.boardPreviewLabelEl.innerHTML = html;
    }
  };

  const actionPreviewLabel = (actionType, snapshot, destination) => {
    const suffix = destination ? ` (${destination.row},${destination.col})` : "";
    if (snapshot?.continuation?.type === "rush" && actionType === "rush") {
      return `continue rush on${suffix}`;
    }
    if (snapshot?.continuation?.type === "push" && actionType === "follow") {
      return `continue push on${suffix}`;
    }
    switch (actionType) {
      case "move":
        return `move commander to${suffix}`;
      case "project":
        return `project new piece to${suffix}`;
      case "rush":
        return `rush piece to${suffix}`;
      case "push":
        return `push piece onto${suffix}`;
      case "follow":
        return `follow piece to${suffix}`;
      case "retreat":
        return `retreat piece to${suffix}`;
      default:
        return `move to${suffix}`;
    }
  };

  const getContinuationSideChipClass = () => {
    if (state?.sideToMove === "P1") {
      return "board-preview-coordinate-chip-side-p1";
    }
    if (state?.sideToMove === "P2") {
      return "board-preview-coordinate-chip-side-p2";
    }
    return "board-preview-coordinate-chip-side-neutral";
  };

  /** Amber retreat actor chip — matches `.cell.retreat-piece`, not green continuation/square highlight. */
  const getPushRetreatActorCoordinateChipClass = (coord) => {
    if (!coord || state?.continuation?.type !== "push" || state.continuation.phase !== "retreat") {
      return null;
    }
    const pushedId = state.continuation.pushedPieceId;
    const pushedPiece = state.pieces?.find((piece) => piece.id === pushedId);
    if (!pushedPiece || !sameCoordinate(coord, pushedPiece.position)) {
      return null;
    }
    return "board-preview-coordinate-chip-retreat";
  };

  const getContinuationRoleAtCoordinate = (coord, highlights) => {
    const piecesHere = state?.pieces?.filter((piece) => sameCoordinate(piece.position, coord)) ?? [];
    if (piecesHere.length === 0) {
      return null;
    }
    if (piecesHere.some((piece) => highlights.pendingPieceIds.has(piece.id))) {
      return "pending";
    }
    if (piecesHere.some((piece) => highlights.movedPieceIds.has(piece.id))) {
      return "moved";
    }
    return null;
  };

  const getBoardPreviewCoordinateChipClass = (coord) => {
    if (!coord) {
      return "board-preview-coordinate-chip-neutral";
    }

    const rushBlocker = state?.continuation?.type === "rush" ? getRushContinuationBlockingPiece(state) : null;
    if (
      rushBlocker &&
      !sameCoordinate(coord, selectedTarget) &&
      !sameCoordinate(coord, selectedSource) &&
      sameCoordinate(coord, rushBlocker.position)
    ) {
      return "board-preview-coordinate-chip-rush-blocker";
    }

    const retreatActorChipClass = getPushRetreatActorCoordinateChipClass(coord);
    if (retreatActorChipClass) {
      return retreatActorChipClass;
    }

    const continuationHighlights = deriveContinuationHighlightByPieceId(state, legalActions);

    if (selectedTarget && sameCoordinate(coord, selectedTarget)) {
      const targetRole = getContinuationRoleAtCoordinate(coord, continuationHighlights);
      if (targetRole === "pending") {
        return `board-preview-coordinate-chip-continuation-pending ${getContinuationSideChipClass()}`;
      }
      if (targetRole === "moved") {
        return `board-preview-coordinate-chip-continuation-moved ${getContinuationSideChipClass()}`;
      }
      return `board-preview-coordinate-chip-target ${getContinuationSideChipClass()}`;
    }

    if (selectedSource && sameCoordinate(coord, selectedSource)) {
      const actorPiece =
        selectedPieceId && state?.pieces?.find((piece) => piece.id === selectedPieceId);
      const pieceAtSource =
        actorPiece && sameCoordinate(actorPiece.position, selectedSource)
          ? actorPiece
          : state?.pieces?.find((piece) => sameCoordinate(piece.position, selectedSource));
      if (pieceAtSource) {
        if (continuationHighlights.pendingPieceIds.has(pieceAtSource.id)) {
          return `board-preview-coordinate-chip-continuation-pending ${getContinuationSideChipClass()}`;
        }
        if (continuationHighlights.movedPieceIds.has(pieceAtSource.id)) {
          return `board-preview-coordinate-chip-continuation-moved ${getContinuationSideChipClass()}`;
        }
      }
      const ownerTone =
        pieceAtSource?.owner === "P1"
          ? "board-preview-coordinate-chip-selected-piece-p1"
          : pieceAtSource?.owner === "P2"
            ? "board-preview-coordinate-chip-selected-piece-p2"
            : "board-preview-coordinate-chip-selected-piece-neutral";
      return `board-preview-coordinate-chip-selected-piece ${ownerTone}`;
    }

    const otherRole = getContinuationRoleAtCoordinate(coord, continuationHighlights);
    if (otherRole === "pending") {
      return `board-preview-coordinate-chip-continuation-pending ${getContinuationSideChipClass()}`;
    }
    if (otherRole === "moved") {
      return `board-preview-coordinate-chip-continuation-moved ${getContinuationSideChipClass()}`;
    }

    return "board-preview-coordinate-chip-neutral";
  };

  const renderBoardPreviewCoordinate = (coord) => {
    if (!coord) {
      return "";
    }
    const chipClass = getBoardPreviewCoordinateChipClass(coord);
    return `<span class="board-preview-coordinate-chip ${chipClass}">${escapeHtml(`${coord.row},${coord.col}`)}</span>`;
  };

  const setBoardPreviewAction = (text) => {
    if (!elements.boardPreviewLabelEl) {
      return;
    }
    const clickInstruction = getUsesHoverTargetSelection() ? "Click to" : "Click again to";
    const coordinateMatch = text.match(/\(\d+,\d+\)$/);
    if (!coordinateMatch || !selectedTarget) {
      elements.boardPreviewLabelEl.innerHTML = `${clickInstruction} <strong>${escapeHtml(text)}</strong>`;
      return;
    }

    const labelWithoutCoordinate = text.slice(0, coordinateMatch.index).trimEnd();
    elements.boardPreviewLabelEl.innerHTML = `${clickInstruction} <strong>${escapeHtml(labelWithoutCoordinate)} ${renderBoardPreviewCoordinate(selectedTarget)}</strong>`;
  };

  const setRushContinuationPrompt = (snapshot, player) => {
    const toneClass = player === "P1" ? "player-tone-p1" : player === "P2" ? "player-tone-p2" : "player-tone-neutral";
    if (!canCloseContinuationNow(snapshot)) {
      const rushBlocker = getRushContinuationBlockingPiece(snapshot);
      if (rushBlocker) {
        setBoardPreviewPromptHtml(
          `Continue rushing on one of the <span class="board-preview-highlight-chip ${toneClass}">highlighted</span> squares to reconnect your piece at ${renderBoardPreviewCoordinate(rushBlocker.position)}`,
        );
        return;
      }
      setBoardPreviewPromptHtml(
        `Continue rushing on one of the <span class="board-preview-highlight-chip ${toneClass}">highlighted</span> squares`,
      );
      return;
    }
    const endTurnLabel = shouldUseCompactBoardPreviewCta() ? "end turn now" : "end your turn now";
    setBoardPreviewPromptHtml(
      `Continue rushing on one of the <span class="board-preview-highlight-chip ${toneClass}">highlighted</span> squares, or <button type="button" class="board-preview-inline-button" data-board-preview-action="end-turn">${endTurnLabel}</button>`,
    );
  };

  const setPushFollowContinuationPrompt = (player) => {
    const toneClass = player === "P1" ? "player-tone-p1" : player === "P2" ? "player-tone-p2" : "player-tone-neutral";
    setBoardPreviewPromptHtml(
      `Follow your push on one of the <span class="board-preview-highlight-chip ${toneClass}">highlighted</span> squares`,
    );
  };

  const getPushRetreatPrompt = (snapshot, currentPieceId) => {
    if (snapshot?.continuation?.type !== "push" || snapshot.continuation.phase !== "retreat") {
      return null;
    }
    const pushedPiece = snapshot.pieces?.find((piece) => piece.id === snapshot.continuation?.pushedPieceId);
    if (!pushedPiece) {
      return null;
    }
    const suffix = currentPieceId === pushedPiece.id ? "Select a square to retreat to:" : "Select it to retreat:";
    return `Your piece at ${renderBoardPreviewCoordinate(pushedPiece.position)} has been pushed! ${escapeHtml(suffix)}`;
  };

  const clearRemovalEffects = () => {
    removalEffects = [];
    pendingHistoryDestroyedPieces = [];
    removalEffectsOnComplete = null;
    if (removalEffectsTimer) {
      clearTimeout(removalEffectsTimer);
      removalEffectsTimer = null;
    }
  };

  const renderBoard = () => {
    if (!state || !mounted) {
      return;
    }
    const effectiveMoves = getEffectiveSelectedPieceMovesForBoard();
    boardAdapter.render({
      snapshot: state,
      selection: getCurrentSelection(),
      overlay: getOverlay(),
      legalActions,
      selectedPieceMoves: effectiveMoves.selectedPieceMoves,
      selectedPieceMovePreviews: effectiveMoves.selectedPieceMovePreviews,
      removalEffects,
      allowFreeSelection: getAllowFreeSelection(),
      currentActionType: getActionType(),
      selectedPieceOverlayPhase,
    });
  };

  const renderStatus = () => {
    if (!state) {
      return;
    }

    if (elements.boardTurnIndicatorEl) {
      elements.boardTurnIndicatorEl.textContent = state.sideToMove === "P1" ? "Player 1 to play" : "Player 2 to play";
      setPlayerTone(elements.boardTurnIndicatorEl, state.sideToMove);
    }

    const pieceSummary =
      overlayMode === OVERLAY_MODE.INTERACTIVE
        ? boardAdapter.getSelectedPieceSummary({
            snapshot: state,
            overlay: getOverlay(),
            selectedPieceId,
            selectedPieceMoves,
            selectedPieceMovePreviews,
          })
        : null;

    controls.onStateUpdated?.({
      state,
      overlay: getOverlay(),
      legalActions,
      selectedPieceMoves,
      selectedPieceMovePreviews,
      selectedPieceId,
      selectedSource,
      selectedTarget,
      pieceSummary,
      formatCoordinate,
    });

    if (overlayMode === OVERLAY_MODE.RECORDED_ACTION) {
      const recordedActionLabel = recordedAction?.from && recordedAction?.to ? "Showing recorded move." : "Showing history move.";
      setBoardPreviewPrompt(recordedActionLabel);
      return;
    }

    if (!pieceSummary) {
      selectedPieceMoves = [];
      selectedPieceMovePreviews = [];
      const pushRetreatPrompt = getPushRetreatPrompt(state, selectedPieceId);
      if (pushRetreatPrompt) {
        setBoardPreviewPromptHtml(pushRetreatPrompt);
      } else if (state.continuation?.type === "rush") {
        setRushContinuationPrompt(state, state.sideToMove);
      } else if (state.continuation?.type === "push" && state.continuation.phase === "follow") {
        setPushFollowContinuationPrompt(state.sideToMove);
      } else {
        setBoardPreviewPrompt("Select a piece to see what it can do:");
      }
      return;
    }

    const canOverlayToggle =
      pieceSummary.details.owner === state.sideToMove && hasActionLayer(selectedPieceMoves, selectedPieceMovePreviews);

    if (!selectedTarget) {
      const pushRetreatPrompt = getPushRetreatPrompt(state, selectedPieceId);
      if (pushRetreatPrompt) {
        setBoardPreviewPromptHtml(pushRetreatPrompt);
      } else if (pieceSummary.details.owner !== state.sideToMove) {
        if (selectedSource) {
          setBoardPreviewPromptHtml(
            `Opponent piece at ${renderBoardPreviewCoordinate(selectedSource)}. Showing supply & command lines:`,
          );
        } else {
          setBoardPreviewPrompt("Opponent piece. Showing supply & command lines:");
        }
      } else if (!canOverlayToggle) {
        if (state.continuation?.type === "rush") {
          setRushContinuationPrompt(state, state.sideToMove);
        } else if (selectedSource) {
          setBoardPreviewPromptHtml(
            `No moves available from ${renderBoardPreviewCoordinate(selectedSource)}. Supply & command lines shown only:`,
          );
        } else {
          setBoardPreviewPrompt("No moves for this piece at this time. Supply & command lines shown only:");
        }
      } else if (selectedPieceOverlayPhase === "actionPreviews") {
        if (selectedSource) {
          setBoardPreviewPromptHtml(
            `Selected piece at ${renderBoardPreviewCoordinate(selectedSource)}. Select a square to move to or click piece again.`,
          );
        } else {
          setBoardPreviewPrompt(
            "Move previews are shown. Click the selected piece again to show supply & command lines only:",
          );
        }
      } else if (selectedSource) {
        setBoardPreviewPromptHtml(
          `Showing supply & command lines for ${renderBoardPreviewCoordinate(selectedSource)}. Click piece again to see moves:`,
        );
      } else {
        setBoardPreviewPrompt("Supply & command lines are shown. Click the selected piece again to show move previews:");
      }
      return;
    }

    const previewsAtTarget = selectedPieceMovePreviews.filter(
      (action) => action.to && action.to.row === selectedTarget.row && action.to.col === selectedTarget.col,
    );

    const preferredPreview = previewsAtTarget.find((action) => action.type === getActionType()) ?? previewsAtTarget[0] ?? null;

    if (!preferredPreview || preferredPreview.legal === false) {
      if (canOverlayToggle && selectedPieceOverlayPhase === "supplyCommand" && selectedSource) {
        setBoardPreviewPromptHtml(
          `Supply & command lines shown for ${renderBoardPreviewCoordinate(selectedSource)}. Select a square is only available in move preview mode — click that piece again to switch back:`,
        );
        return;
      }
      if (selectedSource) {
        setBoardPreviewPromptHtml(
          `Move preview: selected piece at ${renderBoardPreviewCoordinate(selectedSource)}. Select a square to move to:`,
        );
      } else {
        setBoardPreviewPrompt("Move preview: select a square to move to:");
      }
      return;
    }

    if (canOverlayToggle && selectedPieceOverlayPhase === "supplyCommand" && selectedSource) {
      setBoardPreviewPromptHtml(
        `Supply & command lines are shown. To confirm a move at ${renderBoardPreviewCoordinate(selectedTarget)}, switch back to move previews by clicking ${renderBoardPreviewCoordinate(selectedSource)} again:`,
      );
      return;
    }

    setBoardPreviewAction(actionPreviewLabel(preferredPreview.type, state, selectedTarget));
  };

  const refreshSelectionLabels = () => {
    controls.onSelectionUpdated?.({
      selectedSource,
      selectedTarget,
      selectedPieceId,
      formatCoordinate,
    });
  };

  const invalidateSelectedPieceMovesRequests = () => {
    selectedPieceMovesRequestId += 1;
    selectedPieceMovesLoading = false;
  };

  const actionMatchesSelectedPiece = (action, piece) => {
    if (!action || !piece || action.type === "pass") {
      return false;
    }
    if (typeof action.actorId === "string") {
      return action.actorId === piece.id;
    }
    return sameCoordinate(action.from, piece.position);
  };

  const hydrateSelectedPieceMovesFromLegalActions = () => {
    const selectedPiece = getBoardPieceById(selectedPieceId);
    if (!selectedPiece) {
      selectedPieceMoves = [];
      selectedPieceMovePreviews = [];
      return;
    }

    selectedPieceMoves = legalActions.filter((action) => actionMatchesSelectedPiece(action, selectedPiece));
    selectedPieceMovePreviews = [...selectedPieceMoves];
    maybeAutoSelectTarget(selectedPieceMoves);
  };

  const clearSelection = () => {
    selectedPieceId = null;
    selectedPieceMoves = [];
    selectedPieceMovePreviews = [];
    selectedSource = null;
    setSelectedTarget(null);
    selectedPieceOverlayPhase = "actionPreviews";
    lastPhaseInitializedForPieceId = null;
    autoTargetSuppressed = false;
    invalidateSelectedPieceMovesRequests();
  };

  const reloadLegalActions = async () => {
    if (!state) {
      return;
    }
    const body = await host.loadLegalActions(state);
    state = body.state ?? state;
    legalActions = Array.isArray(body.legalActions) ? body.legalActions : [];
    applyForcedContinuationSelection();
    renderBoard();
    renderStatus();
  };

  const primeSelectedPieceMovesFromLegalActions = () => {
    if (!state || !selectedPieceId) {
      selectedPieceMoves = [];
      selectedPieceMovePreviews = [];
      lastPhaseInitializedForPieceId = null;
      return;
    }

    const body = buildPieceMoveResponse({
      state,
      legalActions,
      pieceId: selectedPieceId,
    });
    selectedPieceMoves = Array.isArray(body.actions) ? body.actions : [];
    selectedPieceMovePreviews = Array.isArray(body.previewActions) ? body.previewActions : selectedPieceMoves;
    if (selectedPieceId !== lastPhaseInitializedForPieceId) {
      selectedPieceOverlayPhase = defaultOverlayPhaseForSelection();
      lastPhaseInitializedForPieceId = selectedPieceId;
    }
    maybeAutoSelectTarget(selectedPieceMoves);
  };

  const applyForcedContinuationSelection = () => {
    const forcedSelection = deriveForcedContinuationSelection(state, legalActions);
    if (!forcedSelection) {
      return false;
    }

    selectedPieceId = forcedSelection.selectedPieceId;
    selectedSource = forcedSelection.source;
    setSelectedTarget(forcedSelection.target, forcedSelection.target ? TARGET_ORIGIN.FORCED : null);
    autoTargetSuppressed = false;
    setActionType(forcedSelection.actionType);
    primeSelectedPieceMovesFromLegalActions();
    refreshSelectionLabels();
    return true;
  };

  const reloadSelectedPieceMoves = async () => {
    const selectedPiece = getBoardPieceById(selectedPieceId);
    if (!state || !selectedPiece) {
      selectedPieceMoves = [];
      selectedPieceMovePreviews = [];
      selectedPieceMovesLoading = false;
      renderBoard();
      renderStatus();
      return;
    }

    primeSelectedPieceMovesFromLegalActions();
    renderBoard();
    renderStatus();

    const requestId = ++selectedPieceMovesRequestId;
    const requestedPieceId = selectedPiece.id;
    selectedPieceMovesLoading = true;
    const body = await host.loadPieceMoves(state, selectedPiece.id);

    if (requestId !== selectedPieceMovesRequestId || selectedPieceId !== requestedPieceId) {
      return;
    }

    selectedPieceMovesLoading = false;
    state = body.state ?? state;
    selectedPieceMoves = Array.isArray(body.actions) ? body.actions : [];
    selectedPieceMovePreviews = Array.isArray(body.previewActions) ? body.previewActions : selectedPieceMoves;
    maybeAutoSelectTarget(selectedPieceMoves);
    renderBoard();
    renderStatus();
  };

  const showRemovalEffects = (effects, previousState, { onComplete = null } = {}) => {
    clearRemovalEffects();
    const startedAt = Date.now();
    removalEffects = Array.isArray(effects)
      ? effects.map((effect) => ({
          ...effect,
          startedAt,
          piece: effect?.piece ?? previousState?.pieces?.find((piece) => piece.id === effect.pieceId) ?? null,
        }))
      : [];
    if (removalEffects.length === 0) {
      if (typeof onComplete === "function") {
        onComplete();
      }
      return;
    }
    removalEffectsOnComplete = typeof onComplete === "function" ? onComplete : null;
    renderBoard();
    removalEffectsTimer = setTimeout(() => {
      removalEffects = [];
      removalEffectsTimer = null;
      const completion = removalEffectsOnComplete;
      removalEffectsOnComplete = null;
      completion?.();
      renderBoard();
    }, REMOVAL_EFFECT_DURATION_MS);
  };

  const buildHistoryRemovalEffects = (records) =>
    (Array.isArray(records) ? records : []).map((record) => {
      const piece =
        record?.piece && typeof record.piece === "object"
          ? {
              ...record.piece,
              position: record.piece.position
                ? {
                    row: record.piece.position.row,
                    col: record.piece.position.col,
                  }
                : { row: record.row, col: record.col },
            }
          : {
              id: null,
              owner: record?.ownerSeat === "p2" ? "P2" : "P1",
              kind: record?.kind === "commander" ? "commander" : "unit",
              position: { row: record.row, col: record.col },
              supplied: record?.supplied !== false,
              commanded: record?.commanded !== false,
            };
      return {
        pieceId: piece.id,
        position: { row: record.row, col: record.col },
        reason: "history_destroyed",
        message: `Piece at (${record.row}, ${record.col}) destroyed.`,
        piece,
      };
    });

  const startHistoryDestructionTransition = (records) => {
    const nextDestroyedPieces = Array.isArray(records) ? structuredClone(records) : [];
    if (nextDestroyedPieces.length === 0) {
      destroyedPieces = [];
      pendingHistoryDestroyedPieces = [];
      return;
    }
    destroyedPieces = [];
    showRemovalEffects(buildHistoryRemovalEffects(nextDestroyedPieces), null, {
      onComplete: () => {
        destroyedPieces = pendingHistoryDestroyedPieces;
        pendingHistoryDestroyedPieces = [];
      },
    });
    pendingHistoryDestroyedPieces = nextDestroyedPieces;
  };

  const setResult = (value) => {
    controls.onActionResult?.(value);
  };

  const submitCurrentAction = async (actionOverride = null) => {
    if (!state || host.canInteract?.(state) === false) {
      return;
    }

    const action = actionOverride ?? buildActionPayload(getActionType(), selectedSource, selectedTarget, selectedPieceId);
    const previousState = state;

    controls.onSubmitting?.(true);
    setResult("Applying action...");

    try {
      const body = await host.applyAction(state, action);

      if (body.accepted) {
        invalidateSelectedPieceMovesRequests();
        state = body.state;
        legalActions = Array.isArray(body.legalActions) ? body.legalActions : [];
        selectedPieceMoves = [];
        selectedPieceMovePreviews = [];

        const turnChanged =
          previousState?.sideToMove !== state?.sideToMove || previousState?.turnIndex !== state?.turnIndex;
        controls.onBoardMessage?.(
          body.boardMessage ?? { type: turnChanged ? "turn_ended" : "move_sent", origin: "board-runtime" },
        );

        if (!applyForcedContinuationSelection()) {
          if (previousState?.sideToMove && state?.sideToMove && previousState.sideToMove !== state.sideToMove) {
            clearSelection();
          } else {
            setSelectedTarget(null);
          }
        }

        showRemovalEffects(body.removedPieces, previousState);
        refreshSelectionLabels();
        renderBoard();
        renderStatus();
        if (selectedPieceId) {
          await reloadSelectedPieceMoves();
        }
        setResult({ accepted: true, outcome: body.outcome ?? state.outcome });

        return;
      }

      state = body.state ?? state;
      invalidateSelectedPieceMovesRequests();
      selectedPieceMoves = [];
      selectedPieceMovePreviews = [];
      setResult({ accepted: false, validation: body.validation });
      await reloadLegalActions();
    } catch (error) {
      setResult({ ok: false, error: "request_failed", message: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      controls.onSubmitting?.(false);
    }
  };

  const actionsAtTarget = (coord) =>
    selectedPieceMoves.filter((action) => action.to && action.to.row === coord.row && action.to.col === coord.col);

  const applyHoveredTarget = (hoveredCoord) => {
    if (!selectedSource) {
      return false;
    }
    const { selectedPieceMovePreviews: effectivePreviews } = getEffectiveSelectedPieceMovesForBoard();
    const previewsAtTarget = effectivePreviews.filter(
      (action) => action.to && action.to.row === hoveredCoord.row && action.to.col === hoveredCoord.col,
    );
    if (
      !shouldAllowSelectionAtTarget({
        allowFreeSelection: getAllowFreeSelection(),
        hasSelectedSource: Boolean(selectedSource),
        actionsAtTarget: previewsAtTarget,
      })
    ) {
      return false;
    }

    const nextActionType = pickBestActionTypeForTarget(previewsAtTarget, getActionType()) ?? getActionType();
    const targetAlreadySelected = sameCoordinate(selectedTarget, hoveredCoord);
    const actionTypeChanged = nextActionType !== getActionType();
    if (targetAlreadySelected && !actionTypeChanged) {
      return false;
    }

    if (actionTypeChanged) {
      setActionType(nextActionType);
    }
    if (!targetAlreadySelected) {
      setSelectedTarget(hoveredCoord, TARGET_ORIGIN.HOVER);
    }
    refreshSelectionLabels();
    renderBoard();
    renderStatus();
    return true;
  };

  const clearHoveredTarget = (hoveredCoord = null) => {
    if (selectedTargetOrigin !== TARGET_ORIGIN.HOVER) {
      return false;
    }
    if (hoveredCoord && !sameCoordinate(selectedTarget, hoveredCoord)) {
      return false;
    }
    setSelectedTarget(null);
    refreshSelectionLabels();
    renderBoard();
    renderStatus();
    return true;
  };

  const handleBoardCellClick = (clickedCoord) => {
    if (!state || host.canInteract?.(state) === false) {
      return;
    }

    const allowFreeSelection = getAllowFreeSelection();
    const usesHoverTargetSelection = getUsesHoverTargetSelection();
    const clickedPiece = boardAdapter.getPieceAt(state, clickedCoord);
    const { selectedPieceMoves: effectiveMoves, selectedPieceMovePreviews: effectivePreviews } =
      getEffectiveSelectedPieceMovesForBoard();
    const hasPreviewAtClicked = effectivePreviews.some(
      (action) => action.to && action.to.row === clickedCoord.row && action.to.col === clickedCoord.col,
    );

    if (!allowFreeSelection && !clickedPiece && !hasPreviewAtClicked) {
      if (selectedPieceId && selectedPieceMovesLoading) {
        return;
      }
      setActionType("pass");
      clearSelection();
      refreshSelectionLabels();
      renderBoard();
      renderStatus();
      return;
    }

    if (sameCoordinate(selectedTarget, clickedCoord)) {
      const candidates = actionsAtTarget(clickedCoord);
      if (candidates.length > 0) {
        const nextType = pickBestActionTypeForTarget(candidates, getActionType());
        if (nextType && getActionType() !== nextType) {
          setActionType(nextType);
        }
        void submitCurrentAction();
        return;
      }
    }

    if (usesHoverTargetSelection && selectedSource && hasPreviewAtClicked) {
      return;
    }

    if (clickedPiece?.id === selectedPieceId && canToggleSelectedPieceOverlay()) {
      selectedPieceOverlayPhase = selectedPieceOverlayPhase === "actionPreviews" ? "supplyCommand" : "actionPreviews";
      setSelectedTarget(null);
      refreshSelectionLabels();
      renderBoard();
      renderStatus();
      return;
    }

    const result = boardAdapter.nextSelectionForCell({
      snapshot: state,
      selection: getCurrentSelection(),
      selectedPieceMoves: effectiveMoves,
      selectedPieceMovePreviews: effectivePreviews,
      currentActionType: getActionType(),
      clickedCoord,
      allowFreeSelection,
    });

    const previousSelection = getCurrentSelection();
    selectedPieceId = result.selection.selectedPieceId;
    selectedSource = result.selection.source;
    setSelectedTarget(result.selection.target, result.selection.target ? TARGET_ORIGIN.MANUAL : null);
    autoTargetSuppressed = false;
    setActionType(result.nextActionType);

    const pieceChanged = previousSelection.selectedPieceId !== result.selection.selectedPieceId;
    if (pieceChanged) {
      invalidateSelectedPieceMovesRequests();
      primeSelectedPieceMovesFromLegalActions();
    }

    refreshSelectionLabels();
    renderBoard();
    renderStatus();
    void reloadSelectedPieceMoves().catch((error) => {
      setResult({ ok: false, error: "piece_moves_load_failed", message: error instanceof Error ? error.message : "Unknown error" });
    });
  };

  const handleBoardCellHoverStart = (hoveredCoord) => {
    if (!state || !getUsesHoverTargetSelection() || host.canInteract?.(state) === false) {
      return;
    }
    applyHoveredTarget(hoveredCoord);
  };

  const handleBoardCellHoverEnd = (hoveredCoord) => {
    if (!state || !getUsesHoverTargetSelection() || host.canInteract?.(state) === false) {
      return;
    }
    clearHoveredTarget(hoveredCoord);
  };

  const handleDocumentClick = (event) => {
    if (!shouldResetSelectionOnDocumentClick(event.target)) {
      return;
    }
    setActionType("pass");
    clearSelection();
    refreshSelectionLabels();
    renderBoard();
    renderStatus();
  };

  const handleDocumentKeydown = (event) => {
    if (
      !shouldSubmitOnEnter({
        key: event.key,
        target: event.target,
        actionType: getActionType(),
        submitDisabled: Boolean(controls.isSubmitDisabled?.()),
      })
    ) {
      return;
    }
    event.preventDefault();
    void submitCurrentAction();
  };

  const handleBoardPreviewClick = (event) => {
    const actionButton = event.target.closest("[data-board-preview-action]");
    if (!actionButton) {
      return;
    }
    const previewAction = actionButton.getAttribute("data-board-preview-action");
    if (previewAction === "end-turn") {
      void endCurrentTurn();
      return;
    }
  };

  const endCurrentTurn = async () => {
    if (!state || typeof host.endTurn !== "function" || host.canInteract?.(state) === false) {
      return;
    }
    controls.onSubmitting?.(true);
    try {
      const result = await host.endTurn(state);
      if (!result?.accepted) {
        setResult({ accepted: false, validation: result?.validation ?? null });
        return;
      }
      state = result.state ?? state;
      legalActions = Array.isArray(result.legalActions) ? result.legalActions : legalActions;
      clearSelection();
      refreshSelectionLabels();
      renderBoard();
      renderStatus();
      setResult({ accepted: true, outcome: result.outcome ?? state.outcome });
      controls.onBoardMessage?.(result.boardMessage ?? { type: "turn_ended", origin: "board-runtime" });
    } catch (error) {
      setResult({ ok: false, error: "end_turn_failed", message: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      controls.onSubmitting?.(false);
    }
  };

  const bindElements = (nextElements) => {
    const hadPreview = elements.boardPreviewLabelEl;
    const sameNodes =
      elements.boardEl === nextElements.boardEl &&
      elements.overlayLinesEl === nextElements.overlayLinesEl &&
      elements.boardPreviewLabelEl === nextElements.boardPreviewLabelEl &&
      elements.boardTurnIndicatorEl === nextElements.boardTurnIndicatorEl;

    if (sameNodes) {
      return;
    }

    if (hadPreview) {
      elements.boardPreviewLabelEl.removeEventListener("click", handleBoardPreviewClick);
    }

    elements = {
      boardEl: nextElements.boardEl,
      overlayLinesEl: nextElements.overlayLinesEl,
      boardPreviewLabelEl: nextElements.boardPreviewLabelEl,
      boardTurnIndicatorEl: nextElements.boardTurnIndicatorEl,
    };

    if (elements.boardPreviewLabelEl) {
      elements.boardPreviewLabelEl.addEventListener("click", handleBoardPreviewClick);
    }

    if (!mounted && elements.boardEl && elements.overlayLinesEl) {
      boardAdapter.mount({
        boardEl: elements.boardEl,
        overlayLinesEl: elements.overlayLinesEl,
        onCellClick: handleBoardCellClick,
        onCellHoverStart: handleBoardCellHoverStart,
        onCellHoverEnd: handleBoardCellHoverEnd,
      });
      mounted = true;
    } else if (mounted && elements.boardEl && elements.overlayLinesEl) {
      boardAdapter.mount({
        boardEl: elements.boardEl,
        overlayLinesEl: elements.overlayLinesEl,
        onCellClick: handleBoardCellClick,
        onCellHoverStart: handleBoardCellHoverStart,
        onCellHoverEnd: handleBoardCellHoverEnd,
      });
    }

    renderBoard();
    renderStatus();
  };

  const applySelectionPreviewFromAction = (action) => {
    if (!action || !action.from || !action.to) {
      autoTargetSuppressed = false;
      setActionType(action?.type ?? defaultActionType);
      return;
    }
    const selectedPiece =
      (typeof action.actorId === "string" && getBoardPieceById(action.actorId)) ||
      boardAdapter.getPieceAt(state, action.from);
    selectedPieceId = selectedPiece?.id ?? null;
    selectedSource = { ...action.from };
    setSelectedTarget(action.to, TARGET_ORIGIN.HISTORY);
    autoTargetSuppressed = false;
    setActionType(action.type);
  };

  const applySelectionState = (selectionState) => {
    selectedPieceId = selectionState?.selectedPieceId ?? null;
    selectedSource = selectionState?.source ? { ...selectionState.source } : null;
    setSelectedTarget(selectionState?.target ?? null, selectionState?.target ? TARGET_ORIGIN.MANUAL : null);
    autoTargetSuppressed = Boolean(selectionState?.source && !selectionState?.target);
  };

  const loadSnapshot = async (
    snapshot,
    {
      legalActions: incomingLegalActions = null,
      resetSelection = true,
      selectionAction = null,
      selectionState = null,
      overlayMode: nextOverlayMode = OVERLAY_MODE.INTERACTIVE,
      recordedAction: nextRecordedAction = null,
      recordedActionStartPiece: nextRecordedActionStartPiece = null,
      destroyedPieces: nextDestroyedPieces = [],
    } = {},
  ) => {
    state = structuredClone(snapshot);
    legalActions = Array.isArray(incomingLegalActions) ? incomingLegalActions : [];
    overlayMode = nextOverlayMode;
    recordedAction = nextRecordedAction ? structuredClone(nextRecordedAction) : null;
    recordedActionStartPiece = nextRecordedActionStartPiece ? structuredClone(nextRecordedActionStartPiece) : null;
    const preserveRemovalEffects =
      nextOverlayMode === OVERLAY_MODE.INTERACTIVE &&
      !selectionAction &&
      removalEffects.length > 0;
    if (!preserveRemovalEffects) {
      clearRemovalEffects();
    }
    if (nextOverlayMode === OVERLAY_MODE.RECORDED_ACTION && Array.isArray(nextDestroyedPieces) && nextDestroyedPieces.length > 0) {
      startHistoryDestructionTransition(nextDestroyedPieces);
    } else {
      pendingHistoryDestroyedPieces = [];
      destroyedPieces = Array.isArray(nextDestroyedPieces) ? structuredClone(nextDestroyedPieces) : [];
    }
    if (resetSelection) {
      clearSelection();
    }
    selectedPieceMoves = [];
    selectedPieceMovePreviews = [];
    if (overlayMode === OVERLAY_MODE.INTERACTIVE) {
      if (selectionState) {
        applySelectionState(selectionState);
      } else {
        applyForcedContinuationSelection();
      }
    }
    if (selectionAction && overlayMode === OVERLAY_MODE.INTERACTIVE) {
      applySelectionPreviewFromAction(selectionAction);
      selectedPieceMoves = [structuredClone(selectionAction)];
      selectedPieceMovePreviews = [structuredClone(selectionAction)];
      lastPhaseInitializedForPieceId = selectedPieceId;
      selectedPieceOverlayPhase = defaultOverlayPhaseForSelection();
    }
    refreshSelectionLabels();
    renderBoard();

    if (!Array.isArray(incomingLegalActions)) {
      await reloadLegalActions();
      return;
    }

    renderStatus();
    if (selectionState?.selectedPieceId && overlayMode === OVERLAY_MODE.INTERACTIVE && !selectionAction) {
      await reloadSelectedPieceMoves();
    }
  };

  const setSelectionFromAction = async (action) => {
    if (!action || !action.from || !action.to) {
      setActionType(action?.type ?? "pass");
      clearSelection();
      refreshSelectionLabels();
      renderBoard();
      renderStatus();
      return;
    }

    const selectedPiece =
      (typeof action.actorId === "string" && getBoardPieceById(action.actorId)) ||
      boardAdapter.getPieceAt(state, action.from);

    selectedPieceId = selectedPiece?.id ?? null;
    selectedSource = { ...action.from };
    setSelectedTarget(action.to, TARGET_ORIGIN.MANUAL);
    setActionType(action.type);
    refreshSelectionLabels();

    if (!selectedPieceId) {
      renderBoard();
      renderStatus();
      return;
    }

    await reloadSelectedPieceMoves();
  };

  const initialize = async () => {
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleDocumentKeydown);

    const initial = await host.loadInitialState();
    await loadSnapshot(initial.state, { legalActions: initial.legalActions ?? [] });
  };

  const destroy = () => {
    document.removeEventListener("click", handleDocumentClick);
    document.removeEventListener("keydown", handleDocumentKeydown);
    if (elements.boardPreviewLabelEl) {
      elements.boardPreviewLabelEl.removeEventListener("click", handleBoardPreviewClick);
    }
    clearRemovalEffects();
  };

  const syncInteractionCapabilities = () => {
    const usesHoverTargetSelection = getUsesHoverTargetSelection();
    if (lastUsesHoverTargetSelection === usesHoverTargetSelection) {
      return false;
    }
    lastUsesHoverTargetSelection = usesHoverTargetSelection;
    const clearedHoverTarget = usesHoverTargetSelection ? false : clearHoveredTarget();
    if (!state || !mounted) {
      return clearedHoverTarget;
    }
    renderBoard();
    renderStatus();
    return true;
  };

  return {
    initialize,
    destroy,
    bindElements,
    submitCurrentAction,
    reloadLegalActions,
    reloadSelectedPieceMoves,
    clearSelection,
    loadSnapshot,
    setSelectionFromAction,
    getState: () => state,
    getLegalActions: () => legalActions,
    getSelection: () => ({ selectedPieceId, source: selectedSource, target: selectedTarget }),
    getOverlay: () => getOverlay(),
    setActionType,
    getActionType,
    setResult,
    getBlockedPreviewLabel,
    formatCoordinate,
    actionPreviewLabel,
    sameCoordinate,
    syncInteractionCapabilities,
  };
}
