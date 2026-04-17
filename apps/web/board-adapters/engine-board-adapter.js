import { BOARD_SIZE, SUPPLY_POINTS } from "../generated/packages/game-engine/src/deterministic.js";
import { getRushContinuationBlockingPiece } from "../generated/packages/game-engine/src/continuation.js";
import {
  deriveContinuationHighlightByPieceId,
  getBlockedPreviewLabel,
  pickBestActionTypeForTarget,
  shouldAllowSelectionAtTarget,
  shouldPreferActionTargetOnOccupiedCell,
} from "../interaction.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const REMOVAL_FLASH_DURATION_MS = 1800;
const PREVIEW_STROKE_BY_OWNER = {
  P1: "var(--player-p1)",
  P2: "var(--player-p2)",
};
const PREVIEW_OPACITY = {
  default: "0.35",
  selected: "0.7",
};
const OVERLAY_PARALLEL_SPLIT_OFFSET = 2.5;

const coordKey = (coord) => `${coord.row},${coord.col}`;
const isSupplyPoint = (row, col) =>
  (row === SUPPLY_POINTS.P1.row && col === SUPPLY_POINTS.P1.col) ||
  (row === SUPPLY_POINTS.P2.row && col === SUPPLY_POINTS.P2.col);
export const getPieceRenderStatus = (piece) => ({
  supplied: piece?.displaySupplied ?? piece?.supplied ?? false,
  commanded: piece?.displayCommanded ?? piece?.commanded ?? false,
});

export const getRemovalAnimationDelayMs = (effect, now = Date.now()) => {
  if (!effect || typeof effect.startedAt !== "number") {
    return 0;
  }
  return Math.max(0, Math.min(now - effect.startedAt, REMOVAL_FLASH_DURATION_MS));
};

const previewOrientation = (a, b, c) => (b.col - a.col) * (c.row - a.row) - (b.row - a.row) * (c.col - a.col);

export const segmentsOverlapOnSameLine = (leftFrom, leftTo, rightFrom, rightTo) => {
  if (
    !leftFrom ||
    !leftTo ||
    !rightFrom ||
    !rightTo ||
    previewOrientation(leftFrom, leftTo, rightFrom) !== 0 ||
    previewOrientation(leftFrom, leftTo, rightTo) !== 0
  ) {
    return false;
  }

  const leftDeltaRow = leftTo.row - leftFrom.row;
  const leftDeltaCol = leftTo.col - leftFrom.col;
  const project =
    Math.abs(leftDeltaCol) >= Math.abs(leftDeltaRow)
      ? (point) => point.col
      : (point) => point.row;

  const leftStart = Math.min(project(leftFrom), project(leftTo));
  const leftEnd = Math.max(project(leftFrom), project(leftTo));
  const rightStart = Math.min(project(rightFrom), project(rightTo));
  const rightEnd = Math.max(project(rightFrom), project(rightTo));

  return Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart) > 0;
};

export const shouldCurveActionPreview = (from, to, referencePaths) => {
  if (!from || !to || !Array.isArray(referencePaths)) {
    return false;
  }

  for (const path of referencePaths) {
    if (!Array.isArray(path) || path.length < 2) {
      continue;
    }
    for (let index = 0; index < path.length - 1; index += 1) {
      if (segmentsOverlapOnSameLine(from, to, path[index], path[index + 1])) {
        return true;
      }
    }
  }

  return false;
};

export const getCurvedArrowAnchor = (start, end, curveDirection) => {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const distance = Math.hypot(deltaX, deltaY) || 1;
  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const perpendicularX = (-deltaY / distance) * curveDirection;
  const perpendicularY = (deltaX / distance) * curveDirection;

  return {
    x: end.x + perpendicularX * 9 - unitX * 4,
    y: end.y + perpendicularY * 9 - unitY * 4,
  };
};

const compareCoords = (left, right) => {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }
  if (left.row !== right.row) {
    return left.row - right.row;
  }
  return left.col - right.col;
};

export const getCanonicalSegment = (from, to) => (compareCoords(from, to) <= 0 ? [from, to] : [to, from]);

export const getSegmentKey = (from, to) => {
  if (!from || !to) {
    return "";
  }
  const [start, end] = getCanonicalSegment(from, to);
  return `${coordKey(start)}>${coordKey(end)}`;
};

const gcd = (left, right) => {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
};

export const normalizeOverlayPath = (path) => {
  if (!Array.isArray(path) || path.length < 2) {
    return Array.isArray(path) ? [...path] : [];
  }

  const normalized = [{ ...path[0] }];
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    if (!from || !to) {
      continue;
    }

    const deltaRow = to.row - from.row;
    const deltaCol = to.col - from.col;
    const steps = gcd(deltaRow, deltaCol);
    const rowStep = deltaRow / steps;
    const colStep = deltaCol / steps;

    for (let step = 1; step <= steps; step += 1) {
      normalized.push({
        row: from.row + rowStep * step,
        col: from.col + colStep * step,
      });
    }
  }

  return normalized;
};

const getPathSegmentKeys = (path) => {
  if (!Array.isArray(path) || path.length < 2) {
    return [];
  }

  const keys = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    keys.push(getSegmentKey(path[index], path[index + 1]));
  }
  return keys.filter(Boolean);
};

export const buildSharedPathSegmentOffsetMaps = (
  supplyPath,
  commandPath,
  offsetAmount = OVERLAY_PARALLEL_SPLIT_OFFSET,
) => {
  const supplyOffsetsBySegmentKey = new Map();
  const commandOffsetsBySegmentKey = new Map();
  const supplyKeys = new Set(getPathSegmentKeys(supplyPath));

  for (const key of getPathSegmentKeys(commandPath)) {
    if (!supplyKeys.has(key)) {
      continue;
    }
    supplyOffsetsBySegmentKey.set(key, -offsetAmount);
    commandOffsetsBySegmentKey.set(key, offsetAmount);
  }

  return {
    supplyOffsetsBySegmentKey,
    commandOffsetsBySegmentKey,
  };
};

export const getPathSegmentOffsetVector = (from, to, offsetAmount = 0) => {
  if (!from || !to || !offsetAmount) {
    return { x: 0, y: 0 };
  }

  const [start, end] = getCanonicalSegment(from, to);
  const deltaX = end.col - start.col;
  const deltaY = end.row - start.row;
  const distance = Math.hypot(deltaX, deltaY) || 1;

  return {
    x: (-deltaY / distance) * offsetAmount,
    y: (deltaX / distance) * offsetAmount,
  };
};

const formatActionPreviewLabel = (actionType, snapshot, destination) => {
  const suffix = destination ? ` (${destination.row},${destination.col})` : "";
  if (snapshot?.continuation?.type === "rush" && actionType === "rush") {
    return `Continue rush on${suffix}`;
  }
  if (snapshot?.continuation?.type === "push" && actionType === "follow") {
    return `Continue push on${suffix}`;
  }
  switch (actionType) {
    case "move":
      return `Move commander to${suffix}`;
    case "project":
      return `Project new piece to${suffix}`;
    case "rush":
      return `Rush piece to${suffix}`;
    case "push":
      return `Push piece onto${suffix}`;
    case "follow":
      return `Follow piece to${suffix}`;
    case "retreat":
      return `Retreat piece to${suffix}`;
    default:
      return `Move to${suffix}`;
  }
};

function findPieceAt(snapshot, row, col) {
  if (!snapshot) return null;
  return snapshot.pieces.find((piece) => piece.position.row === row && piece.position.col === col) ?? null;
}

function findPiecesAt(snapshot, row, col) {
  if (!snapshot) return [];
  return snapshot.pieces.filter((piece) => piece.position.row === row && piece.position.col === col);
}

function findPieceById(snapshot, pieceId) {
  if (!snapshot || !pieceId) return null;
  return snapshot.pieces.find((piece) => piece.id === pieceId) ?? null;
}

function findActionPiece(snapshot, action) {
  if (!snapshot || !action) {
    return null;
  }
  return (
    (typeof action.actorId === "string" ? findPieceById(snapshot, action.actorId) : null) ??
    (action.from ? findPieceAt(snapshot, action.from.row, action.from.col) : null)
  );
}

function findActionTargetPiece(snapshot, action) {
  if (!snapshot || !action) {
    return null;
  }
  return (
    (action.to ? findPieceAt(snapshot, action.to.row, action.to.col) : null) ??
    (typeof action.actorId === "string" ? findPieceById(snapshot, action.actorId) : null) ??
    (action.from ? findPieceAt(snapshot, action.from.row, action.from.col) : null)
  );
}

function findPreferredPieceAt(snapshot, row, col) {
  const pieces = findPiecesAt(snapshot, row, col);
  if (pieces.length === 0) {
    return null;
  }

  if (snapshot?.continuation?.type === "push" && snapshot.continuation.phase === "retreat") {
    const pushedPiece = pieces.find((piece) => piece.id === snapshot.continuation?.pushedPieceId);
    if (pushedPiece) {
      return pushedPiece;
    }
  }

  return (
    pieces.find((piece) => piece.owner === snapshot?.sideToMove) ??
    pieces.find((piece) => !piece.pushed) ??
    pieces[0]
  );
}

function buildPieceToken(piece, ghost = false) {
  const token = document.createElement("span");
  token.className = `piece-token ${piece.owner === "P1" ? "p1" : "p2"} ${piece.kind}`;
  const renderStatus = getPieceRenderStatus(piece);
  if (!ghost && (!renderStatus.supplied || !renderStatus.commanded)) {
    token.classList.add("inactive");
  }
  if (piece.pushed) {
    token.classList.add("pushed-piece");
  }
  if (ghost) {
    token.classList.add("ghost");
  }
  token.textContent = piece.kind === "commander" ? "C" : "";
  return token;
}

const findRenderablePieceToken = (cell) => {
  if (!cell?.querySelectorAll) {
    return null;
  }
  const tokens = Array.from(cell.querySelectorAll(".piece-token"));
  const renderableTokens = tokens.filter(
    (child) =>
      child?.classList &&
      !child.classList.contains("move-ghost") &&
      !child.classList.contains("history-destruction-piece") &&
      !child.classList.contains("removal-piece"),
  );
  return (
    renderableTokens.find((child) => child.classList.contains("stacked-top")) ??
    renderableTokens[0] ??
    null
  );
};

const buildDestroyedPieceOverlayToken = (record) => {
  const piece = {
    owner: record?.ownerSeat === "p2" ? "P2" : "P1",
    kind: record?.kind === "commander" ? "commander" : "unit",
    supplied: record?.supplied !== false,
    commanded: record?.commanded !== false,
  };
  const token = buildPieceToken(piece);
  token.classList.add("history-destruction-piece");
  token.setAttribute("aria-hidden", "true");
  return token;
};

export function getInactiveSelectedPieceLabel(piece, snapshot) {
  const renderStatus = getPieceRenderStatus(piece);
  if (!piece || (renderStatus.supplied && renderStatus.commanded)) {
    return null;
  }
  const continuationPrefix =
    snapshot?.continuation?.type === "rush" || snapshot?.continuation?.type === "push"
      ? "Will be inactive if not moved: "
      : "Inactive: ";
  if (!renderStatus.supplied && !renderStatus.commanded) {
    return `${continuationPrefix}no connection back to its commander or supply point.`;
  }
  if (!renderStatus.supplied) {
    return `${continuationPrefix}no connection back to its supply point.`;
  }
  return `${continuationPrefix}no connection back to its commander.`;
}

function getFrozenSequenceStartStatus(piece, snapshot) {
  if (!piece || !snapshot?.continuation?.frozenPieceStatesById) {
    return null;
  }

  return snapshot.continuation.frozenPieceStatesById[piece.id] ?? null;
}

export function getSelectedPieceTooltipLabel(piece, snapshot) {
  const inactiveLabel = getInactiveSelectedPieceLabel(piece, snapshot);
  if (inactiveLabel) {
    return inactiveLabel;
  }

  const renderStatus = getPieceRenderStatus(piece);
  const frozenStatus = getFrozenSequenceStartStatus(piece, snapshot);
  const continuationType = snapshot?.continuation?.type;
  if (!frozenStatus || (continuationType !== "rush" && continuationType !== "push")) {
    return null;
  }
  const continuationLabel = continuationType === "rush" ? "rush" : "push";

  if (!renderStatus.supplied || !renderStatus.commanded) {
    return null;
  }

  if (!frozenStatus.supplied && !frozenStatus.commanded) {
    return `Cannot move: was not commanded or supplied at start of ${continuationLabel}.`;
  }
  if (!frozenStatus.supplied) {
    return `Cannot move: was not supplied at start of ${continuationLabel}.`;
  }
  if (!frozenStatus.commanded) {
    return `Cannot move: was not commanded at start of ${continuationLabel}.`;
  }

  return null;
}

function getSupplyArtifactFor(snapshot, owner) {
  if (!snapshot?.artifacts?.supply) {
    return null;
  }
  return snapshot.artifacts.supply.find((entry) => entry.player === owner) ?? null;
}

function getSupplyPathForPiece(snapshot, piece) {
  const supplyArtifact = getSupplyArtifactFor(snapshot, piece.owner);
  return supplyArtifact?.shortestPathByPieceId?.[piece.id] ?? [];
}

function getCommandPathForPiece(snapshot, piece) {
  return snapshot?.artifacts?.command?.shortestPathToCommanderByPieceId?.[piece.id] ?? [];
}

function getGroupInfoForPiece(snapshot, piece) {
  const groups = snapshot?.artifacts?.groups;
  if (!groups) {
    return {
      componentId: null,
      members: [],
      strength: null,
    };
  }

  const componentId = groups.componentByPieceId[piece.id] ?? null;
  if (!componentId) {
    return {
      componentId: null,
      members: [],
      strength: null,
    };
  }

  return {
    componentId,
    members: groups.membersByComponentId[componentId] ?? [],
    strength: groups.strengthByComponentId[componentId] ?? null,
  };
}

function applyContinuationHighlights(snapshot, legalActions, cellByCoordinateKey) {
  const { groupMemberPieceIds, movedPieceIds, pendingPieceIds } = deriveContinuationHighlightByPieceId(
    snapshot,
    legalActions,
  );
  const continuationGroupMembers = [...groupMemberPieceIds]
    .map((pieceId) => findPieceById(snapshot, pieceId))
    .filter((candidate) => Boolean(candidate));

  for (const piece of continuationGroupMembers) {
    cellByCoordinateKey.get(coordKey(piece.position))?.classList.add("group-member");
  }

  const continuationAnchor = continuationGroupMembers
    .map((member) => member.position)
    .sort((a, b) => {
      if (a.row !== b.row) {
        return a.row - b.row;
      }
      return a.col - b.col;
    })[0];

  if (continuationAnchor && continuationGroupMembers.length > 1) {
    const anchorCell = cellByCoordinateKey.get(coordKey(continuationAnchor));
    if (anchorCell) {
      const badge = document.createElement("span");
      badge.className = "group-strength-badge";
      badge.textContent = String(continuationGroupMembers.length);
      anchorCell.appendChild(badge);
    }
  }

  for (const pieceId of movedPieceIds) {
    const piece = findPieceById(snapshot, pieceId);
    if (!piece) {
      continue;
    }
    cellByCoordinateKey.get(coordKey(piece.position))?.classList.add("continuation-member", "continuation-moved");
  }
  for (const pieceId of pendingPieceIds) {
    const piece = findPieceById(snapshot, pieceId);
    if (!piece) {
      continue;
    }
    cellByCoordinateKey.get(coordKey(piece.position))?.classList.add("continuation-member", "continuation-pending");
  }

  const rushBlocker = snapshot?.continuation?.type === "rush" ? getRushContinuationBlockingPiece(snapshot) : null;
  if (rushBlocker) {
    cellByCoordinateKey.get(coordKey(rushBlocker.position))?.classList.add("rush-blocker");
  }
}

function applyGroupDecorations(snapshot, piece, cellByCoordinateKey, { showBadge = true } = {}) {
  const groupInfo = getGroupInfoForPiece(snapshot, piece);
  if (groupInfo.members.length === 0) {
    return;
  }

  const memberPieces = groupInfo.members
    .map((pieceId) => findPieceById(snapshot, pieceId))
    .filter((candidate) => Boolean(candidate));

  for (const member of memberPieces) {
    const memberCell = cellByCoordinateKey.get(coordKey(member.position));
    memberCell?.classList.add("group-member");
  }

  if (!showBadge) {
    return;
  }

  const anchor = memberPieces
    .map((member) => member.position)
    .sort((a, b) => {
      if (a.row !== b.row) {
        return a.row - b.row;
      }
      return a.col - b.col;
    })[0];

  if (!anchor) {
    return;
  }
  const anchorCell = cellByCoordinateKey.get(coordKey(anchor));
  if (anchorCell && typeof groupInfo.strength === "number" && groupInfo.strength > 1) {
    const badge = document.createElement("span");
    badge.className = "group-strength-badge";
    badge.textContent = String(groupInfo.strength);
    anchorCell.appendChild(badge);
  }
}

function isPushContinuationGroupMember(snapshot, piece) {
  if (!piece || snapshot?.continuation?.type !== "push") {
    return false;
  }
  return (snapshot.continuation.followGroupPieceIds ?? []).includes(piece.id);
}

export function createEngineBoardAdapter() {
  let boardEl = null;
  let overlayLinesEl = null;
  let interactionMode = "interactive";
  let onCellClick = null;
  let onCellHoverStart = null;
  let onCellHoverEnd = null;
  let cellByCoordinateKey = new Map();

  const setOverlayViewBox = () => {
    if (!boardEl || !overlayLinesEl) {
      return;
    }
    const width = boardEl.clientWidth;
    const height = boardEl.clientHeight;
    overlayLinesEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
  };

  const getCellCenter = (coord) => {
    const cell = cellByCoordinateKey.get(coordKey(coord));
    if (!cell) {
      return null;
    }

    return {
      x: cell.offsetLeft + cell.offsetWidth / 2,
      y: cell.offsetTop + cell.offsetHeight / 2,
    };
  };

  const drawPath = (path, stroke, dashPattern = null, offsetsBySegmentKey = null) => {
    if (!overlayLinesEl || !path || path.length < 2) {
      return;
    }

    for (let i = 0; i < path.length - 1; i += 1) {
      const pathStart = path[i];
      const pathEnd = path[i + 1];
      const start = getCellCenter(pathStart);
      const end = getCellCenter(pathEnd);
      if (!start || !end) {
        continue;
      }
      const segmentKey = getSegmentKey(pathStart, pathEnd);
      const offsetAmount = offsetsBySegmentKey?.get(segmentKey) ?? 0;
      const offset = getPathSegmentOffsetVector(pathStart, pathEnd, offsetAmount);

      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(start.x + offset.x));
      line.setAttribute("y1", String(start.y + offset.y));
      line.setAttribute("x2", String(end.x + offset.x));
      line.setAttribute("y2", String(end.y + offset.y));
      line.setAttribute("stroke", stroke);
      line.setAttribute("stroke-width", "3");
      line.setAttribute("stroke-linecap", "round");
      if (dashPattern) {
        line.setAttribute("stroke-dasharray", dashPattern);
      }
      overlayLinesEl.appendChild(line);
    }
  };

  const ensurePreviewArrowMarker = (owner, opacity) => {
    if (!overlayLinesEl) {
      return null;
    }

    const stroke = PREVIEW_STROKE_BY_OWNER[owner] ?? PREVIEW_STROKE_BY_OWNER.P1;
    const opacityKey = opacity === PREVIEW_OPACITY.selected ? "selected" : "default";
    let defs = overlayLinesEl.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS(SVG_NS, "defs");
      overlayLinesEl.appendChild(defs);
    }

    const markerId = `preview-arrow-${String(owner ?? "default").toLowerCase()}-${opacityKey}`;
    let marker = defs.querySelector(`#${markerId}`);
    if (!marker) {
      marker = document.createElementNS(SVG_NS, "marker");
      marker.setAttribute("id", markerId);
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "7");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "4");
      marker.setAttribute("markerHeight", "4");
      marker.setAttribute("orient", "auto-start-reverse");
      marker.setAttribute("markerUnits", "strokeWidth");

      const arrowPath = document.createElementNS(SVG_NS, "path");
      arrowPath.setAttribute("d", "M 0 1 L 8 5 L 0 9 z");
      arrowPath.setAttribute("fill", stroke);
      arrowPath.setAttribute("fill-opacity", opacity);
      marker.appendChild(arrowPath);
      defs.appendChild(marker);
    }

    return markerId;
  };

  const drawArrowLine = (from, to, owner, curved = false, selected = false) => {
    if (!overlayLinesEl) {
      return;
    }

    const start = getCellCenter(from);
    const end = getCellCenter(to);
    if (!start || !end) {
      return;
    }

    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const distance = Math.hypot(deltaX, deltaY);
    const stopBeforeGhost = 12;
    const shortenBy = Math.min(stopBeforeGhost, Math.max(0, distance - 4));
    const stroke = PREVIEW_STROKE_BY_OWNER[owner] ?? PREVIEW_STROKE_BY_OWNER.P1;
    const previewOpacity = selected ? PREVIEW_OPACITY.selected : PREVIEW_OPACITY.default;
    const curveDirection = owner === "P2" ? -1 : 1;
    const arrowTarget = curved ? getCurvedArrowAnchor(start, end, curveDirection) : end;
    const arrowDeltaX = arrowTarget.x - start.x;
    const arrowDeltaY = arrowTarget.y - start.y;
    const arrowDistance = Math.hypot(arrowDeltaX, arrowDeltaY);
    const arrowUnitX = arrowDistance > 0 ? arrowDeltaX / arrowDistance : 0;
    const arrowUnitY = arrowDistance > 0 ? arrowDeltaY / arrowDistance : 0;
    const shortenedEnd = {
      x: arrowTarget.x - arrowUnitX * shortenBy,
      y: arrowTarget.y - arrowUnitY * shortenBy,
    };

    const markerId = ensurePreviewArrowMarker(owner, previewOpacity);
    if (curved) {
      const midpoint = {
        x: (start.x + shortenedEnd.x) / 2,
        y: (start.y + shortenedEnd.y) / 2,
      };
      const perpendicularLength = Math.hypot(deltaX, deltaY) || 1;
      const control = {
        x: midpoint.x + ((-deltaY / perpendicularLength) * 12 * curveDirection),
        y: midpoint.y + ((deltaX / perpendicularLength) * 12 * curveDirection),
      };
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${shortenedEnd.x} ${shortenedEnd.y}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", stroke);
      path.setAttribute("stroke-width", "3");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-opacity", previewOpacity);
      if (markerId) {
        path.setAttribute("marker-end", `url(#${markerId})`);
      }
      overlayLinesEl.appendChild(path);
      return;
    }

    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(start.x));
    line.setAttribute("y1", String(start.y));
    line.setAttribute("x2", String(shortenedEnd.x));
    line.setAttribute("y2", String(shortenedEnd.y));
    line.setAttribute("stroke", stroke);
    line.setAttribute("stroke-width", "3");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-opacity", previewOpacity);
    if (markerId) {
      line.setAttribute("marker-end", `url(#${markerId})`);
    }
    overlayLinesEl.appendChild(line);
  };

  const clearCellDecorations = () => {
    for (const cell of cellByCoordinateKey.values()) {
      cell.classList.remove(
        "group-member",
        "continuation-member",
        "continuation-moved",
        "continuation-pending",
        "rush-blocker",
        "retreat-piece",
        "selected-piece",
        "inactive-selected-piece",
      );
      cell.removeAttribute("data-inactive-label");
      cell.querySelectorAll(".group-strength-badge,.move-ghost").forEach((node) => node.remove());
    }
  };

  const renderPieceOverlays = ({
    snapshot,
    overlay,
    legalActions,
    selectedPieceId,
    selectedPieceMoves,
    selectedPieceMovePreviews,
    currentActionType: overlayActionType,
    selectedPieceOverlayPhase,
  }) => {
    if (!overlayLinesEl) {
      return;
    }

    clearCellDecorations();
    overlayLinesEl.innerHTML = "";
    setOverlayViewBox();

    if (overlay?.mode === "recorded-action") {
      const action = overlay.recordedAction;
      const startPiece = overlay.recordedActionStartPiece ?? null;
      const replay = overlay.replay ?? null;
      const shouldDecorateReplay = replay?.kind === "incoming-move";
      const piece = findActionTargetPiece(snapshot, action) ?? startPiece;
      if (!action || !piece) {
        return;
      }

      if (action.type === "push") {
        applyGroupDecorations(snapshot, piece, cellByCoordinateKey);
      }

      if (action.from && startPiece) {
        const sourceSnapshotPiece = findPieceAt(snapshot, action.from.row, action.from.col);
        const sourceCell = cellByCoordinateKey.get(coordKey(action.from));
        const shouldAppendSourceToken =
          !sourceSnapshotPiece || (typeof sourceSnapshotPiece.id === "string" && sourceSnapshotPiece.id !== startPiece.id);
        if (sourceCell && shouldAppendSourceToken) {
          const sourceToken = buildPieceToken(startPiece, action.type !== "project");
          sourceToken.classList.add("recorded-action-source-piece");
          if (action.type !== "project") {
            sourceToken.classList.add("move-ghost");
          }
          if (shouldDecorateReplay) {
            sourceToken.classList.add("incoming-move-replay-source");
          }
          sourceCell.appendChild(sourceToken);
        } else if (sourceCell && shouldDecorateReplay) {
          findRenderablePieceToken(sourceCell)?.classList.add("incoming-move-replay-source");
        }
      }

      if (action.to) {
        if (action.type !== "project") {
          drawArrowLine(action.from ?? startPiece?.position ?? piece.position, action.to, piece.owner, false, true);
          if (shouldDecorateReplay) {
            overlayLinesEl?.children?.[overlayLinesEl.children.length - 1]?.classList?.add("incoming-move-replay-arrow-animate");
          }
        }
        const targetCell = cellByCoordinateKey.get(coordKey(action.to));
        if (targetCell) {
          if (action.type === "project") {
            const existingToken = findRenderablePieceToken(targetCell);
            if (existingToken) {
              existingToken.classList.add("preview-created");
              if (shouldDecorateReplay) {
                existingToken.classList.add("incoming-move-replay-target");
              }
              return;
            }
          }
          const previewPiece = findActionTargetPiece(snapshot, action) ?? action.previewPiece ?? piece;
          const ghost = buildPieceToken(previewPiece, true);
          ghost.classList.add("move-ghost");
          if (action.type === "project") {
            ghost.classList.add("preview-created");
          }
          if (shouldDecorateReplay) {
            ghost.classList.add("incoming-move-replay-target");
          }
          targetCell.appendChild(ghost);
        }
      }
      return;
    }

    const piece = findPieceById(snapshot, selectedPieceId);
    if (!piece) {
      applyContinuationHighlights(snapshot, legalActions, cellByCoordinateKey);
      if (snapshot?.continuation?.type === "push" && snapshot.continuation.phase === "retreat") {
        const pushedPiece = findPieceById(snapshot, snapshot.continuation.pushedPieceId);
        if (pushedPiece) {
          cellByCoordinateKey.get(coordKey(pushedPiece.position))?.classList.add("retreat-piece");
        }
      }
      return;
    }

    const pieceCell = cellByCoordinateKey.get(coordKey(piece.position));
    if (pieceCell) {
      pieceCell.classList.add("selected-piece");
      const tooltipLabel = getSelectedPieceTooltipLabel(piece, snapshot);
      if (tooltipLabel) {
        pieceCell.classList.add("inactive-selected-piece");
        pieceCell.setAttribute("data-inactive-label", tooltipLabel);
      }
    }

    if (!isPushContinuationGroupMember(snapshot, piece)) {
      applyGroupDecorations(snapshot, piece, cellByCoordinateKey);
    }

    applyContinuationHighlights(snapshot, legalActions, cellByCoordinateKey);
    if (snapshot?.continuation?.type === "push" && snapshot.continuation.phase === "retreat") {
      const pushedPiece = findPieceById(snapshot, snapshot.continuation.pushedPieceId);
      if (pushedPiece) {
        cellByCoordinateKey.get(coordKey(pushedPiece.position))?.classList.add("retreat-piece");
      }
    }

    const drawSupplyCommand = selectedPieceOverlayPhase !== "actionPreviews";
    const drawActionPreviews = selectedPieceOverlayPhase !== "supplyCommand";
    const supplyPath = normalizeOverlayPath(getSupplyPathForPiece(snapshot, piece));
    const commandPath = normalizeOverlayPath(getCommandPathForPiece(snapshot, piece));
    const commandStroke = PREVIEW_STROKE_BY_OWNER[piece.owner] ?? PREVIEW_STROKE_BY_OWNER.P1;
    const { supplyOffsetsBySegmentKey, commandOffsetsBySegmentKey } = buildSharedPathSegmentOffsetMaps(
      supplyPath,
      commandPath,
    );
    if (drawSupplyCommand) {
      drawPath(supplyPath, "#2f8e63", "2 6", supplyOffsetsBySegmentKey);
      drawPath(commandPath, commandStroke, "2 6", commandOffsetsBySegmentKey);
    }

    if (!drawActionPreviews) {
      return;
    }

    const previews = Array.isArray(selectedPieceMovePreviews) ? selectedPieceMovePreviews : selectedPieceMoves;
    const previewsByTargetKey = new Map();
    for (const action of previews) {
      if (!action?.to) {
        continue;
      }
      const targetKey = coordKey(action.to);
      const actionsAtTarget = previewsByTargetKey.get(targetKey) ?? [];
      actionsAtTarget.push(action);
      previewsByTargetKey.set(targetKey, actionsAtTarget);
    }

    for (const [targetKey, actionsAtTarget] of previewsByTargetKey.entries()) {
      const preferredActionType = pickBestActionTypeForTarget(actionsAtTarget, overlayActionType ?? null);
      const action = actionsAtTarget.find((candidate) => candidate.type === preferredActionType) ?? actionsAtTarget[0];
      const targetCell = cellByCoordinateKey.get(targetKey);
      const isSelectedTarget = targetCell?.classList.contains("target") ?? false;
      if (!action?.to) {
        continue;
      }
      if (action.type !== "project") {
        drawArrowLine(
          piece.position,
          action.to,
          piece.owner,
          false,
          isSelectedTarget,
        );
      }
      if (targetCell) {
        const ghost = buildPieceToken(action.previewPiece ?? piece, true);
        ghost.classList.add("move-ghost");
        if (action.type === "project") {
          ghost.classList.add("preview-created");
        }
        if (action.legal === false && action.blockedReason === "SUPPLY_DESTINATION_UNSUPPLIED") {
          ghost.classList.add("illegal-unsupplied");
        }
        if (action.type === "push") {
          const pushStack = targetCell.querySelector(".piece-stack[data-push-preview-stack]");
          if (pushStack) {
            ghost.classList.add("stacked-piece", "stacked-top");
            pushStack.appendChild(ghost);
            continue;
          }
        }
        targetCell.appendChild(ghost);
      }
    }
  };

  const onBoardClick = (event) => {
    const cell = event.target.closest(".cell");
    if (!cell || !onCellClick) {
      return;
    }

    onCellClick({
      row: Number(cell.dataset.row),
      col: Number(cell.dataset.col),
    });
  };

  const getCellFromEventTarget = (target) => {
    if (!target || typeof target.closest !== "function") {
      return null;
    }
    return target.closest(".cell");
  };

  const readCoordFromCell = (cell) => {
    if (!cell) {
      return null;
    }
    return {
      row: Number(cell.dataset.row),
      col: Number(cell.dataset.col),
    };
  };

  const onBoardMouseOver = (event) => {
    const currentCell = getCellFromEventTarget(event.target);
    const previousCell = getCellFromEventTarget(event.relatedTarget);
    if (!currentCell || !onCellHoverStart || currentCell === previousCell) {
      return;
    }
    onCellHoverStart(readCoordFromCell(currentCell));
  };

  const onBoardMouseOut = (event) => {
    const currentCell = getCellFromEventTarget(event.target);
    const nextCell = getCellFromEventTarget(event.relatedTarget);
    if (!currentCell || !onCellHoverEnd || currentCell === nextCell) {
      return;
    }
    onCellHoverEnd(readCoordFromCell(currentCell));
  };

  return {
    id: "engine-board",

    getCapabilities() {
      return {
        live: true,
        history: false,
        tutorial: false,
      };
    },

    mount(options) {
      if (boardEl) {
        boardEl.removeEventListener("click", onBoardClick);
        boardEl.removeEventListener("mouseover", onBoardMouseOver);
        boardEl.removeEventListener("mouseout", onBoardMouseOut);
      }
      boardEl = options.boardEl;
      overlayLinesEl = options.overlayLinesEl;
      interactionMode = options.interactionMode === "static" ? "static" : "interactive";
      onCellClick = options.onCellClick;
      onCellHoverStart = options.onCellHoverStart ?? null;
      onCellHoverEnd = options.onCellHoverEnd ?? null;
      if (boardEl?.setAttribute) {
        boardEl.setAttribute("data-interaction-mode", interactionMode);
      }
      if (interactionMode === "interactive") {
        boardEl.addEventListener("click", onBoardClick);
        boardEl.addEventListener("mouseover", onBoardMouseOver);
        boardEl.addEventListener("mouseout", onBoardMouseOut);
      }
    },

    unmount() {
      if (boardEl) {
        boardEl.removeEventListener("click", onBoardClick);
        boardEl.removeEventListener("mouseover", onBoardMouseOver);
        boardEl.removeEventListener("mouseout", onBoardMouseOut);
      }
      boardEl = null;
      overlayLinesEl = null;
      interactionMode = "interactive";
      onCellClick = null;
      onCellHoverStart = null;
      onCellHoverEnd = null;
      cellByCoordinateKey = new Map();
    },

    getPieceAt(snapshot, coord) {
      return findPreferredPieceAt(snapshot, coord.row, coord.col);
    },

    getPieceById(snapshot, pieceId) {
      return findPieceById(snapshot, pieceId);
    },

    nextSelectionForCell({
      snapshot,
      selection,
      selectedPieceMoves,
      selectedPieceMovePreviews,
      currentActionType,
      clickedCoord,
      allowFreeSelection,
    }) {
      const clickedPiece = findPreferredPieceAt(snapshot, clickedCoord.row, clickedCoord.col);
      const selectedPiece = findPieceById(snapshot, selection.selectedPieceId);
      const actionPreviewsAtTarget = (Array.isArray(selectedPieceMovePreviews) ? selectedPieceMovePreviews : selectedPieceMoves).filter(
        (action) => action.to && action.to.row === clickedCoord.row && action.to.col === clickedCoord.col,
      );

      if (
        clickedPiece &&
        shouldPreferActionTargetOnOccupiedCell({
          selectedPieceOwner: selectedPiece?.owner ?? null,
          clickedPieceOwner: clickedPiece.owner,
          actionsAtTarget: actionPreviewsAtTarget,
        })
      ) {
        const suggestedAction = pickBestActionTypeForTarget(actionPreviewsAtTarget, currentActionType) ?? "pass";
        return {
          selection: {
            ...selection,
            target: clickedCoord,
          },
          nextActionType: suggestedAction,
        };
      }

      if (clickedPiece) {
        return {
          selection: {
            selectedPieceId: clickedPiece.id,
            source: { ...clickedPiece.position },
            target: null,
          },
          nextActionType: currentActionType,
        };
      }

      if (!selection.source) {
        if (!shouldAllowSelectionAtTarget({
          allowFreeSelection: Boolean(allowFreeSelection),
          hasSelectedSource: false,
          actionsAtTarget: [],
        })) {
          return {
            selection,
            nextActionType: currentActionType,
          };
        }

        return {
          selection: {
            ...selection,
            source: clickedCoord,
          },
          nextActionType: "pass",
        };
      }

      if (!shouldAllowSelectionAtTarget({
        allowFreeSelection: Boolean(allowFreeSelection),
        hasSelectedSource: true,
        actionsAtTarget: actionPreviewsAtTarget,
      })) {
        return {
          selection,
          nextActionType: currentActionType,
        };
      }
      const suggestedAction = pickBestActionTypeForTarget(actionPreviewsAtTarget, currentActionType) ?? "pass";

      return {
        selection: {
          ...selection,
          target: clickedCoord,
        },
        nextActionType: suggestedAction,
      };
    },

    render({
      snapshot,
      selection,
      overlay,
      legalActions,
      selectedPieceMoves,
      selectedPieceMovePreviews,
      removalEffects,
      allowFreeSelection,
      currentActionType,
      interactionMode: renderInteractionMode,
      selectedPieceOverlayPhase,
    }) {
      if (!boardEl) {
        throw new Error("Adapter not mounted");
      }

      const effectiveInteractionMode = renderInteractionMode === "static" ? "static" : interactionMode;
      boardEl.innerHTML = "";
      if (boardEl?.setAttribute) {
        boardEl.setAttribute("data-interaction-mode", effectiveInteractionMode);
      }
      cellByCoordinateKey = new Map();
      const removalByCoordinateKey = new Map(
        (Array.isArray(removalEffects) ? removalEffects : []).map((effect) => [coordKey(effect.position), effect]),
      );
      const destroyedByCoordinateKey = new Map(
        (Array.isArray(overlay?.destroyedPieces) ? overlay.destroyedPieces : []).map((record) => [coordKey(record), record]),
      );

      const continuationHighlight = deriveContinuationHighlightByPieceId(snapshot, legalActions);
      const isContinuationHighlightedSquare = (row, col) => {
        const piecesHere = findPiecesAt(snapshot, row, col);
        return piecesHere.some(
          (piece) =>
            continuationHighlight.pendingPieceIds.has(piece.id) ||
            continuationHighlight.movedPieceIds.has(piece.id),
        );
      };
      const isLiveInteractiveBoard = overlay?.mode !== "recorded-action";

      for (let row = 0; row < BOARD_SIZE; row += 1) {
        for (let col = 0; col < BOARD_SIZE; col += 1) {
          const cell = document.createElement(effectiveInteractionMode === "static" ? "div" : "button");
          if (effectiveInteractionMode === "interactive") {
            cell.type = "button";
          } else {
            cell.setAttribute("aria-hidden", "true");
          }
          cell.className = "cell";
          const cellPiece = findPieceAt(snapshot, row, col);
          const effectiveSelection =
            overlay?.mode === "recorded-action"
              ? {
                  selectedPieceId: null,
                  source: overlay?.recordedAction?.from ?? null,
                  target: overlay?.recordedAction?.to ?? null,
                }
              : selection;
          const previews =
            overlay?.mode === "interactive"
              ? Array.isArray(selectedPieceMovePreviews)
                ? selectedPieceMovePreviews
                : selectedPieceMoves
              : [];
          const effectiveSelectedPieceMoves = overlay?.mode === "interactive" ? selectedPieceMoves : [];
          const hasSource = Boolean(effectiveSelection.source);
          const previewsAtCell = previews.filter(
            (action) => action.to && action.to.row === row && action.to.col === col,
          );
          const legalAtCell = effectiveSelectedPieceMoves.filter(
            (action) => action.to && action.to.row === row && action.to.col === col,
          );
          const hasActionToCell = previewsAtCell.length > 0;
          const blockedPreview = previewsAtCell.find((action) => action.legal === false) ?? null;
          const hasBlockedPreview = Boolean(blockedPreview) && legalAtCell.length === 0;

          const selectable =
            Boolean(allowFreeSelection) ||
            Boolean(cellPiece) ||
            (!hasSource ? false : hasActionToCell);
          if (!selectable) {
            cell.classList.add("unselectable");
          }
          if (hasBlockedPreview) {
            cell.classList.add("disallowed-preview");
          }
          const removalEffect = removalByCoordinateKey.get(`${row},${col}`);
          if (removalEffect) {
            if (removalEffect.reason !== "history_destroyed") {
              cell.classList.add("removal-effect");
              cell.setAttribute("data-removal-label", removalEffect.message);
            }
          }

          const isSource =
            effectiveSelection.source &&
            effectiveSelection.source.row === row &&
            effectiveSelection.source.col === col;
          const isTarget =
            effectiveSelection.target &&
            effectiveSelection.target.row === row &&
            effectiveSelection.target.col === col;
          if (isSource) cell.classList.add("source");
          if (isTarget) {
            cell.classList.add("target");
            if (
              isLiveInteractiveBoard &&
              !isContinuationHighlightedSquare(row, col) &&
              effectiveInteractionMode === "interactive"
            ) {
              if (snapshot?.sideToMove === "P1") {
                cell.classList.add("target-side-p1");
              } else if (snapshot?.sideToMove === "P2") {
                cell.classList.add("target-side-p2");
              }
            }
          }

          if (isTarget) {
            if (hasBlockedPreview) {
              cell.classList.add("disallowed-target");
              cell.setAttribute("data-disallow-reason", getBlockedPreviewLabel(blockedPreview?.blockedReason ?? null));
            }
          }

          cell.dataset.row = String(row);
          cell.dataset.col = String(col);

          const cellPieces = findPiecesAt(snapshot, row, col);
          const selectedActorForPushPreview =
            overlay?.mode === "interactive" && effectiveSelection.selectedPieceId
              ? findPieceById(snapshot, effectiveSelection.selectedPieceId)
              : null;
          const legalPushToCell = legalAtCell.some((action) => action.type === "push");
          const preferredActionTypeAtCell = pickBestActionTypeForTarget(previewsAtCell, currentActionType) ?? currentActionType;
          const showPushPreviewDefenderStack =
            isTarget &&
            preferredActionTypeAtCell === "push" &&
            cellPieces.length === 1 &&
            cellPiece &&
            selectedActorForPushPreview &&
            cellPiece.owner !== selectedActorForPushPreview.owner &&
            legalPushToCell;

          if (cellPieces.length > 1) {
            const stack = document.createElement("span");
            stack.className = "piece-stack";
            const sortedPieces = [...cellPieces].sort((left, right) => {
              if (left.pushed !== right.pushed) {
                return left.pushed ? -1 : 1;
              }
              if (left.owner !== right.owner) {
                return left.owner.localeCompare(right.owner);
              }
              return left.id.localeCompare(right.id);
            });
            for (const [index, pieceInStack] of sortedPieces.entries()) {
              const token = buildPieceToken(pieceInStack);
              token.classList.add("stacked-piece");
              if (index === 0 && pieceInStack.pushed) {
                token.classList.add("stacked-underlay");
              }
              if (pieceInStack.pushed) {
                token.classList.add("stacked-pushed");
              } else {
                token.classList.add("stacked-top");
              }
              stack.appendChild(token);
            }
            cell.appendChild(stack);
          } else if (showPushPreviewDefenderStack) {
            const stack = document.createElement("span");
            stack.className = "piece-stack";
            stack.dataset.pushPreviewStack = "1";
            const defenderToken = buildPieceToken(cellPiece);
            defenderToken.classList.add("stacked-piece", "stacked-underlay", "stacked-pushed");
            stack.appendChild(defenderToken);
            cell.appendChild(stack);
          } else {
            const recordedActionStartPiece =
              overlay?.mode === "recorded-action" && overlay?.recordedActionStartPiece
                ? overlay.recordedActionStartPiece
                : null;
            const shouldRenderRecordedActionStartPiece =
              overlay?.mode === "recorded-action" &&
              recordedActionStartPiece &&
              overlay?.recordedAction?.from?.row === row &&
              overlay?.recordedAction?.from?.col === col &&
              cellPiece?.id === recordedActionStartPiece.id;
            const markerPiece = shouldRenderRecordedActionStartPiece ? recordedActionStartPiece : cellPiece;
            const marker = markerPiece ? buildPieceToken(markerPiece) : document.createElement("span");
            if (!markerPiece) {
              marker.className = "piece-empty";
              marker.setAttribute("aria-hidden", "true");
            }
            cell.appendChild(marker);
          }

          if (removalEffect?.piece) {
            const removalPiece = buildPieceToken(removalEffect.piece);
            removalPiece.classList.add("removal-piece");
            const animationDelayMs = getRemovalAnimationDelayMs(removalEffect);
            if (animationDelayMs > 0) {
              removalPiece.style.animationDelay = `-${animationDelayMs}ms`;
            }
            cell.appendChild(removalPiece);
          }

          const destroyedPiece = destroyedByCoordinateKey.get(`${row},${col}`);
          if (destroyedPiece) {
            cell.classList.add("history-destruction-cell");
            cell.appendChild(buildDestroyedPieceOverlayToken(destroyedPiece));
          }

          if (isSupplyPoint(row, col)) {
            const supplyMarker = document.createElement("span");
            supplyMarker.className = "supply-point-marker";
            if (row === 0 && col === BOARD_SIZE - 1) {
              supplyMarker.classList.add("supply-point-p1");
            } else if (row === BOARD_SIZE - 1 && col === 0) {
              supplyMarker.classList.add("supply-point-p2");
            }
            supplyMarker.textContent = "◆";
            cell.appendChild(supplyMarker);
          }

          if (row === BOARD_SIZE - 1) {
            const colAxis = document.createElement("span");
            colAxis.className = "axis-label col-axis";
            const source = effectiveSelection.source;
            const target = effectiveSelection.target;
            const hasDifferentTarget = Boolean(
              source &&
                target &&
                (source.row !== target.row || source.col !== target.col),
            );
            if (source && col === source.col) {
              colAxis.classList.add("axis-strong");
            } else if (hasDifferentTarget && target && col === target.col && (!source || source.col !== target.col)) {
              colAxis.classList.add("axis-medium");
              if (
                isLiveInteractiveBoard &&
                !isContinuationHighlightedSquare(row, col) &&
                effectiveInteractionMode === "interactive"
              ) {
                if (snapshot?.sideToMove === "P1") {
                  colAxis.classList.add("axis-target-p1");
                } else if (snapshot?.sideToMove === "P2") {
                  colAxis.classList.add("axis-target-p2");
                }
              }
            }
            colAxis.textContent = String(col);
            cell.appendChild(colAxis);
          }

          if (col === 0) {
            const rowAxis = document.createElement("span");
            rowAxis.className = "axis-label row-axis";
            const source = effectiveSelection.source;
            const target = effectiveSelection.target;
            const hasDifferentTarget = Boolean(
              source &&
                target &&
                (source.row !== target.row || source.col !== target.col),
            );
            if (source && row === source.row) {
              rowAxis.classList.add("axis-strong");
            } else if (hasDifferentTarget && target && row === target.row && (!source || source.row !== target.row)) {
              rowAxis.classList.add("axis-medium");
              if (
                isLiveInteractiveBoard &&
                !isContinuationHighlightedSquare(row, col) &&
                effectiveInteractionMode === "interactive"
              ) {
                if (snapshot?.sideToMove === "P1") {
                  rowAxis.classList.add("axis-target-p1");
                } else if (snapshot?.sideToMove === "P2") {
                  rowAxis.classList.add("axis-target-p2");
                }
              }
            }
            rowAxis.textContent = String(row);
            cell.appendChild(rowAxis);
          }

          boardEl.appendChild(cell);
          cellByCoordinateKey.set(`${row},${col}`, cell);
        }
      }

      renderPieceOverlays({
        snapshot,
        overlay,
        legalActions,
        selectedPieceId: selection.selectedPieceId,
        selectedPieceMoves,
        selectedPieceMovePreviews,
        currentActionType,
        selectedPieceOverlayPhase,
      });
    },

    getCommanderSupplySummary(snapshot) {
      const c1 = snapshot.pieces.find((piece) => piece.id === "C1");
      const c2 = snapshot.pieces.find((piece) => piece.id === "C2");
      return `C1=${getPieceRenderStatus(c1).supplied} | C2=${getPieceRenderStatus(c2).supplied}`;
    },

    getSelectedPieceSummary({ snapshot, overlay, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) {
      if (overlay?.mode && overlay.mode !== "interactive") {
        return null;
      }
      const selectedPiece = findPieceById(snapshot, selectedPieceId);
      if (!selectedPiece) {
        return null;
      }

      const groupInfo = getGroupInfoForPiece(snapshot, selectedPiece);
      return {
        details: {
          id: selectedPiece.id,
          owner: selectedPiece.owner,
          kind: selectedPiece.kind,
          position: selectedPiece.position,
          supplied: getPieceRenderStatus(selectedPiece).supplied,
          commanded: getPieceRenderStatus(selectedPiece).commanded,
          actionableSupplied: selectedPiece.supplied,
          actionableCommanded: selectedPiece.commanded,
          groupComponentId: groupInfo.componentId,
          groupStrength: groupInfo.strength,
        },
        actions: (Array.isArray(selectedPieceMovePreviews) ? selectedPieceMovePreviews : selectedPieceMoves).map((action) => ({
          type: action.type,
          from: action.from ?? null,
          to: action.to ?? null,
          legal: action.legal ?? true,
          blockedReason: action.blockedReason ?? null,
        })),
      };
    },
  };
}
