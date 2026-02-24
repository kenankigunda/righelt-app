import type { ArtifactContractV1, ArtifactMode, GameState, ResolveArtifacts } from "./types";

const MAX_RESOLVE_PASSES = 64;

function sortIds(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b));
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
  if (JSON.stringify(state.artifacts) !== JSON.stringify(nextArtifacts)) {
    state.artifacts = nextArtifacts;
    changed = true;
  }

  // Phase 2: supply.
  // Full supply traversal and shortest-path artifacts land in Step 3.
  // Phase 3: command.
  // Full command propagation and cut-edge logic land in Step 4.
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
