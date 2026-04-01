import { BOARD_SIZE, normalizeState } from "./deterministic.js";
import { localGroupMembers, validateAction } from "./legal.js";
function isEmptySquare(state, row, col) {
    return !state.pieces.some((piece) => piece.position.row === row && piece.position.col === col);
}
function orthogonallyAdjacentEmptySquares(state, row, col) {
    return [
        { row: row - 1, col },
        { row: row + 1, col },
        { row, col: col - 1 },
        { row, col: col + 1 },
    ].filter((coord) => coord.row >= 0 &&
        coord.row < BOARD_SIZE &&
        coord.col >= 0 &&
        coord.col < BOARD_SIZE &&
        isEmptySquare(state, coord.row, coord.col));
}
function clearShiftedFlags(state) {
    for (const piece of state.pieces) {
        if (piece.shifted) {
            piece.shifted = false;
        }
    }
}
function opponentOf(owner) {
    return owner === "P1" ? "P2" : "P1";
}
function nextUnitId(state, owner) {
    const prefix = owner === "P1" ? "U1-" : "U2-";
    let next = 1;
    for (const piece of state.pieces) {
        if (!piece.id.startsWith(prefix)) {
            continue;
        }
        const numeric = Number.parseInt(piece.id.slice(prefix.length), 10);
        if (Number.isFinite(numeric)) {
            next = Math.max(next, numeric + 1);
        }
    }
    return `${prefix}${next}`;
}
function captureFrozenPieceStates(state, owner) {
    return Object.fromEntries(state.pieces
        .filter((piece) => piece.owner === owner)
        .map((piece) => [
        piece.id,
        {
            supplied: piece.supplied,
            commanded: piece.commanded,
        },
    ]));
}
export function applyAction(state, action) {
    const validation = validateAction(state, action);
    if (!validation.ok) {
        throw new Error(`Cannot apply invalid action: ${validation.code}`);
    }
    return applyValidatedAction(state, action);
}
export function applyValidatedAction(state, action) {
    const next = normalizeState(state);
    const actor = (action.actorId && next.pieces.find((piece) => piece.id === action.actorId)) ||
        (action.from &&
            next.pieces.find((piece) => piece.position.row === action.from?.row && piece.position.col === action.from?.col)) ||
        undefined;
    const endTurn = (nextSideToMove = opponentOf(next.sideToMove)) => {
        next.sideToMove = nextSideToMove;
        next.turnIndex += 1;
        next.continuation = null;
        clearShiftedFlags(next);
    };
    if (action.type === "pass") {
        endTurn();
    }
    else if (action.type === "move" && actor && action.to) {
        actor.position = { ...action.to };
        endTurn();
    }
    else if (action.type === "project" && actor && action.to) {
        next.pieces.push({
            id: nextUnitId(next, actor.owner),
            owner: actor.owner,
            kind: "unit",
            position: { ...action.to },
            supplied: true,
            commanded: true,
            displaySupplied: true,
            displayCommanded: true,
        });
        endTurn();
    }
    else if (action.type === "rush" && actor && action.to) {
        actor.position = { ...action.to };
        if (!next.continuation || next.continuation.type !== "rush") {
            next.continuation = {
                type: "rush",
                owner: actor.owner,
                forcedResupplyPieceIds: [],
                frozenOwner: actor.owner,
                frozenPieceStatesById: captureFrozenPieceStates(state, actor.owner),
                rushedPieceIds: [actor.id],
                chainLength: 1,
            };
        }
        else {
            const rushedPieceIds = new Set(next.continuation.rushedPieceIds ?? []);
            rushedPieceIds.add(actor.id);
            next.continuation.rushedPieceIds = [...rushedPieceIds];
            next.continuation.chainLength += 1;
        }
    }
    else if (action.type === "push" && actor && action.to) {
        const origin = { ...actor.position };
        const pushingGroupPieceIds = localGroupMembers(next, actor.id);
        const defender = next.pieces.find((candidate) => candidate.position.row === action.to?.row && candidate.position.col === action.to?.col);
        if (!defender) {
            throw new Error("Push defender not found");
        }
        actor.position = { ...action.to };
        actor.shifted = true;
        defender.position = { ...action.to };
        defender.pushed = true;
        defender.shifted = false;
        next.continuation = {
            type: "push",
            owner: defender.owner,
            attackerOwner: actor.owner,
            phase: "retreat",
            followPoint: origin,
            pushedPieceId: defender.id,
            followGroupPieceIds: pushingGroupPieceIds,
            forcedResupplyPieceIds: [],
            frozenOwner: actor.owner,
            frozenPieceStatesById: captureFrozenPieceStates(state, actor.owner),
            chainLength: 1,
        };
        next.sideToMove = defender.owner;
        const retreatSquares = [
            { row: defender.position.row - 1, col: defender.position.col },
            { row: defender.position.row + 1, col: defender.position.col },
            { row: defender.position.row, col: defender.position.col - 1 },
            { row: defender.position.row, col: defender.position.col + 1 },
        ].filter((to) => validateAction(next, {
            type: "retreat",
            actorId: defender.id,
            from: defender.position,
            to,
        }).ok);
        if (retreatSquares.length === 0) {
            next.pieces = next.pieces.filter((piece) => piece.id !== defender.id);
            next.continuation = {
                ...next.continuation,
                owner: actor.owner,
                phase: "follow",
                pushedPieceId: undefined,
            };
            next.sideToMove = actor.owner;
        }
    }
    else if (action.type === "follow" && actor && action.to) {
        const origin = { ...actor.position };
        actor.position = { ...action.to };
        actor.shifted = true;
        if (next.continuation?.type === "push") {
            next.sideToMove = next.continuation.attackerOwner ?? actor.owner;
            next.continuation.phase = "follow";
            next.continuation.followPoint = origin;
            next.continuation.chainLength += 1;
        }
    }
    else if (action.type === "retreat" && actor && action.to) {
        actor.position = { ...action.to };
        actor.pushed = false;
        if (next.continuation?.type === "push") {
            next.sideToMove = next.continuation.attackerOwner ?? opponentOf(actor.owner);
            next.continuation.owner = next.sideToMove;
            next.continuation.phase = "follow";
            next.continuation.pushedPieceId = undefined;
        }
    }
    else {
        throw new Error(`Action type ${action.type} is not implemented yet`);
    }
    const nextState = normalizeState(next);
    return {
        state: nextState,
        outcome: nextState.outcome,
    };
}
