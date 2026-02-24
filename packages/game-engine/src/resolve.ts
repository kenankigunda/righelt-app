import type { ArtifactContractV1, ArtifactMode, GameState, ResolveArtifacts } from "./types";

const MAX_RESOLVE_PASSES = 64;
const SUPPLY_POINTS = {
  P1: { row: 0, col: 9 },
  P2: { row: 9, col: 0 },
} as const;

function sortIds(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function coordinateKey(row: number, col: number): string {
  return `${row},${col}`;
}

function parseCoordinateKey(key: string): { row: number; col: number } {
  const [row, col] = key.split(",").map((value) => Number(value));
  return { row, col };
}

function isInBounds(boardSize: number, row: number, col: number): boolean {
  return row >= 0 && row < boardSize && col >= 0 && col < boardSize;
}

function sortedOrthogonalNeighbors(boardSize: number, row: number, col: number): { row: number; col: number }[] {
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

function cloneState(state: GameState): GameState {
  return {
    ...state,
    pieces: state.pieces.map((piece) => ({
      ...piece,
      position: { ...piece.position },
    })),
    continuation: state.continuation
      ? {
          ...state.continuation,
          followPoint: state.continuation.followPoint ? { ...state.continuation.followPoint } : undefined,
        }
      : null,
    outcome: { ...state.outcome },
    artifacts: state.artifacts ? JSON.parse(JSON.stringify(state.artifacts)) : undefined,
  };
}

function computeSupplyForOwner(
  state: GameState,
  owner: "P1" | "P2",
): {
  suppliedByPieceId: Record<string, boolean>;
  shortestPathByPieceId: Record<string, { row: number; col: number }[]>;
  distanceByPieceId: Record<string, number>;
  reachability: string[];
} {
  const supplyPoint = SUPPLY_POINTS[owner];
  const occupiedByCoordinate = new Map(
    state.pieces.map((piece) => [coordinateKey(piece.position.row, piece.position.col), piece]),
  );

  const isTraversable = (row: number, col: number): boolean => {
    const occupant = occupiedByCoordinate.get(coordinateKey(row, col));
    if (!occupant) {
      return true;
    }
    return occupant.owner === owner;
  };

  const supplyKey = coordinateKey(supplyPoint.row, supplyPoint.col);
  const visited = new Set<string>();
  const parentByKey = new Map<string, string | null>();

  if (isTraversable(supplyPoint.row, supplyPoint.col)) {
    visited.add(supplyKey);
    parentByKey.set(supplyKey, null);
    const queue: { row: number; col: number }[] = [{ row: supplyPoint.row, col: supplyPoint.col }];

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

  const suppliedByPieceId: Record<string, boolean> = {};
  const shortestPathByPieceId: Record<string, { row: number; col: number }[]> = {};
  const distanceByPieceId: Record<string, number> = {};

  for (const piece of state.pieces.filter((candidate) => candidate.owner === owner)) {
    const pieceKey = coordinateKey(piece.position.row, piece.position.col);
    const supplied = visited.has(pieceKey);
    suppliedByPieceId[piece.id] = supplied;
    if (!supplied) {
      continue;
    }

    const path: { row: number; col: number }[] = [];
    let cursor: string | null | undefined = pieceKey;
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
    reachability: sortIds(
      Object.entries(suppliedByPieceId)
        .filter(([, supplied]) => supplied)
        .map(([pieceId]) => pieceId),
    ),
  };
}

function computeBaselineArtifacts(state: GameState, mode: ArtifactMode): ResolveArtifacts {
  const p1Pieces = state.pieces.filter((piece) => piece.owner === "P1");
  const p2Pieces = state.pieces.filter((piece) => piece.owner === "P2");

  const p1Components = Object.fromEntries(
    sortIds(p1Pieces.map((piece) => piece.id)).map((pieceId) => [pieceId, `P1:${pieceId}`]),
  );
  const p2Components = Object.fromEntries(
    sortIds(p2Pieces.map((piece) => piece.id)).map((pieceId) => [pieceId, `P2:${pieceId}`]),
  );

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

type CommandEdge = {
  owner: "P1" | "P2";
  fromId: string;
  toId: string;
  from: { row: number; col: number };
  to: { row: number; col: number };
  id: string;
};

function makeEdgeId(aId: string, bId: string): string {
  return aId.localeCompare(bId) <= 0 ? `${aId}|${bId}` : `${bId}|${aId}`;
}

function isClearOrthogonalLine(
  state: GameState,
  a: { row: number; col: number },
  b: { row: number; col: number },
  occupied: Map<string, string>,
): boolean {
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

function segmentIntersectionPoint(
  edgeA: CommandEdge,
  edgeB: CommandEdge,
): { row: number; col: number } | null {
  const horizontalA = edgeA.from.row === edgeA.to.row;
  const horizontalB = edgeB.from.row === edgeB.to.row;

  if (horizontalA === horizontalB) {
    return null;
  }

  const horizontal = horizontalA ? edgeA : edgeB;
  const vertical = horizontalA ? edgeB : edgeA;

  const row = horizontal.from.row;
  const col = vertical.from.col;

  const minCol = Math.min(horizontal.from.col, horizontal.to.col);
  const maxCol = Math.max(horizontal.from.col, horizontal.to.col);
  const minRow = Math.min(vertical.from.row, vertical.to.row);
  const maxRow = Math.max(vertical.from.row, vertical.to.row);

  if (col <= minCol || col >= maxCol || row <= minRow || row >= maxRow) {
    return null;
  }

  return { row, col };
}

function buildCommandEdges(state: GameState): CommandEdge[] {
  const occupied = new Map(state.pieces.map((piece) => [coordinateKey(piece.position.row, piece.position.col), piece.id]));
  const edges = new Map<string, CommandEdge>();

  for (const owner of ["P1", "P2"] as const) {
    const ownPieces = state.pieces
      .filter((piece) => piece.owner === owner)
      .sort((a, b) => a.id.localeCompare(b.id));

    for (let i = 0; i < ownPieces.length; i += 1) {
      for (let j = i + 1; j < ownPieces.length; j += 1) {
        const a = ownPieces[i];
        const b = ownPieces[j];
        const rowDelta = Math.abs(a.position.row - b.position.row);
        const colDelta = Math.abs(a.position.col - b.position.col);

        const diagonalAllowed = rowDelta === 1 && colDelta === 1;
        const orthogonalVisible =
          (a.position.row === b.position.row || a.position.col === b.position.col) &&
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

function applyCommandPhase(state: GameState, mode: ArtifactMode): boolean {
  const edges = buildCommandEdges(state);
  const edgesByOwner = {
    P1: edges.filter((edge) => edge.owner === "P1"),
    P2: edges.filter((edge) => edge.owner === "P2"),
  } as const;

  const cutEdges = new Set<string>();
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
  const shortestPathToCommanderByPieceId: Record<string, { row: number; col: number }[]> = {};

  for (const owner of ["P1", "P2"] as const) {
    const commanderId = owner === "P1" ? "C1" : "C2";
    const ownPieceIds = sortIds(state.pieces.filter((piece) => piece.owner === owner).map((piece) => piece.id));

    const adjacency = new Map<string, string[]>();
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

    const visited = new Set<string>();
    const parent = new Map<string, string | null>();
    const queue: string[] = [];
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
      const nextCommanded = visited.has(piece.id);
      if (piece.commanded !== nextCommanded) {
        piece.commanded = nextCommanded;
        changed = true;
      }

      if (mode === "full" && nextCommanded) {
        const pathNodes: string[] = [];
        let cursor: string | null | undefined = piece.id;
        while (cursor) {
          pathNodes.push(cursor);
          cursor = parent.get(cursor);
        }
        const pathCoordinates: { row: number; col: number }[] = [];
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

function applySupplyPhase(state: GameState, mode: ArtifactMode): boolean {
  const p1Supply = computeSupplyForOwner(state, "P1");
  const p2Supply = computeSupplyForOwner(state, "P2");
  let changed = false;

  for (const piece of state.pieces) {
    const ownerSupply = piece.owner === "P1" ? p1Supply : p2Supply;
    const nextSupplied = Boolean(ownerSupply.suppliedByPieceId[piece.id]);
    if (piece.supplied !== nextSupplied) {
      piece.supplied = nextSupplied;
      changed = true;
    }
  }

  const nextSupplyArtifacts = [
    {
      player: "P1" as const,
      reachability: p1Supply.reachability,
      shortestPathByPieceId: mode === "full" ? p1Supply.shortestPathByPieceId : {},
      distanceByPieceId: mode === "full" ? p1Supply.distanceByPieceId : {},
    },
    {
      player: "P2" as const,
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

function applyForcedEffectsPhase(state: GameState): boolean {
  const beforeCount = state.pieces.length;
  state.pieces = state.pieces.filter((piece) => piece.kind === "commander" || piece.supplied);
  return state.pieces.length !== beforeCount;
}

function evaluateTerminalPhase(state: GameState): boolean {
  if (state.outcome.status !== "ongoing") {
    return false;
  }

  const commanderByOwner = {
    P1: state.pieces.find((piece) => piece.id === "C1"),
    P2: state.pieces.find((piece) => piece.id === "C2"),
  } as const;

  const p1Supplied = Boolean(commanderByOwner.P1?.supplied);
  const p2Supplied = Boolean(commanderByOwner.P2?.supplied);

  if (p1Supplied && p2Supplied) {
    return false;
  }

  if (!p1Supplied && !p2Supplied) {
    state.outcome = { status: "draw", reason: "both_commanders_unsupplied" };
  } else if (!p1Supplied) {
    state.outcome = { status: "p2_win", reason: "p1_commander_unsupplied" };
  } else {
    state.outcome = { status: "p1_win", reason: "p2_commander_unsupplied" };
  }

  return true;
}

function runResolvePass(state: GameState, mode: ArtifactMode): boolean {
  let changed = false;

  // Phase 1: connectivity + artifact baseline.
  const nextArtifacts = computeBaselineArtifacts(state, mode);
  if (state.artifacts?.supply) {
    nextArtifacts.supply = state.artifacts.supply;
  }
  if (state.artifacts?.command) {
    nextArtifacts.command = state.artifacts.command;
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
  // Phase 4: legal-set derivation.
  // Action-family legality integration lands after Track A merge sync.

  // Phase 5: forced effects.
  if (applyForcedEffectsPhase(state)) {
    changed = true;
  }

  // Phase 6: terminal evaluation.
  if (evaluateTerminalPhase(state)) {
    changed = true;
  }

  return changed;
}

export function resolveToStability(
  state: GameState,
  options?: {
    artifactMode?: ArtifactMode;
    maxPasses?: number;
  },
): GameState {
  const mode = options?.artifactMode ?? "minimal";
  const maxPasses = options?.maxPasses ?? MAX_RESOLVE_PASSES;

  let pass = 0;
  while (pass < maxPasses) {
    const changed = runResolvePass(state, mode);
    if (!changed) {
      return state;
    }
    pass += 1;
  }

  throw new Error(`resolveToStability exceeded max passes (${maxPasses})`);
}

export function buildArtifacts(state: GameState): ArtifactContractV1 {
  const resolved = resolveToStability(cloneState(state), {
    artifactMode: "full",
  });

  return {
    supply: resolved.artifacts?.supply ?? [],
    command:
      resolved.artifacts?.command ?? {
        candidateEdges: [],
        cutEdges: [],
        activeEdges: [],
        shortestPathToCommanderByPieceId: {},
      },
    groups:
      resolved.artifacts?.groups ?? {
        componentByPieceId: {},
        membersByComponentId: {},
        strengthByComponentId: {},
      },
    status: resolved.outcome.status,
  };
}
