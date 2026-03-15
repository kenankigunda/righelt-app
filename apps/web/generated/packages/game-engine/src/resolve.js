import { validateAction } from "./legal.js";
const MAX_RESOLVE_PASSES = 64;
const SUPPLY_POINTS = {
    P1: { row: 0, col: 9 },
    P2: { row: 9, col: 0 },
};
function sortIds(ids) {
    return [...ids].sort((a, b) => a.localeCompare(b));
}
function coordinateKey(row, col) {
    return `${row},${col}`;
}
function parseCoordinateKey(key) {
    const [row, col] = key.split(",").map((value) => Number(value));
    return { row, col };
}
function isInBounds(boardSize, row, col) {
    return row >= 0 && row < boardSize && col >= 0 && col < boardSize;
}
function sortedOrthogonalNeighbors(boardSize, row, col) {
    return [
        { row: row - 1, col },
        { row: row + 1, col },
        { row, col: col - 1 },
        { row, col: col + 1 },
    ]
        .filter((next) => isInBounds(boardSize, next.row, next.col))
        .sort((a, b) => {
        if (a.row !== b.row) {
            return a.row - b.row;
        }
        return a.col - b.col;
    });
}
function cloneState(state) {
    return {
        ...state,
        pieces: state.pieces.map((piece) => ({
            ...piece,
            position: { ...piece.position },
        })),
        continuation: state.continuation
            ? {
                ...state.continuation,
                followGroupPieceIds: state.continuation.followGroupPieceIds ? [...state.continuation.followGroupPieceIds] : undefined,
                followPoint: state.continuation.followPoint ? { ...state.continuation.followPoint } : undefined,
                frozenPieceStatesById: state.continuation.frozenPieceStatesById
                    ? Object.fromEntries(Object.entries(state.continuation.frozenPieceStatesById).map(([pieceId, frozenState]) => [
                        pieceId,
                        { ...frozenState },
                    ]))
                    : undefined,
                rushedPieceIds: state.continuation.rushedPieceIds ? [...state.continuation.rushedPieceIds] : undefined,
            }
            : null,
        outcome: { ...state.outcome },
        artifacts: state.artifacts ? JSON.parse(JSON.stringify(state.artifacts)) : undefined,
    };
}
function networkPieces(state) {
    return state.pieces.filter((piece) => !piece.pushed);
}
function isFrozenPieceDuringContinuation(state, pieceId, owner) {
    return Boolean(state.continuation?.frozenOwner === owner && state.continuation.frozenPieceStatesById?.[pieceId]);
}
function setPieceDisplayStatus(piece, nextSupplied, nextCommanded) {
    let changed = false;
    if (typeof nextSupplied === "boolean" && piece.displaySupplied !== nextSupplied) {
        piece.displaySupplied = nextSupplied;
        changed = true;
    }
    if (typeof nextCommanded === "boolean" && piece.displayCommanded !== nextCommanded) {
        piece.displayCommanded = nextCommanded;
        changed = true;
    }
    return changed;
}
function computeSupplyForOwner(state, owner) {
    const enemyBlockedByEdge = new Set();
    for (const edge of buildCommandEdges(state)) {
        if (edge.owner === owner) {
            continue;
        }
        if (edge.from.row === edge.to.row) {
            const row = edge.from.row;
            const startCol = Math.min(edge.from.col, edge.to.col) + 1;
            const endCol = Math.max(edge.from.col, edge.to.col);
            for (let col = startCol; col < endCol; col += 1) {
                enemyBlockedByEdge.add(coordinateKey(row, col));
            }
            continue;
        }
        if (edge.from.col === edge.to.col) {
            const col = edge.from.col;
            const startRow = Math.min(edge.from.row, edge.to.row) + 1;
            const endRow = Math.max(edge.from.row, edge.to.row);
            for (let row = startRow; row < endRow; row += 1) {
                enemyBlockedByEdge.add(coordinateKey(row, col));
            }
        }
    }
    const supplyPoint = SUPPLY_POINTS[owner];
    const occupiedByCoordinate = new Map(networkPieces(state).map((piece) => [coordinateKey(piece.position.row, piece.position.col), piece]));
    const isTraversable = (row, col) => {
        if (enemyBlockedByEdge.has(coordinateKey(row, col))) {
            return false;
        }
        const occupant = occupiedByCoordinate.get(coordinateKey(row, col));
        if (!occupant) {
            return true;
        }
        return occupant.owner === owner;
    };
    const supplyKey = coordinateKey(supplyPoint.row, supplyPoint.col);
    const visited = new Set();
    const parentByKey = new Map();
    if (isTraversable(supplyPoint.row, supplyPoint.col)) {
        visited.add(supplyKey);
        parentByKey.set(supplyKey, null);
        const queue = [{ row: supplyPoint.row, col: supplyPoint.col }];
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                break;
            }
            for (const next of sortedOrthogonalNeighbors(state.boardSize, current.row, current.col)) {
                const nextKey = coordinateKey(next.row, next.col);
                if (visited.has(nextKey) || !isTraversable(next.row, next.col)) {
                    continue;
                }
                visited.add(nextKey);
                parentByKey.set(nextKey, coordinateKey(current.row, current.col));
                queue.push(next);
            }
        }
    }
    const suppliedByPieceId = {};
    const shortestPathByPieceId = {};
    const distanceByPieceId = {};
    for (const piece of state.pieces.filter((candidate) => candidate.owner === owner && !candidate.pushed)) {
        const pieceKey = coordinateKey(piece.position.row, piece.position.col);
        const supplied = visited.has(pieceKey);
        suppliedByPieceId[piece.id] = supplied;
        if (!supplied) {
            continue;
        }
        const path = [];
        let cursor = pieceKey;
        while (cursor) {
            path.push(parseCoordinateKey(cursor));
            cursor = parentByKey.get(cursor);
        }
        shortestPathByPieceId[piece.id] = path;
        distanceByPieceId[piece.id] = Math.max(0, path.length - 1);
    }
    return {
        suppliedByPieceId,
        shortestPathByPieceId,
        distanceByPieceId,
        reachability: sortIds(Object.entries(suppliedByPieceId)
            .filter(([, supplied]) => supplied)
            .map(([pieceId]) => pieceId)),
    };
}
function computeBaselineArtifacts(state, mode) {
    const visiblePieces = networkPieces(state);
    const p1Pieces = visiblePieces.filter((piece) => piece.owner === "P1");
    const p2Pieces = visiblePieces.filter((piece) => piece.owner === "P2");
    const p1Components = Object.fromEntries(sortIds(p1Pieces.map((piece) => piece.id)).map((pieceId) => [pieceId, `P1:${pieceId}`]));
    const p2Components = Object.fromEntries(sortIds(p2Pieces.map((piece) => piece.id)).map((pieceId) => [pieceId, `P2:${pieceId}`]));
    return {
        mode,
        supply: [
            {
                player: "P1",
                reachability: sortIds(p1Pieces.filter((piece) => piece.supplied).map((piece) => piece.id)),
                shortestPathByPieceId: {},
                distanceByPieceId: {},
            },
            {
                player: "P2",
                reachability: sortIds(p2Pieces.filter((piece) => piece.supplied).map((piece) => piece.id)),
                shortestPathByPieceId: {},
                distanceByPieceId: {},
            },
        ],
        command: {
            candidateEdges: [],
            cutEdges: [],
            activeEdges: [],
            shortestPathToCommanderByPieceId: {},
        },
        groups: {
            componentByPieceId: {
                ...p1Components,
                ...p2Components,
            },
            membersByComponentId: Object.fromEntries([
                ...Object.keys(p1Components).map((pieceId) => [`P1:${pieceId}`, [pieceId]]),
                ...Object.keys(p2Components).map((pieceId) => [`P2:${pieceId}`, [pieceId]]),
            ]),
            strengthByComponentId: Object.fromEntries([
                ...Object.keys(p1Components).map((pieceId) => [`P1:${pieceId}`, 1]),
                ...Object.keys(p2Components).map((pieceId) => [`P2:${pieceId}`, 1]),
            ]),
        },
    };
}
function makeEdgeId(aId, bId) {
    return aId.localeCompare(bId) <= 0 ? `${aId}|${bId}` : `${bId}|${aId}`;
}
function isClearOrthogonalLine(state, a, b, occupied) {
    if (a.row !== b.row && a.col !== b.col) {
        return false;
    }
    if (a.row === b.row) {
        const start = Math.min(a.col, b.col) + 1;
        const end = Math.max(a.col, b.col);
        for (let col = start; col < end; col += 1) {
            if (occupied.has(coordinateKey(a.row, col))) {
                return false;
            }
        }
        return true;
    }
    const start = Math.min(a.row, b.row) + 1;
    const end = Math.max(a.row, b.row);
    for (let row = start; row < end; row += 1) {
        if (occupied.has(coordinateKey(row, a.col))) {
            return false;
        }
    }
    return true;
}
function orientation(a, b, c) {
    return (b.col - a.col) * (c.row - a.row) - (b.row - a.row) * (c.col - a.col);
}
function samePoint(left, right) {
    return left.row === right.row && left.col === right.col;
}
function pointStrictlyInsideSegment(point, a, b) {
    const minRow = Math.min(a.row, b.row);
    const maxRow = Math.max(a.row, b.row);
    const minCol = Math.min(a.col, b.col);
    const maxCol = Math.max(a.col, b.col);
    return (point.row >= minRow &&
        point.row <= maxRow &&
        point.col >= minCol &&
        point.col <= maxCol &&
        !samePoint(point, a) &&
        !samePoint(point, b));
}
function collinearSegmentsOverlapInInterior(edgeA, edgeB) {
    const vertical = edgeA.from.col === edgeA.to.col && edgeB.from.col === edgeB.to.col && edgeA.from.col === edgeB.from.col;
    if (vertical) {
        const start = Math.max(Math.min(edgeA.from.row, edgeA.to.row), Math.min(edgeB.from.row, edgeB.to.row));
        const end = Math.min(Math.max(edgeA.from.row, edgeA.to.row), Math.max(edgeB.from.row, edgeB.to.row));
        return end > start;
    }
    const horizontal = edgeA.from.row === edgeA.to.row && edgeB.from.row === edgeB.to.row && edgeA.from.row === edgeB.from.row;
    if (horizontal) {
        const start = Math.max(Math.min(edgeA.from.col, edgeA.to.col), Math.min(edgeB.from.col, edgeB.to.col));
        const end = Math.min(Math.max(edgeA.from.col, edgeA.to.col), Math.max(edgeB.from.col, edgeB.to.col));
        return end > start;
    }
    const diagonalSlopeA = {
        row: edgeA.to.row - edgeA.from.row,
        col: edgeA.to.col - edgeA.from.col,
    };
    const diagonalSlopeB = {
        row: edgeB.to.row - edgeB.from.row,
        col: edgeB.to.col - edgeB.from.col,
    };
    if (Math.abs(diagonalSlopeA.row) !== Math.abs(diagonalSlopeA.col) || Math.abs(diagonalSlopeB.row) !== Math.abs(diagonalSlopeB.col)) {
        return false;
    }
    const sameSlopeSign = Math.sign(diagonalSlopeA.row) === Math.sign(diagonalSlopeA.col) &&
        Math.sign(diagonalSlopeB.row) === Math.sign(diagonalSlopeB.col);
    const oppositeSlopeSign = Math.sign(diagonalSlopeA.row) === -Math.sign(diagonalSlopeA.col) &&
        Math.sign(diagonalSlopeB.row) === -Math.sign(diagonalSlopeB.col);
    if (!sameSlopeSign && !oppositeSlopeSign) {
        return false;
    }
    const project = sameSlopeSign
        ? (point) => point.row + point.col
        : (point) => point.row - point.col;
    const start = Math.max(Math.min(project(edgeA.from), project(edgeA.to)), Math.min(project(edgeB.from), project(edgeB.to)));
    const end = Math.min(Math.max(project(edgeA.from), project(edgeA.to)), Math.max(project(edgeB.from), project(edgeB.to)));
    return end > start;
}
function segmentIntersectionPoint(edgeA, edgeB) {
    const a = edgeA.from;
    const b = edgeA.to;
    const c = edgeB.from;
    const d = edgeB.to;
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);
    if (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0) {
        return collinearSegmentsOverlapInInterior(edgeA, edgeB) ? { row: Number.NaN, col: Number.NaN } : null;
    }
    if ((o1 === 0 && pointStrictlyInsideSegment(c, a, b)) || (o2 === 0 && pointStrictlyInsideSegment(d, a, b))) {
        return { row: o1 === 0 ? c.row : d.row, col: o1 === 0 ? c.col : d.col };
    }
    if ((o3 === 0 && pointStrictlyInsideSegment(a, c, d)) || (o4 === 0 && pointStrictlyInsideSegment(b, c, d))) {
        return { row: o3 === 0 ? a.row : b.row, col: o3 === 0 ? a.col : b.col };
    }
    if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) {
        const denominator = (a.row - b.row) * (c.col - d.col) - (a.col - b.col) * (c.row - d.row);
        if (denominator === 0) {
            return { row: Number.NaN, col: Number.NaN };
        }
        const determinantA = a.row * b.col - a.col * b.row;
        const determinantB = c.row * d.col - c.col * d.row;
        return {
            row: (determinantA * (c.row - d.row) - (a.row - b.row) * determinantB) / denominator,
            col: (determinantA * (c.col - d.col) - (a.col - b.col) * determinantB) / denominator,
        };
    }
    return null;
}
function buildCommandEdges(state) {
    const visiblePieces = networkPieces(state);
    const occupied = new Map(visiblePieces.map((piece) => [coordinateKey(piece.position.row, piece.position.col), piece.id]));
    const edges = new Map();
    for (const owner of ["P1", "P2"]) {
        const ownPieces = visiblePieces
            .filter((piece) => piece.owner === owner)
            .sort((a, b) => a.id.localeCompare(b.id));
        for (let i = 0; i < ownPieces.length; i += 1) {
            for (let j = i + 1; j < ownPieces.length; j += 1) {
                const a = ownPieces[i];
                const b = ownPieces[j];
                const rowDelta = Math.abs(a.position.row - b.position.row);
                const colDelta = Math.abs(a.position.col - b.position.col);
                const diagonalAllowed = rowDelta === 1 && colDelta === 1;
                const orthogonalVisible = (a.position.row === b.position.row || a.position.col === b.position.col) &&
                    isClearOrthogonalLine(state, a.position, b.position, occupied);
                if (!diagonalAllowed && !orthogonalVisible) {
                    continue;
                }
                const id = makeEdgeId(a.id, b.id);
                edges.set(id, {
                    owner,
                    fromId: a.id,
                    toId: b.id,
                    from: { ...a.position },
                    to: { ...b.position },
                    id,
                });
            }
        }
    }
    return [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function applyCommandPhase(state, mode) {
    const edges = buildCommandEdges(state);
    const edgesByOwner = {
        P1: edges.filter((edge) => edge.owner === "P1"),
        P2: edges.filter((edge) => edge.owner === "P2"),
    };
    const cutEdges = new Set();
    for (const p1Edge of edgesByOwner.P1) {
        for (const p2Edge of edgesByOwner.P2) {
            if (segmentIntersectionPoint(p1Edge, p2Edge)) {
                cutEdges.add(p1Edge.id);
                cutEdges.add(p2Edge.id);
            }
        }
    }
    const activeEdges = edges.filter((edge) => !cutEdges.has(edge.id));
    let changed = false;
    const shortestPathToCommanderByPieceId = {};
    for (const owner of ["P1", "P2"]) {
        const commanderId = owner === "P1" ? "C1" : "C2";
        const visiblePieces = networkPieces(state);
        const ownPieceIds = sortIds(visiblePieces.filter((piece) => piece.owner === owner).map((piece) => piece.id));
        const adjacency = new Map();
        for (const pieceId of ownPieceIds) {
            adjacency.set(pieceId, []);
        }
        for (const edge of activeEdges.filter((candidate) => candidate.owner === owner)) {
            adjacency.get(edge.fromId)?.push(edge.toId);
            adjacency.get(edge.toId)?.push(edge.fromId);
        }
        for (const [pieceId, neighbors] of adjacency.entries()) {
            adjacency.set(pieceId, sortIds(neighbors));
        }
        const visited = new Set();
        const parent = new Map();
        const queue = [];
        if (adjacency.has(commanderId)) {
            queue.push(commanderId);
            visited.add(commanderId);
            parent.set(commanderId, null);
        }
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                break;
            }
            const neighbors = adjacency.get(current) ?? [];
            for (const next of neighbors) {
                if (visited.has(next)) {
                    continue;
                }
                visited.add(next);
                parent.set(next, current);
                queue.push(next);
            }
        }
        for (const piece of state.pieces.filter((candidate) => candidate.owner === owner)) {
            if (piece.pushed) {
                continue;
            }
            const nextCommanded = visited.has(piece.id);
            if (setPieceDisplayStatus(piece, undefined, nextCommanded)) {
                changed = true;
            }
            if (isFrozenPieceDuringContinuation(state, piece.id, piece.owner)) {
                continue;
            }
            if (piece.commanded !== nextCommanded) {
                piece.commanded = nextCommanded;
                changed = true;
            }
            if (mode === "full" && nextCommanded) {
                const pathNodes = [];
                let cursor = piece.id;
                while (cursor) {
                    pathNodes.push(cursor);
                    cursor = parent.get(cursor);
                }
                const pathCoordinates = [];
                for (const pathNodeId of pathNodes) {
                    const pathNode = state.pieces.find((candidate) => candidate.id === pathNodeId);
                    if (!pathNode) {
                        continue;
                    }
                    pathCoordinates.push({ row: pathNode.position.row, col: pathNode.position.col });
                }
                shortestPathToCommanderByPieceId[piece.id] = pathCoordinates;
            }
        }
    }
    const nextCommandArtifact = {
        candidateEdges: sortIds(edges.map((edge) => edge.id)),
        cutEdges: sortIds(cutEdges),
        activeEdges: sortIds(activeEdges.map((edge) => edge.id)),
        shortestPathToCommanderByPieceId: mode === "full" ? shortestPathToCommanderByPieceId : {},
    };
    if (!state.artifacts || JSON.stringify(state.artifacts.command) !== JSON.stringify(nextCommandArtifact)) {
        state.artifacts = state.artifacts
            ? {
                ...state.artifacts,
                command: nextCommandArtifact,
            }
            : {
                mode,
                supply: [],
                command: nextCommandArtifact,
                groups: {
                    componentByPieceId: {},
                    membersByComponentId: {},
                    strengthByComponentId: {},
                },
            };
        changed = true;
    }
    return changed;
}
function applyGroupPhase(state, mode) {
    const visiblePieces = networkPieces(state);
    const adjacency = new Map();
    for (const piece of visiblePieces) {
        adjacency.set(piece.id, []);
    }
    for (let i = 0; i < visiblePieces.length; i += 1) {
        for (let j = i + 1; j < visiblePieces.length; j += 1) {
            const left = visiblePieces[i];
            const right = visiblePieces[j];
            if (left.owner !== right.owner) {
                continue;
            }
            const rowDelta = Math.abs(left.position.row - right.position.row);
            const colDelta = Math.abs(left.position.col - right.position.col);
            if (rowDelta + colDelta !== 1) {
                continue;
            }
            adjacency.get(left.id)?.push(right.id);
            adjacency.get(right.id)?.push(left.id);
        }
    }
    for (const [pieceId, neighbors] of adjacency.entries()) {
        adjacency.set(pieceId, sortIds(neighbors));
    }
    const componentByPieceId = {};
    const membersByComponentId = {};
    const strengthByComponentId = {};
    const visited = new Set();
    const orderedPieces = [...visiblePieces].sort((a, b) => a.id.localeCompare(b.id));
    for (const startPiece of orderedPieces) {
        if (visited.has(startPiece.id)) {
            continue;
        }
        const queue = [startPiece.id];
        visited.add(startPiece.id);
        const componentMembers = [];
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                break;
            }
            componentMembers.push(current);
            for (const next of adjacency.get(current) ?? []) {
                if (visited.has(next)) {
                    continue;
                }
                visited.add(next);
                queue.push(next);
            }
        }
        const sortedMembers = sortIds(componentMembers);
        const componentId = `${startPiece.owner}:${sortedMembers[0]}`;
        membersByComponentId[componentId] = sortedMembers;
        strengthByComponentId[componentId] = sortedMembers.length;
        for (const pieceId of sortedMembers) {
            componentByPieceId[pieceId] = componentId;
        }
    }
    const nextGroupsArtifact = {
        componentByPieceId,
        membersByComponentId,
        strengthByComponentId,
    };
    if (!state.artifacts || JSON.stringify(state.artifacts.groups) !== JSON.stringify(nextGroupsArtifact)) {
        state.artifacts = state.artifacts
            ? {
                ...state.artifacts,
                groups: nextGroupsArtifact,
            }
            : {
                mode,
                supply: [],
                command: {
                    candidateEdges: [],
                    cutEdges: [],
                    activeEdges: [],
                    shortestPathToCommanderByPieceId: {},
                },
                groups: nextGroupsArtifact,
            };
        return true;
    }
    return false;
}
function applyContinuationPhase(state) {
    if (!state.continuation) {
        return false;
    }
    if (state.outcome.status !== "ongoing") {
        state.continuation = null;
        return true;
    }
    const expectedOwner = state.continuation.owner;
    if (state.sideToMove !== expectedOwner) {
        state.sideToMove = expectedOwner;
        return true;
    }
    if (state.continuation.type === "push") {
        const attackerOwner = state.continuation.attackerOwner ?? expectedOwner;
        if (state.continuation.phase === "retreat") {
            const pushedPiece = state.continuation.pushedPieceId
                ? state.pieces.find((piece) => piece.id === state.continuation?.pushedPieceId)
                : undefined;
            if (!pushedPiece) {
                state.continuation.phase = "follow";
                state.continuation.owner = attackerOwner;
                state.continuation.pushedPieceId = undefined;
                state.sideToMove = attackerOwner;
                return true;
            }
            const retreatCandidates = [
                { row: pushedPiece.position.row - 1, col: pushedPiece.position.col },
                { row: pushedPiece.position.row + 1, col: pushedPiece.position.col },
                { row: pushedPiece.position.row, col: pushedPiece.position.col - 1 },
                { row: pushedPiece.position.row, col: pushedPiece.position.col + 1 },
            ].filter((to) => validateAction(state, {
                type: "retreat",
                actorId: pushedPiece.id,
                from: pushedPiece.position,
                to,
            }).ok);
            if (retreatCandidates.length === 0) {
                state.pieces = state.pieces.filter((piece) => piece.id !== pushedPiece.id);
                state.continuation.phase = "follow";
                state.continuation.owner = attackerOwner;
                state.continuation.pushedPieceId = undefined;
                state.sideToMove = attackerOwner;
                return true;
            }
            return false;
        }
        const followPoint = state.continuation.followPoint;
        if (!followPoint) {
            state.continuation = null;
            state.sideToMove = attackerOwner === "P1" ? "P2" : "P1";
            state.turnIndex += 1;
            return true;
        }
        const occupied = state.pieces.some((piece) => !piece.pushed && piece.position.row === followPoint.row && piece.position.col === followPoint.col);
        if (occupied) {
            return false;
        }
        const allowedPieces = new Set(state.continuation.followGroupPieceIds ?? []);
        const hasFriendlyAdjacent = state.pieces.some((piece) => {
            if (piece.owner !== expectedOwner ||
                piece.pushed ||
                piece.shifted ||
                (allowedPieces.size > 0 && !allowedPieces.has(piece.id))) {
                return false;
            }
            const rowDelta = Math.abs(piece.position.row - followPoint.row);
            const colDelta = Math.abs(piece.position.col - followPoint.col);
            return rowDelta + colDelta === 1;
        });
        if (!hasFriendlyAdjacent) {
            state.continuation = null;
            state.sideToMove = attackerOwner === "P1" ? "P2" : "P1";
            state.turnIndex += 1;
            for (const piece of state.pieces) {
                if (piece.shifted) {
                    piece.shifted = false;
                }
            }
            return true;
        }
        return false;
    }
    if (state.continuation.type === "rush") {
        const hasRushCandidate = state.pieces
            .filter((piece) => piece.owner === expectedOwner)
            .some((piece) => {
            for (let rowDelta = -1; rowDelta <= 1; rowDelta += 1) {
                for (let colDelta = -1; colDelta <= 1; colDelta += 1) {
                    if (rowDelta === 0 && colDelta === 0) {
                        continue;
                    }
                    const candidate = {
                        type: "rush",
                        actorId: piece.id,
                        from: piece.position,
                        to: {
                            row: piece.position.row + rowDelta,
                            col: piece.position.col + colDelta,
                        },
                    };
                    if (validateAction(state, candidate).ok) {
                        return true;
                    }
                }
            }
            return false;
        });
        if (!hasRushCandidate) {
            state.continuation = null;
            state.sideToMove = expectedOwner === "P1" ? "P2" : "P1";
            return true;
        }
    }
    return false;
}
function applySupplyPhase(state, mode) {
    const p1Supply = computeSupplyForOwner(state, "P1");
    const p2Supply = computeSupplyForOwner(state, "P2");
    let changed = false;
    for (const piece of state.pieces) {
        if (piece.pushed) {
            continue;
        }
        if (isFrozenPieceDuringContinuation(state, piece.id, piece.owner)) {
            const ownerSupply = piece.owner === "P1" ? p1Supply : p2Supply;
            const nextSupplied = Boolean(ownerSupply.suppliedByPieceId[piece.id]);
            if (setPieceDisplayStatus(piece, nextSupplied, undefined)) {
                changed = true;
            }
            continue;
        }
        const ownerSupply = piece.owner === "P1" ? p1Supply : p2Supply;
        const nextSupplied = Boolean(ownerSupply.suppliedByPieceId[piece.id]);
        if (setPieceDisplayStatus(piece, nextSupplied, undefined)) {
            changed = true;
        }
        if (piece.supplied !== nextSupplied) {
            piece.supplied = nextSupplied;
            changed = true;
        }
    }
    const nextSupplyArtifacts = [
        {
            player: "P1",
            reachability: p1Supply.reachability,
            shortestPathByPieceId: mode === "full" ? p1Supply.shortestPathByPieceId : {},
            distanceByPieceId: mode === "full" ? p1Supply.distanceByPieceId : {},
        },
        {
            player: "P2",
            reachability: p2Supply.reachability,
            shortestPathByPieceId: mode === "full" ? p2Supply.shortestPathByPieceId : {},
            distanceByPieceId: mode === "full" ? p2Supply.distanceByPieceId : {},
        },
    ];
    if (!state.artifacts || JSON.stringify(state.artifacts.supply) !== JSON.stringify(nextSupplyArtifacts)) {
        state.artifacts = state.artifacts
            ? {
                ...state.artifacts,
                supply: nextSupplyArtifacts,
            }
            : {
                mode,
                supply: nextSupplyArtifacts,
                command: {
                    candidateEdges: [],
                    cutEdges: [],
                    activeEdges: [],
                    shortestPathToCommanderByPieceId: {},
                },
                groups: {
                    componentByPieceId: {},
                    membersByComponentId: {},
                    strengthByComponentId: {},
                },
            };
        changed = true;
    }
    return changed;
}
function applyForcedEffectsPhase(state) {
    const beforeCount = state.pieces.length;
    state.pieces = state.pieces.filter((piece) => piece.pushed ||
        piece.kind === "commander" ||
        piece.supplied ||
        isFrozenPieceDuringContinuation(state, piece.id, piece.owner));
    return state.pieces.length !== beforeCount;
}
function evaluateTerminalPhase(state) {
    if (state.outcome.status !== "ongoing") {
        return false;
    }
    const commanderByOwner = {
        P1: state.pieces.find((piece) => piece.id === "C1"),
        P2: state.pieces.find((piece) => piece.id === "C2"),
    };
    const p1Supplied = Boolean(commanderByOwner.P1?.supplied);
    const p2Supplied = Boolean(commanderByOwner.P2?.supplied);
    if (p1Supplied && p2Supplied) {
        return false;
    }
    if (!p1Supplied && !p2Supplied) {
        state.outcome = { status: "draw", reason: "both_commanders_unsupplied" };
    }
    else if (!p1Supplied) {
        state.outcome = { status: "p2_win", reason: "p1_commander_unsupplied" };
    }
    else {
        state.outcome = { status: "p1_win", reason: "p2_commander_unsupplied" };
    }
    return true;
}
function runResolvePass(state, mode) {
    let changed = false;
    // Phase 1: connectivity + artifact baseline.
    const nextArtifacts = computeBaselineArtifacts(state, mode);
    if (state.artifacts?.supply) {
        nextArtifacts.supply = state.artifacts.supply;
    }
    if (state.artifacts?.command) {
        nextArtifacts.command = state.artifacts.command;
    }
    if (state.artifacts?.groups) {
        nextArtifacts.groups = state.artifacts.groups;
    }
    if (JSON.stringify(state.artifacts) !== JSON.stringify(nextArtifacts)) {
        state.artifacts = nextArtifacts;
        changed = true;
    }
    // Phase 2: supply.
    if (applySupplyPhase(state, mode)) {
        changed = true;
    }
    // Phase 3: command.
    if (applyCommandPhase(state, mode)) {
        changed = true;
    }
    // Phase 4: legal-set derivation + group composition baseline.
    if (applyGroupPhase(state, mode)) {
        changed = true;
    }
    if (applyContinuationPhase(state)) {
        changed = true;
    }
    // Action-family legality integration lands after Track A merge sync.
    // Phase 5: forced effects.
    if (applyForcedEffectsPhase(state)) {
        changed = true;
    }
    return changed;
}
export function resolveToStability(state, options) {
    const mode = options?.artifactMode ?? "minimal";
    const maxPasses = options?.maxPasses ?? MAX_RESOLVE_PASSES;
    let pass = 0;
    while (pass < maxPasses) {
        const changed = runResolvePass(state, mode);
        if (!changed) {
            if (evaluateTerminalPhase(state) && state.continuation) {
                state.continuation = null;
            }
            return state;
        }
        pass += 1;
    }
    throw new Error(`resolveToStability exceeded max passes (${maxPasses})`);
}
export function buildArtifacts(state) {
    const resolved = resolveToStability(cloneState(state), {
        artifactMode: "full",
    });
    return {
        supply: resolved.artifacts?.supply ?? [],
        command: resolved.artifacts?.command ?? {
            candidateEdges: [],
            cutEdges: [],
            activeEdges: [],
            shortestPathToCommanderByPieceId: {},
        },
        groups: resolved.artifacts?.groups ?? {
            componentByPieceId: {},
            membersByComponentId: {},
            strengthByComponentId: {},
        },
        status: resolved.outcome.status,
    };
}
