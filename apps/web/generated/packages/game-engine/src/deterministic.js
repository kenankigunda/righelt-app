export const BOARD_SIZE = 10;
export const SUPPLY_POINTS = {
    P1: { row: 0, col: 9 },
    P2: { row: 9, col: 0 },
};
const OWNER_ORDER = {
    P1: 0,
    P2: 1,
};
const KIND_ORDER = {
    commander: 0,
    unit: 1,
};
export function compareCoordinates(a, b) {
    if (a.row !== b.row) {
        return a.row - b.row;
    }
    return a.col - b.col;
}
function cloneCoordinate(value) {
    return { row: value.row, col: value.col };
}
function normalizePiece(piece) {
    return {
        ...piece,
        position: cloneCoordinate(piece.position),
        displaySupplied: piece.displaySupplied ?? piece.supplied,
        displayCommanded: piece.displayCommanded ?? piece.commanded,
    };
}
export function normalizePieces(pieces) {
    return pieces
        .map(normalizePiece)
        .sort((a, b) => {
        const ownerDelta = OWNER_ORDER[a.owner] - OWNER_ORDER[b.owner];
        if (ownerDelta !== 0) {
            return ownerDelta;
        }
        const kindDelta = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
        if (kindDelta !== 0) {
            return kindDelta;
        }
        return a.id.localeCompare(b.id);
    });
}
function normalizeContinuation(value) {
    if (!value) {
        return null;
    }
    const frozenPieceStatesById = value.frozenPieceStatesById
        ? Object.fromEntries(Object.entries(value.frozenPieceStatesById)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([pieceId, frozenState]) => [pieceId, { ...frozenState }]))
        : undefined;
    return {
        ...value,
        followPoint: value.followPoint ? cloneCoordinate(value.followPoint) : undefined,
        followGroupPieceIds: value.followGroupPieceIds
            ? [...value.followGroupPieceIds].sort((a, b) => a.localeCompare(b))
            : undefined,
        forcedResupplyPieceIds: value.forcedResupplyPieceIds
            ? [...value.forcedResupplyPieceIds].sort((a, b) => a.localeCompare(b))
            : undefined,
        rushedPieceIds: value.rushedPieceIds ? [...value.rushedPieceIds].sort((a, b) => a.localeCompare(b)) : undefined,
        frozenPieceStatesById,
    };
}
function normalizeSupplyArtifacts(artifacts) {
    return [...artifacts]
        .map((artifact) => ({
        ...artifact,
        reachability: [...artifact.reachability].sort((a, b) => a.localeCompare(b)),
        shortestPathByPieceId: Object.fromEntries(Object.entries(artifact.shortestPathByPieceId)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([pieceId, path]) => [pieceId, [...path].sort(compareCoordinates)])),
        distanceByPieceId: Object.fromEntries(Object.entries(artifact.distanceByPieceId).sort(([a], [b]) => a.localeCompare(b))),
    }))
        .sort((a, b) => a.player.localeCompare(b.player));
}
function normalizeCommandArtifact(command) {
    return {
        candidateEdges: [...command.candidateEdges].sort((a, b) => a.localeCompare(b)),
        cutEdges: [...command.cutEdges].sort((a, b) => a.localeCompare(b)),
        activeEdges: [...command.activeEdges].sort((a, b) => a.localeCompare(b)),
        shortestPathToCommanderByPieceId: Object.fromEntries(Object.entries(command.shortestPathToCommanderByPieceId)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([pieceId, path]) => [pieceId, [...path].sort(compareCoordinates)])),
    };
}
function normalizeGroupArtifact(groups) {
    return {
        componentByPieceId: Object.fromEntries(Object.entries(groups.componentByPieceId).sort(([a], [b]) => a.localeCompare(b))),
        membersByComponentId: Object.fromEntries(Object.entries(groups.membersByComponentId)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([componentId, members]) => [componentId, [...members].sort((a, b) => a.localeCompare(b))])),
        strengthByComponentId: Object.fromEntries(Object.entries(groups.strengthByComponentId).sort(([a], [b]) => a.localeCompare(b))),
    };
}
export function createMinimalArtifacts() {
    return {
        mode: "minimal",
        supply: [
            {
                player: "P1",
                reachability: [],
                shortestPathByPieceId: {},
                distanceByPieceId: {},
            },
            {
                player: "P2",
                reachability: [],
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
            componentByPieceId: {},
            membersByComponentId: {},
            strengthByComponentId: {},
        },
    };
}
export function normalizeState(state) {
    return {
        boardSize: BOARD_SIZE,
        sideToMove: state.sideToMove,
        turnIndex: state.turnIndex,
        pieces: normalizePieces(state.pieces),
        continuation: normalizeContinuation(state.continuation),
        outcome: { ...state.outcome },
        artifacts: state.artifacts
            ? {
                mode: state.artifacts.mode,
                supply: normalizeSupplyArtifacts(state.artifacts.supply),
                command: normalizeCommandArtifact(state.artifacts.command),
                groups: normalizeGroupArtifact(state.artifacts.groups),
            }
            : undefined,
    };
}
