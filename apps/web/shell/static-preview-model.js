import {
  applyAction,
  listLegalActions,
  resolveToStability,
} from "../generated/packages/game-engine/src/index.js";
import { DEFAULT_ACTION_TYPE, pickBestActionTypeForTarget } from "../interaction.js";
import { buildDestroyedPieceOverlays, findRecordedActionStartPiece } from "./history-preview.js";
import { collectDestroyedPieceRecords } from "./optimistic-live.js";

const clone = (value) => (value == null ? value : structuredClone(value));
const sameCoordinate = (left, right) => Boolean(left && right && left.row === right.row && left.col === right.col);

const toSelection = (savedSelection, selectedPieceId = null) =>
  savedSelection?.source
    ? {
        selectedPieceId,
        source: clone(savedSelection.source),
        target: clone(savedSelection.target ?? null),
      }
    : null;

const actionMatchesSource = (action, sourcePiece, source) => {
  if (!action) {
    return false;
  }
  if (typeof action.actorId === "string" && sourcePiece?.id) {
    return action.actorId === sourcePiece.id;
  }
  return sameCoordinate(action.from, source);
};

export const resolvePreviewActionFromSavedSelection = ({
  savedSelection,
  snapshot,
  legalActions,
  currentActionType = DEFAULT_ACTION_TYPE,
}) => {
  if (!savedSelection?.source || !savedSelection?.target || !snapshot) {
    return null;
  }
  const sourcePiece =
    snapshot.pieces?.find((piece) => sameCoordinate(piece.position, savedSelection.source)) ?? null;
  if (!sourcePiece) {
    return null;
  }
  const actionsForSource = (Array.isArray(legalActions) ? legalActions : []).filter((action) =>
    actionMatchesSource(action, sourcePiece, savedSelection.source),
  );
  const actionsAtTarget = actionsForSource.filter((action) => sameCoordinate(action.to, savedSelection.target));
  if (actionsAtTarget.length === 0) {
    return null;
  }
  const preferredType = pickBestActionTypeForTarget(actionsAtTarget, currentActionType) ?? actionsAtTarget[0]?.type ?? null;
  return actionsAtTarget.find((action) => action.type === preferredType) ?? actionsAtTarget[0] ?? null;
};

export const buildScenarioStaticPreviewModel = (scenario) => {
  const baseSnapshot = clone(scenario?.resultingState ?? scenario?.initialState ?? null);
  const savedSelection = clone(scenario?.savedSelection ?? null);
  const fallbackSelection = toSelection(savedSelection);
  const fallback = {
    snapshot: baseSnapshot,
    selection: fallbackSelection,
    overlay: { mode: "none" },
    legalActions: [],
    selectedPieceId: null,
    selectedPieceMoves: [],
    selectedPieceMovePreviews: [],
    currentActionType: DEFAULT_ACTION_TYPE,
    selectedPieceOverlayPhase: "actionPreviews",
  };

  if (!baseSnapshot || !savedSelection?.source) {
    return fallback;
  }

  const sourcePiece =
    baseSnapshot.pieces?.find((piece) => sameCoordinate(piece.position, savedSelection.source)) ?? null;
  if (!sourcePiece) {
    return fallback;
  }

  const legalActions = listLegalActions(baseSnapshot);
  const selectedPieceMoves = legalActions.filter((action) => actionMatchesSource(action, sourcePiece, savedSelection.source));
  const selectedPieceMovePreviews = [...selectedPieceMoves];

  if (!savedSelection.target) {
    const selection = toSelection(savedSelection, sourcePiece.id);
    return {
      snapshot: baseSnapshot,
      selection,
      overlay: { mode: "interactive", selection },
      legalActions,
      selectedPieceId: sourcePiece.id,
      selectedPieceMoves,
      selectedPieceMovePreviews,
      currentActionType: DEFAULT_ACTION_TYPE,
      selectedPieceOverlayPhase:
        selectedPieceMovePreviews.some((action) => Boolean(action?.to)) ? "actionPreviews" : "supplyCommand",
    };
  }

  const resolvedAction = resolvePreviewActionFromSavedSelection({
    savedSelection,
    snapshot: baseSnapshot,
    legalActions,
  });
  if (!resolvedAction) {
    return fallback;
  }

  const applied = applyAction(baseSnapshot, resolvedAction);
  const settledSnapshot = resolveToStability(clone(applied.state), { artifactMode: "full" });
  const destroyedPieceRecords = collectDestroyedPieceRecords(baseSnapshot, applied.state, settledSnapshot, resolvedAction);
  const overlay = {
    mode: "recorded-action",
    recordedAction: clone(resolvedAction),
    recordedActionStartPiece: clone(findRecordedActionStartPiece(baseSnapshot, resolvedAction)),
    destroyedPieces: buildDestroyedPieceOverlays({
      destroyedPieceRecords,
      preActionSnapshot: baseSnapshot,
    }),
  };

  return {
    snapshot: settledSnapshot,
    selection: toSelection(savedSelection),
    overlay,
    legalActions: [],
    selectedPieceId: null,
    selectedPieceMoves: [],
    selectedPieceMovePreviews: [],
    currentActionType: resolvedAction.type ?? DEFAULT_ACTION_TYPE,
    selectedPieceOverlayPhase: "actionPreviews",
  };
};
