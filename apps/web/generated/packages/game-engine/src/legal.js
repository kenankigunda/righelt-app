import { BOARD_SIZE, SUPPLY_POINTS } from "./deterministic.js";
function outOfBounds(value) {
    if (!value) {
        return false;
    }
    return value.row < 0 || value.row >= BOARD_SIZE || value.col < 0 || value.col >= BOARD_SIZE;
}
function getPieceAt(state, value) {
    return state.pieces.find((piece) => piece.position.row === value.row && piece.position.col === value.col);
}
function hasPieceAt(state, value) {
    return Boolean(getPieceAt(state, value));
}
function sameCoordinate(left, right) {
    return Boolean(left && right && left.row === right.row && left.col === right.col);
}
function isOrthogonallyAdjacent(from, to) {
    const rowDelta = Math.abs(from.row - to.row);
    const colDelta = Math.abs(from.col - to.col);
    return rowDelta + colDelta === 1;
}
function isAnyAdjacent(from, to) {
    const rowDelta = Math.abs(from.row - to.row);
    const colDelta = Math.abs(from.col - to.col);
    return rowDelta <= 1 && colDelta <= 1 && !(rowDelta === 0 && colDelta === 0);
}
function isOrthogonalDistance(from, to, distance) {
    const rowDelta = Math.abs(from.row - to.row);
    const colDelta = Math.abs(from.col - to.col);
    return (rowDelta === distance && colDelta === 0) || (rowDelta === 0 && colDelta === distance);
}
function isActivePiece(piece) {
    return piece.supplied && piece.commanded && !piece.pushed && !piece.shifted;
}
function getFrozenPieceState(state, piece) {
    if (state.continuation?.frozenOwner !== piece.owner) {
        return null;
    }
    return state.continuation.frozenPieceStatesById?.[piece.id] ?? null;
}
function isActivePieceInContext(state, piece) {
    const frozen = getFrozenPieceState(state, piece);
    if (!frozen) {
        return isActivePiece(piece);
    }
    return isActivePiece({
        ...piece,
        supplied: frozen.supplied,
        commanded: frozen.commanded,
    });
}
function coordinateKey(row, col) {
    return `${row},${col}`;
}
function sortedOrthogonalNeighbors(row, col) {
    return [
        { row: row - 1, col },
        { row: row + 1, col },
        { row, col: col - 1 },
        { row, col: col + 1 },
    ]
        .filter((next) => !outOfBounds(next))
        .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));
}
function isClearOrthogonalLineForPieces(a, b, occupied) {
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
function buildCommandEdgesForPieces(pieces) {
    const occupied = new Map(pieces.map((piece) => [coordinateKey(piece.position.row, piece.position.col), piece.id]));
    const edges = [];
    for (const owner of ["P1", "P2"]) {
        const ownPieces = pieces
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
                    isClearOrthogonalLineForPieces(a.position, b.position, occupied);
                if (!diagonalAllowed && !orthogonalVisible) {
                    continue;
                }
                edges.push({
                    owner,
                    from: { ...a.position },
                    to: { ...b.position },
                });
            }
        }
    }
    return edges;
}
function isCoordinateSuppliedForOwner(pieces, owner, target) {
    const enemyBlockedByEdge = new Set();
    for (const edge of buildCommandEdgesForPieces(pieces)) {
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
    const occupiedByCoordinate = new Map(pieces.map((piece) => [coordinateKey(piece.position.row, piece.position.col), piece]));
    const supplyPoint = SUPPLY_POINTS[owner];
    const targetKey = coordinateKey(target.row, target.col);
    const supplyKey = coordinateKey(supplyPoint.row, supplyPoint.col);
    const isTraversable = (row, col) => {
        if (enemyBlockedByEdge.has(coordinateKey(row, col))) {
            return false;
        }
        const occupant = occupiedByCoordinate.get(coordinateKey(row, col));
        return !occupant || occupant.owner === owner;
    };
    const visited = new Set();
    if (!isTraversable(supplyPoint.row, supplyPoint.col)) {
        return false;
    }
    visited.add(supplyKey);
    const queue = [{ ...supplyPoint }];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
            break;
        }
        for (const next of sortedOrthogonalNeighbors(current.row, current.col)) {
            const nextKey = coordinateKey(next.row, next.col);
            if (visited.has(nextKey) || !isTraversable(next.row, next.col)) {
                continue;
            }
            visited.add(nextKey);
            queue.push(next);
        }
    }
    return visited.has(targetKey);
}
function wouldCoordinateBeSuppliedForOwner(pieces, owner, destination) {
    return isCoordinateSuppliedForOwner(pieces, owner, destination);
}
function wouldBeSuppliedAfterRelocation(state, actorId, owner, destination) {
    const hypothetical = state.pieces.map((piece) => ({
        id: piece.id,
        owner: piece.owner,
        position: piece.id === actorId ? { ...destination } : { ...piece.position },
    }));
    return wouldCoordinateBeSuppliedForOwner(hypothetical, owner, destination);
}
function wouldProjectedPieceBeSupplied(state, owner, destination) {
    const hypothetical = state.pieces.map((piece) => ({
        id: piece.id,
        owner: piece.owner,
        position: { ...piece.position },
    }));
    hypothetical.push({
        id: "__projected__",
        owner,
        position: { ...destination },
    });
    return wouldCoordinateBeSuppliedForOwner(hypothetical, owner, destination);
}
function wouldBeSuppliedAfterPush(state, actorId, defenderId, owner, destination) {
    const hypothetical = state.pieces
        .filter((piece) => piece.id !== defenderId)
        .map((piece) => ({
        id: piece.id,
        owner: piece.owner,
        position: piece.id === actorId ? { ...destination } : { ...piece.position },
    }));
    return wouldCoordinateBeSuppliedForOwner(hypothetical, owner, destination);
}
function resolveActor(state, action) {
    if (action.actorId) {
        return state.pieces.find((piece) => piece.id === action.actorId);
    }
    if (action.from) {
        return getPieceAt(state, action.from);
    }
    return undefined;
}
function localGroupStrength(state, pieceId) {
    return localGroupMembers(state, pieceId).length;
}
export function localGroupMembers(state, pieceId) {
    const seed = state.pieces.find((piece) => piece.id === pieceId);
    if (!seed) {
        return [];
    }
    const queue = [seed];
    const visited = new Set([seed.id]);
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
            break;
        }
        for (const candidate of state.pieces) {
            if (candidate.owner !== seed.owner || visited.has(candidate.id)) {
                continue;
            }
            if (isOrthogonallyAdjacent(candidate.position, current.position)) {
                visited.add(candidate.id);
                queue.push(candidate);
            }
        }
    }
    return [...visited].sort((a, b) => a.localeCompare(b));
}
function enemyAdjacentCount(state, owner, center) {
    return state.pieces.filter((piece) => piece.owner !== owner && isAnyAdjacent(piece.position, center)).length;
}
function getPushRetreatActions(state) {
    if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "retreat") {
        return [];
    }
    const pushedPiece = state.continuation.pushedPieceId
        ? state.pieces.find((piece) => piece.id === state.continuation?.pushedPieceId)
        : undefined;
    if (!pushedPiece) {
        return [];
    }
    return [
        { row: pushedPiece.position.row - 1, col: pushedPiece.position.col },
        { row: pushedPiece.position.row + 1, col: pushedPiece.position.col },
        { row: pushedPiece.position.row, col: pushedPiece.position.col - 1 },
        { row: pushedPiece.position.row, col: pushedPiece.position.col + 1 },
    ].map((to) => ({
        type: "retreat",
        actorId: pushedPiece.id,
        from: pushedPiece.position,
        to,
    })).filter((candidate) => validateAction(state, candidate).ok);
}
function getPushFollowActions(state) {
    if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "follow") {
        return [];
    }
    const followPoint = state.continuation.followPoint;
    if (!followPoint) {
        return [];
    }
    const allowedPieces = new Set(state.continuation.followGroupPieceIds ?? []);
    return state.pieces
        .filter((piece) => piece.owner === state.sideToMove && (allowedPieces.size === 0 || allowedPieces.has(piece.id)))
        .map((piece) => ({
        type: "follow",
        actorId: piece.id,
        from: piece.position,
        to: followPoint,
    }))
        .filter((candidate) => validateAction(state, candidate).ok);
}
function validateContinuation(state, action) {
    if (!state.continuation) {
        return null;
    }
    if (state.continuation.type === "push") {
        if (state.continuation.phase === "retreat") {
            if (action.type !== "retreat") {
                return {
                    ok: false,
                    code: "CONTINUATION_REQUIRED",
                    message: "Push retreat phase requires retreat action",
                };
            }
            return null;
        }
        if (action.type !== "follow") {
            return {
                ok: false,
                code: "CONTINUATION_REQUIRED",
                message: "Push follow phase requires follow action",
            };
        }
        return null;
    }
    if (state.continuation.type === "rush") {
        if (action.type !== "rush" && action.type !== "pass") {
            return {
                ok: false,
                code: "CONTINUATION_REQUIRED",
                message: "Rush continuation requires rush or pass",
            };
        }
    }
    return null;
}
export function listLegalActions(state) {
    if (state.outcome.status !== "ongoing") {
        return [];
    }
    if (state.continuation) {
        if (state.continuation.type === "rush") {
            const rushActions = state.pieces
                .filter((piece) => piece.owner === state.sideToMove)
                .flatMap((piece) => {
                const actions = [];
                for (let rowDelta = -1; rowDelta <= 1; rowDelta += 1) {
                    for (let colDelta = -1; colDelta <= 1; colDelta += 1) {
                        if (rowDelta === 0 && colDelta === 0) {
                            continue;
                        }
                        actions.push({
                            type: "rush",
                            actorId: piece.id,
                            from: piece.position,
                            to: {
                                row: piece.position.row + rowDelta,
                                col: piece.position.col + colDelta,
                            },
                        });
                    }
                }
                return actions.filter((candidate) => validateAction(state, candidate).ok);
            });
            return [...rushActions, { type: "pass" }];
        }
        return state.continuation.phase === "retreat" ? getPushRetreatActions(state) : getPushFollowActions(state);
    }
    const actions = [{ type: "pass" }];
    const withTargets = ["move", "project", "rush", "push"];
    for (const piece of state.pieces.filter((candidate) => candidate.owner === state.sideToMove)) {
        for (const type of withTargets) {
            for (let row = 0; row < BOARD_SIZE; row += 1) {
                for (let col = 0; col < BOARD_SIZE; col += 1) {
                    const action = {
                        type,
                        actorId: piece.id,
                        from: { ...piece.position },
                        to: { row, col },
                    };
                    if (validateAction(state, action).ok) {
                        actions.push(action);
                    }
                }
            }
        }
    }
    return actions;
}
export function validateAction(state, action) {
    if (state.outcome.status !== "ongoing") {
        return {
            ok: false,
            code: "TERMINAL_GAME",
            message: "No actions are legal after terminal outcome",
        };
    }
    if (outOfBounds(action.from) || outOfBounds(action.to)) {
        return {
            ok: false,
            code: "OUT_OF_BOUNDS",
            message: "Action coordinates must be inside board bounds",
        };
    }
    if (action.from && !hasPieceAt(state, action.from)) {
        return {
            ok: false,
            code: "SOURCE_EMPTY",
            message: "No piece exists at action source coordinate",
        };
    }
    const continuationValidation = validateContinuation(state, action);
    if (continuationValidation) {
        return continuationValidation;
    }
    if (action.type === "pass") {
        if (state.continuation && state.continuation.type !== "rush") {
            return {
                ok: false,
                code: "CONTINUATION_REQUIRED",
                message: "Pass is not legal while continuation is active",
            };
        }
        return { ok: true };
    }
    const actor = resolveActor(state, action);
    if (!actor) {
        return {
            ok: false,
            code: "INVALID_SHAPE",
            message: "Action must identify an actor by actorId or from",
        };
    }
    if (actor.owner !== state.sideToMove) {
        return {
            ok: false,
            code: "NOT_SIDE_TO_MOVE",
            message: "Actor is not owned by side to move",
        };
    }
    if (action.from && !sameCoordinate(action.from, actor.position)) {
        return {
            ok: false,
            code: "INVALID_SHAPE",
            message: "Action from coordinate does not match actor position",
        };
    }
    if (action.type === "move") {
        if (actor.kind !== "commander") {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Move is legal only for commanders",
            };
        }
        if (!isActivePieceInContext(state, actor)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Inactive commander cannot move",
            };
        }
        if (!action.to || !isOrthogonallyAdjacent(actor.position, action.to)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Move destination must be an orthogonally adjacent square",
            };
        }
        if (hasPieceAt(state, action.to)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Move destination is occupied",
            };
        }
        if (!wouldBeSuppliedAfterRelocation(state, actor.id, actor.owner, action.to)) {
            return {
                ok: false,
                code: "SUPPLY_DESTINATION_UNSUPPLIED",
                message: "Move destination would be unsupplied",
            };
        }
        return { ok: true };
    }
    if (action.type === "project") {
        if (!isActivePieceInContext(state, actor)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Inactive piece cannot project",
            };
        }
        if (!action.to || !isOrthogonalDistance(actor.position, action.to, 2)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Project destination must be exactly 2 orthogonal squares away",
            };
        }
        const midpoint = {
            row: (actor.position.row + action.to.row) / 2,
            col: (actor.position.col + action.to.col) / 2,
        };
        if (hasPieceAt(state, midpoint) || hasPieceAt(state, action.to)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Project path and destination must be empty",
            };
        }
        if (!wouldProjectedPieceBeSupplied(state, actor.owner, action.to)) {
            return {
                ok: false,
                code: "SUPPLY_DESTINATION_UNSUPPLIED",
                message: "Project destination would be unsupplied",
            };
        }
        return { ok: true };
    }
    if (action.type === "rush") {
        if (state.continuation?.type === "rush" && state.continuation.rushedPieceIds?.includes(actor.id)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Piece may only rush once per rush sequence",
            };
        }
        if (!isActivePieceInContext(state, actor)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Inactive piece cannot rush",
            };
        }
        if (!action.to || !isAnyAdjacent(actor.position, action.to)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Rush destination must be one square away",
            };
        }
        if (hasPieceAt(state, action.to)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Rush destination is occupied",
            };
        }
        const rowDelta = action.to.row - actor.position.row;
        const colDelta = action.to.col - actor.position.col;
        const diagonal = Math.abs(rowDelta) === 1 && Math.abs(colDelta) === 1;
        if (diagonal) {
            if (actor.pushed) {
                return {
                    ok: false,
                    code: "RULE_VIOLATION",
                    message: "Pushed piece cannot diagonal-rush",
                };
            }
            const coAdjacentA = { row: actor.position.row + rowDelta, col: actor.position.col };
            const coAdjacentB = { row: actor.position.row, col: actor.position.col + colDelta };
            const enemyA = getPieceAt(state, coAdjacentA);
            const enemyB = getPieceAt(state, coAdjacentB);
            if (!(enemyA && enemyA.owner !== actor.owner) && !(enemyB && enemyB.owner !== actor.owner)) {
                return {
                    ok: false,
                    code: "RULE_VIOLATION",
                    message: "Diagonal rush requires enemy in a co-adjacent square",
                };
            }
        }
        else {
            if (enemyAdjacentCount(state, actor.owner, action.to) === 0) {
                return {
                    ok: false,
                    code: "RULE_VIOLATION",
                    message: "Orthogonal rush destination must be adjacent to at least one enemy",
                };
            }
        }
        if (!wouldBeSuppliedAfterRelocation(state, actor.id, actor.owner, action.to)) {
            return {
                ok: false,
                code: "SUPPLY_DESTINATION_UNSUPPLIED",
                message: "Rush destination would be unsupplied",
            };
        }
        return { ok: true };
    }
    if (action.type === "push") {
        if (!isActivePieceInContext(state, actor) || actor.pushed || actor.shifted) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Actor cannot push in current temporary state",
            };
        }
        if (!action.to) {
            return {
                ok: false,
                code: "INVALID_SHAPE",
                message: "Push requires target coordinate",
            };
        }
        if (!isOrthogonallyAdjacent(actor.position, action.to)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Push target must be an orthogonally adjacent square",
            };
        }
        const defender = getPieceAt(state, action.to);
        if (!defender || defender.owner === actor.owner) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Push target must contain an orthogonally adjacent enemy piece",
            };
        }
        const attackerStrength = localGroupStrength(state, actor.id);
        const defenderStrength = localGroupStrength(state, defender.id);
        if (attackerStrength <= defenderStrength) {
            return {
                ok: false,
                code: "PUSH_STRENGTH_TOO_WEAK",
                message: "Push requires strictly greater attacker group strength",
            };
        }
        if (!wouldBeSuppliedAfterPush(state, actor.id, defender.id, actor.owner, action.to)) {
            return {
                ok: false,
                code: "SUPPLY_DESTINATION_UNSUPPLIED",
                message: "Push destination would be unsupplied",
            };
        }
        return { ok: true };
    }
    if (action.type === "follow") {
        if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "follow") {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Follow is only legal during push follow phase",
            };
        }
        if (actor.shifted) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Follow actor already shifted in this continuation",
            };
        }
        if (!state.continuation.followPoint || !action.to || !sameCoordinate(action.to, state.continuation.followPoint)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Follow destination must be current follow-point",
            };
        }
        if (hasPieceAt(state, state.continuation.followPoint)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Follow-point must be empty",
            };
        }
        if (Array.isArray(state.continuation.followGroupPieceIds) &&
            state.continuation.followGroupPieceIds.length > 0 &&
            !state.continuation.followGroupPieceIds.includes(actor.id)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Follow actor must belong to the pushing group",
            };
        }
        if (!isOrthogonallyAdjacent(actor.position, state.continuation.followPoint)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Follow actor must be orthogonally adjacent to current follow-point",
            };
        }
        if (!wouldBeSuppliedAfterRelocation(state, actor.id, actor.owner, state.continuation.followPoint)) {
            return {
                ok: false,
                code: "SUPPLY_DESTINATION_UNSUPPLIED",
                message: "Follow destination would be unsupplied",
            };
        }
        return { ok: true };
    }
    if (action.type === "retreat") {
        if (!state.continuation || state.continuation.type !== "push" || state.continuation.phase !== "retreat") {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Retreat is only legal during push retreat phase",
            };
        }
        if (!actor.pushed || actor.id !== state.continuation.pushedPieceId) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Only the pushed piece may retreat",
            };
        }
        if (!action.to || !isOrthogonallyAdjacent(actor.position, action.to)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Retreat destination must be orthogonally adjacent",
            };
        }
        if (hasPieceAt(state, action.to)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Retreat destination is occupied",
            };
        }
        if (state.continuation.followPoint && sameCoordinate(action.to, state.continuation.followPoint)) {
            return {
                ok: false,
                code: "RULE_VIOLATION",
                message: "Retreat destination cannot be the reserved follow-point",
            };
        }
        if (!wouldBeSuppliedAfterRelocation(state, actor.id, actor.owner, action.to)) {
            return {
                ok: false,
                code: "SUPPLY_DESTINATION_UNSUPPLIED",
                message: "Retreat destination would be unsupplied",
            };
        }
        return { ok: true };
    }
    return {
        ok: false,
        code: "RULE_VIOLATION",
        message: "Unsupported action type",
    };
}
