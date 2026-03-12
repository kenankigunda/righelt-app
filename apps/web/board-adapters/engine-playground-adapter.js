import {
  deriveContinuationHighlightByPieceId,
  getBlockedPreviewLabel,
  pickBestActionTypeForTarget,
  shouldAllowSelectionAtTarget,
  shouldPreferActionTargetOnOccupiedCell,
} from "../interaction.js";

const BOARD_SIZE = 10;
const SVG_NS = "http://www.w3.org/2000/svg";
const REMOVAL_FLASH_DURATION_MS = 1800;

const coordKey = (coord) => `${coord.row},${coord.col}`;
const isSupplyPoint = (row, col) => (row === 0 && col === 9) || (row === 9 && col === 0);
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
  const { movedPieceIds, pendingPieceIds } = deriveContinuationHighlightByPieceId(snapshot, legalActions);
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
}

export function createEnginePlaygroundBoardAdapter() {
  let boardEl = null;
  let overlayLinesEl = null;
  let onCellClick = null;
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

  const drawPath = (path, stroke, dashPattern = null) => {
    if (!overlayLinesEl || !path || path.length < 2) {
      return;
    }

    for (let i = 0; i < path.length - 1; i += 1) {
      const start = getCellCenter(path[i]);
      const end = getCellCenter(path[i + 1]);
      if (!start || !end) {
        continue;
      }

      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(start.x));
      line.setAttribute("y1", String(start.y));
      line.setAttribute("x2", String(end.x));
      line.setAttribute("y2", String(end.y));
      line.setAttribute("stroke", stroke);
      line.setAttribute("stroke-width", "3");
      line.setAttribute("stroke-linecap", "round");
      if (dashPattern) {
        line.setAttribute("stroke-dasharray", dashPattern);
      }
      overlayLinesEl.appendChild(line);
    }
  };

  const clearCellDecorations = () => {
    for (const cell of cellByCoordinateKey.values()) {
      cell.classList.remove(
        "group-member",
        "continuation-member",
        "continuation-moved",
        "continuation-pending",
        "retreat-piece",
        "selected-piece",
        "inactive-selected-piece",
      );
      cell.removeAttribute("data-inactive-label");
      cell.querySelectorAll(".group-strength-badge,.move-ghost").forEach((node) => node.remove());
    }
  };

  const renderPieceOverlays = ({ snapshot, legalActions, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
    if (!overlayLinesEl) {
      return;
    }

    clearCellDecorations();
    overlayLinesEl.innerHTML = "";
    setOverlayViewBox();

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

    const groupInfo = getGroupInfoForPiece(snapshot, piece);
    if (groupInfo.members.length > 0) {
      const memberPieces = groupInfo.members
        .map((pieceId) => findPieceById(snapshot, pieceId))
        .filter((candidate) => Boolean(candidate));

      for (const member of memberPieces) {
        const memberCell = cellByCoordinateKey.get(coordKey(member.position));
        memberCell?.classList.add("group-member");
      }

      const anchor = memberPieces
        .map((member) => member.position)
        .sort((a, b) => {
          if (a.row !== b.row) {
            return a.row - b.row;
          }
          return a.col - b.col;
        })[0];

      if (anchor) {
        const anchorCell = cellByCoordinateKey.get(coordKey(anchor));
        if (anchorCell && typeof groupInfo.strength === "number") {
          const badge = document.createElement("span");
          badge.className = "group-strength-badge";
          badge.textContent = String(groupInfo.strength);
          anchorCell.appendChild(badge);
        }
      }
    }

    applyContinuationHighlights(snapshot, legalActions, cellByCoordinateKey);
    if (snapshot?.continuation?.type === "push" && snapshot.continuation.phase === "retreat") {
      const pushedPiece = findPieceById(snapshot, snapshot.continuation.pushedPieceId);
      if (pushedPiece) {
        cellByCoordinateKey.get(coordKey(pushedPiece.position))?.classList.add("retreat-piece");
      }
    }

    drawPath(getSupplyPathForPiece(snapshot, piece), "#2f8e63");
    drawPath(getCommandPathForPiece(snapshot, piece), "#2470c7");

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
      const preferredActionType = pickBestActionTypeForTarget(actionsAtTarget, null);
      const action = actionsAtTarget.find((candidate) => candidate.type === preferredActionType) ?? actionsAtTarget[0];
      if (!action?.to) {
        continue;
      }
      const targetCell = cellByCoordinateKey.get(targetKey);
      if (targetCell) {
        const ghost = buildPieceToken(action.previewPiece ?? piece, true);
        ghost.classList.add("move-ghost");
        if (action.type === "project") {
          ghost.classList.add("preview-created");
        }
        if (action.legal === false && action.blockedReason === "SUPPLY_DESTINATION_UNSUPPLIED") {
          ghost.classList.add("illegal-unsupplied");
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

  return {
    id: "engine-playground",

    getCapabilities() {
      return {
        live: true,
        history: false,
        tutorial: false,
        offlineLocal: false,
      };
    },

    mount(options) {
      boardEl = options.boardEl;
      overlayLinesEl = options.overlayLinesEl;
      onCellClick = options.onCellClick;
      boardEl.addEventListener("click", onBoardClick);
    },

    unmount() {
      if (boardEl) {
        boardEl.removeEventListener("click", onBoardClick);
      }
      boardEl = null;
      overlayLinesEl = null;
      onCellClick = null;
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
      legalActions,
      selectedPieceMoves,
      selectedPieceMovePreviews,
      removalEffects,
      allowFreeSelection,
      currentActionType,
    }) {
      if (!boardEl) {
        throw new Error("Adapter not mounted");
      }

      boardEl.innerHTML = "";
      cellByCoordinateKey = new Map();
      const removalByCoordinateKey = new Map(
        (Array.isArray(removalEffects) ? removalEffects : []).map((effect) => [coordKey(effect.position), effect]),
      );

      for (let row = 0; row < BOARD_SIZE; row += 1) {
        for (let col = 0; col < BOARD_SIZE; col += 1) {
          const cell = document.createElement("button");
          cell.type = "button";
          cell.className = "cell";
          const cellPiece = findPieceAt(snapshot, row, col);
          const hasSource = Boolean(selection.source);
          const previews = Array.isArray(selectedPieceMovePreviews) ? selectedPieceMovePreviews : selectedPieceMoves;
          const previewsAtCell = previews.filter(
            (action) => action.to && action.to.row === row && action.to.col === col,
          );
          const legalAtCell = selectedPieceMoves.filter(
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
            cell.classList.add("removal-effect");
            cell.setAttribute("data-removal-label", removalEffect.message);
          }

          const isSource = selection.source && selection.source.row === row && selection.source.col === col;
          const isTarget = selection.target && selection.target.row === row && selection.target.col === col;
          if (isSource) cell.classList.add("source");
          if (isTarget) {
            cell.classList.add("target");
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
          } else {
            const marker = cellPiece ? buildPieceToken(cellPiece) : document.createElement("span");
            if (!cellPiece) {
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

          if (isSupplyPoint(row, col)) {
            const supplyMarker = document.createElement("span");
            supplyMarker.className = "supply-point-marker";
            supplyMarker.textContent = "◆";
            cell.appendChild(supplyMarker);
          }

          if (row === BOARD_SIZE - 1) {
            const colAxis = document.createElement("span");
            colAxis.className = "axis-label col-axis";
            const source = selection.source;
            const target = selection.target;
            const hasDifferentTarget = Boolean(
              source &&
                target &&
                (source.row !== target.row || source.col !== target.col),
            );
            if (source && col === source.col) {
              colAxis.classList.add("axis-strong");
            } else if (hasDifferentTarget && target && col === target.col && (!source || source.col !== target.col)) {
              colAxis.classList.add("axis-medium");
            }
            colAxis.textContent = String(col);
            cell.appendChild(colAxis);
          }

          if (col === 0) {
            const rowAxis = document.createElement("span");
            rowAxis.className = "axis-label row-axis";
            const source = selection.source;
            const target = selection.target;
            const hasDifferentTarget = Boolean(
              source &&
                target &&
                (source.row !== target.row || source.col !== target.col),
            );
            if (source && row === source.row) {
              rowAxis.classList.add("axis-strong");
            } else if (hasDifferentTarget && target && row === target.row && (!source || source.row !== target.row)) {
              rowAxis.classList.add("axis-medium");
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
        legalActions,
        selectedPieceId: selection.selectedPieceId,
        selectedPieceMoves,
        selectedPieceMovePreviews,
      });
    },

    getCommanderSupplySummary(snapshot) {
      const c1 = snapshot.pieces.find((piece) => piece.id === "C1");
      const c2 = snapshot.pieces.find((piece) => piece.id === "C2");
      return `C1=${getPieceRenderStatus(c1).supplied} | C2=${getPieceRenderStatus(c2).supplied}`;
    },

    getSelectedPieceSummary({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) {
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
