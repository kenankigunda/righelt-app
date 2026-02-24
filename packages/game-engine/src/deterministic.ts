import type {
  CommandArtifact,
  ContinuationContext,
  Coordinate,
  GameState,
  GroupArtifact,
  Piece,
  SupplyArtifact,
} from "./types";

export const BOARD_SIZE = 10 as const;

export const SUPPLY_POINTS = {
  P1: { row: 0, col: 9 },
  P2: { row: 9, col: 0 },
} as const;

const OWNER_ORDER: Record<Piece["owner"], number> = {
  P1: 0,
  P2: 1,
};

const KIND_ORDER: Record<Piece["kind"], number> = {
  commander: 0,
  unit: 1,
};

export function compareCoordinates(a: Coordinate, b: Coordinate): number {
  if (a.row !== b.row) {
    return a.row - b.row;
  }
  return a.col - b.col;
}

function cloneCoordinate(value: Coordinate): Coordinate {
  return { row: value.row, col: value.col };
}

function normalizePiece(piece: Piece): Piece {
  return {
    ...piece,
    position: cloneCoordinate(piece.position),
  };
}

export function normalizePieces(pieces: Piece[]): Piece[] {
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

function normalizeContinuation(value: ContinuationContext | null): ContinuationContext | null {
  if (!value) {
    return null;
  }

  return {
    ...value,
    followPoint: value.followPoint ? cloneCoordinate(value.followPoint) : undefined,
    rushedPieceIds: value.rushedPieceIds ? [...value.rushedPieceIds].sort((a, b) => a.localeCompare(b)) : undefined,
  };
}

function normalizeSupplyArtifacts(artifacts: SupplyArtifact[]): SupplyArtifact[] {
  return [...artifacts]
    .map((artifact) => ({
      ...artifact,
      reachability: [...artifact.reachability].sort((a, b) => a.localeCompare(b)),
      shortestPathByPieceId: Object.fromEntries(
        Object.entries(artifact.shortestPathByPieceId)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([pieceId, path]) => [pieceId, [...path].sort(compareCoordinates)]),
      ),
      distanceByPieceId: Object.fromEntries(
        Object.entries(artifact.distanceByPieceId).sort(([a], [b]) => a.localeCompare(b)),
      ),
    }))
    .sort((a, b) => a.player.localeCompare(b.player));
}

function normalizeCommandArtifact(command: CommandArtifact): CommandArtifact {
  return {
    candidateEdges: [...command.candidateEdges].sort((a, b) => a.localeCompare(b)),
    cutEdges: [...command.cutEdges].sort((a, b) => a.localeCompare(b)),
    activeEdges: [...command.activeEdges].sort((a, b) => a.localeCompare(b)),
    shortestPathToCommanderByPieceId: Object.fromEntries(
      Object.entries(command.shortestPathToCommanderByPieceId)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pieceId, path]) => [pieceId, [...path].sort(compareCoordinates)]),
    ),
  };
}

function normalizeGroupArtifact(groups: GroupArtifact): GroupArtifact {
  return {
    componentByPieceId: Object.fromEntries(
      Object.entries(groups.componentByPieceId).sort(([a], [b]) => a.localeCompare(b)),
    ),
    membersByComponentId: Object.fromEntries(
      Object.entries(groups.membersByComponentId)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([componentId, members]) => [componentId, [...members].sort((a, b) => a.localeCompare(b))]),
    ),
    strengthByComponentId: Object.fromEntries(
      Object.entries(groups.strengthByComponentId).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

export function createMinimalArtifacts() {
  return {
    mode: "minimal" as const,
    supply: [
      {
        player: "P1" as const,
        reachability: [],
        shortestPathByPieceId: {},
        distanceByPieceId: {},
      },
      {
        player: "P2" as const,
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

export function normalizeState(state: GameState): GameState {
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
