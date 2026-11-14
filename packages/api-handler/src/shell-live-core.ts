import { LIVE_HISTORY } from "../../shared-types/src/sync-protocol";
import { boundedEngineOperation } from "../../game-engine/src/computation-guard";
import {isTerminalOutcome, type OutcomeStatus} from '../../shared-types/src/engine';
import {CURRENT_RETREAT_SEMANTICS,archivedRetreatSemantics,type RetreatSemantics} from '../../shared-types/src/retreat-rules';
import { computerProfileFor, type ComputerControl, type ComputerProfile, type ComputerProof } from '../../shared-types/src/computer-play';
import { destructionRecords, removalNotices, type RemovalEvent } from "../../game-engine/src/removals";
export { collectDestroyedPieceRecords } from "../../game-engine/src/removals";
import { applyAction } from "../../game-engine/src/apply";
import { proveRelevantContinuation } from "../../game-engine/src/early-ending-proof";
import { probeIncomingTurnImmobility } from "../../game-engine/src/incoming-turn-immobility";
import { probeTerminalSettlement } from "../../game-engine/src/terminal-settlement";
import { BOARD_SIZE } from "../../game-engine/src/deterministic";
import { deterministicStateHash } from "../../game-engine/src/hash";
import { listLegalActions as enumerateLegalActions, validateAction as validateEngineAction } from "../../game-engine/src/legal";
import { resolveToStability } from "../../game-engine/src/resolve";
import { createInitialState } from "../../game-engine/src/state";
import { MAX_HISTORY } from "../../shared-types/src/history";
import { finalizeResolvedTurn, getTurnOwnerSideForState } from "../../shared-types/src/shell-live-turn.js";
import { isUuidV4 } from "../../shared-types/src/validation";
import type { Action, GameState } from "../../game-engine/src/types";

// Bound synchronous rules only, never a scope spanning database awaits.
const listLegalActions: typeof enumerateLegalActions = (...args) => boundedEngineOperation(() => enumerateLegalActions(...args));
const validateAction: typeof validateEngineAction = (...args) => boundedEngineOperation(() => validateEngineAction(...args));

export type Participant = {
  computerProfile?: ComputerProfile | null;
  identityId: string;
  connected: boolean;
  joinedAt: string;
  lastHeartbeatAt: string;
  sessionCount: number;
};

export type Viewer = Participant;
export type IdentityRole = "Player 1" | "Player 2" | "Viewer";
export type LaunchParticipantCopyMode = "copy_source_participants" | "viewer_as_side_to_move";

export type JoinRequest = {
  identityId: string;
  requestedSeat: "Player 1" | "Player 2";
  requestedAt: string;
  source: "viewer_invite" | "home_list";
  status?: "pending" | "accepted" | "rejected";
  resolvedAt?: string | null;
  resolvedBy?: string | null;
};

export type MoveEntry = {
  moveId: string;
  index: number;
  turnIndex: number;
  turnMoveIndex: number;
  displayMoveNumber: number;
  actorSide: "P1" | "P2";
  at: string;
  notation: string;
  action: Action;
  /** Exact mask/action semantics for retained replay; missing historical values are geometric-v1. */
  retreatSemantics?: RetreatSemantics;
  clientCommandId?: string | null;
  computerProof?: ComputerProof;
  undone?: boolean;
  undoneAt?: string | null;
  undoneByIdentityId?: string | null;
  /** Actual accepted restoration commit, scoped to this game. Never a timestamp. */
  undoEventSeq?: number;
  selectionSnapshot: GameState;
  snapshot: GameState;
  /** Persistent record of pieces destroyed during resolution of this move. */
  destroyedPieces?: DestroyedPieceRecord[];
  /** Immutable source identity for history copied into a branched game. */
  importedFrom?: {
    gameId: string;
    decisionId: string;
    gameplayRevision: number;
  };
};

export type ImportedHistorySource = {
  gameId: string;
  gameplayRevision: number;
  moveCount: number;
};

export type ImportedHistory = {
  version: 1;
  complete: boolean;
  moveCount: number;
  sources: ImportedHistorySource[];
};

export type TerminalOutcomeRecord = {
  version: 1;
  decisive: {
    action: Action;
    actorSide: "P1" | "P2";
    decisionId: string | null;
    clientCommandId: string;
    turnIndex: number;
  };
  board: GameState;
  removals: DestroyedPieceRecord[];
  result: { status: "p1_win" | "p2_win" | "draw"; reason?: string };
  effect?: {
    version: 1;
    kind: "end-turn" | "pending-pass" | "restoration";
    before: GameState;
  };
  cause:
    | { kind: "commander-settlement"; reason: string }
    | { kind: "relevant-continuation-finality"; endpointCount: number; optionalEndpointCount: number }
    | { kind: "incoming-turn-immobility"; incomingSide: "P1" | "P2" };
  commit: { eventSeq: number; gameplayRevision: number; clientCommandId: string };
  lineage: {
    version: 1 | null;
    complete: boolean;
    importedMoveCount: number;
    sources: ImportedHistorySource[];
  };
  activeActionCount: number;
  activeActionCountComplete: boolean;
};

export type PreparedImportedHistory = ImportedHistory & {
  moves: MoveEntry[];
};

export type RevertRequest = {
  requestId: string;
  requesterIdentityId: string;
  targetMoveId: string;
  targetMoveIndex: number;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  resolvedAt?: string | null;
  resolvedBy?: string | null;
};

export type ScenarioMoveEntry = {
  retreatSemantics?: RetreatSemantics;
  turnIndex: number;
  turnMoveIndex: number;
  actorSide: "P1" | "P2";
  notation: string;
  action: Action;
};

export type ScenarioSavedSelection = {
  source: { row: number; col: number };
  target: { row: number; col: number } | null;
  actorSide: "P1" | "P2";
  turnIndex: number;
};

export type ScenarioRecord = {
  formatVersion: 2;
  id: string;
  title: string;
  description: string;
  incorrect: boolean;
  initialState: GameState;
  moves: ScenarioMoveEntry[];
  resultingState: GameState;
  expectedFinalStateHash: string;
  expectedOutcome: "ongoing" | "p1_win" | "p2_win" | "draw";
  savedSelection: ScenarioSavedSelection | null;
};

export type TurnEntry = {
  index: number;
  startedAt: string;
  endedAt: string | null;
  playerSeat: "Player 1" | "Player 2";
  status: "active" | "complete";
  moveIndexes: number[];
  lastMoveAt: string | null;
};

export type LiveGame = {
  ownershipMode?: "legacy_guest" | "account_v1";
  computer?: ComputerControl;
  archiveStartRevision?: number;
  lastRestoration?: { decisionId: string; at: string; undoEventSeq?: number };
  id: string;
  gameplayRevision: number;
  createdAt: string;
  lastMoveAt: string | null;
  updatedAt: string;
  selfPlayMode: boolean;
  selfPlayStartSide?: "p1" | "p2";
  board: {
    state: GameState;
  };
  player1: Participant | null;
  player2: Participant | null;
  viewers: Viewer[];
  pendingJoinRequests: JoinRequest[];
  pendingRevertRequest: RevertRequest | null;
  turns: TurnEntry[];
  moves: MoveEntry[];
  historyIndexByIdentity: Record<string, number>;
  pendingScenarioSelection: ScenarioSavedSelection | null;
  notifications: string[];
  initialSelectionAction?: Action | null;
  importedHistory?: ImportedHistory;
  terminalOutcome?: TerminalOutcomeRecord;
  historyBranchCreationKey?: string;
  inviteTokens: {
    viewer: string;
    player1: string;
    player2: string;
  };
};

export type StaticGameCard = {
  id: string;
  eventSeq: number | null;
  gameplayRevision: number | null;
  confirmedOutcomeStatus: OutcomeStatus | null;
  selfPlayMode: boolean;
  myRoles: IdentityRole[];
  createdAt: string;
  lastMoveAt: string | null;
  updatedAt: string;
  moveCount: number;
  previewSnapshot: GameState | null;
  previewSelection: ScenarioSavedSelection | null;
  myRole: "Player 1" | "Player 2" | "Viewer" | "Guest";
  canJoinAsPlayer: boolean;
  player1: Participant | null;
  player2: Participant | null;
};

export type RemovedPieceNotice = {
  eventId?: string;
  piece?: GameState["pieces"][number];
  pieceId: string;
  position: { row: number; col: number };
  reason: "loss_of_supply" | "no_retreat";
  message: string;
};

/**
 * A persistent record of a piece that was removed during resolution of a move.
 * Stored on `MoveEntry.destroyedPieces` for use in history rendering.
 *
 * Invariant: A Commander removal always produces a terminal outcome (`p1_win`,
 * `p2_win`, or `draw`). A move where `outcome.status === "ongoing"` cannot
 * contain a Commander removal. Therefore, `reason: "commander_unsupplied"` is
 * safely inferred whenever `piece.kind === "commander"` at removal time.
 */
export type DestroyedPieceRecord = {
  eventId?: string;
  pieceId?: string;
  kind?: GameState["pieces"][number]["kind"];
  piece?: GameState["pieces"][number];
  position: { row: number; col: number };
  ownerSeat: "p1" | "p2";
  supplied: boolean;
  commanded: boolean;
  reason: "no_retreat" | "loss_of_supply" | "commander_unsupplied";
};

export type PieceMovePreview = Action & {
  legal: boolean;
  blockedReason?: "SUPPLY_DESTINATION_UNSUPPLIED" | "PUSH_STRENGTH_TOO_WEAK";
};

export const clone = <T>(value: T): T => structuredClone(value);
export const now = () => new Date(Date.now()).toISOString();

export const createInviteToken = () => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
};

export const nextGameId = () => `game-${createInviteToken()}`;
export const nextMoveId = () => `move-${createInviteToken()}`;

export const getSeatForSide = (side: GameState["sideToMove"]): "Player 1" | "Player 2" => (side === "P1" ? "Player 1" : "Player 2");
export const getNextSeat = (seat: "Player 1" | "Player 2"): "Player 1" | "Player 2" => (seat === "Player 1" ? "Player 2" : "Player 1");
export const getSideForSeat = (seat: "Player 1" | "Player 2"): GameState["sideToMove"] => (seat === "Player 1" ? "P1" : "P2");
export const getSideToMoveSeat = (game: LiveGame): "Player 1" | "Player 2" =>
  game.board.state.sideToMove === "P1" ? "Player 1" : "Player 2";
export const getActiveTurn = (game: LiveGame): TurnEntry | null => game.turns[game.turns.length - 1] ?? null;
const isMoveUndone = (move: MoveEntry | null | undefined) => move?.undone === true;
const getActiveMoves = (game: LiveGame) => game.moves.filter((move) => !isMoveUndone(move));
const getNextDisplayMoveNumber = (game: LiveGame) => {
  const latestActiveMove = [...game.moves].reverse().find((move) => !isMoveUndone(move));
  return typeof latestActiveMove?.displayMoveNumber === "number" && Number.isFinite(latestActiveMove.displayMoveNumber)
    ? latestActiveMove.displayMoveNumber + 1
    : getActiveMoves(game).length + 1;
};

export const asIdentity = (value: unknown) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
export const asGameState = (value: unknown): GameState | null =>
  value && typeof value === "object" ? (value as GameState) : null;
export const asAction = (value: unknown): Action | null =>
  value && typeof value === "object" && typeof (value as Action).type === "string" ? (value as Action) : null;
const hasExactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const asActionCoordinate = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const coordinate = value as Record<string, unknown>;
  if (!hasExactKeys(coordinate, ["row", "col"]) || !Number.isInteger(coordinate.row) || !Number.isInteger(coordinate.col)
    || Number(coordinate.row) < 0 || Number(coordinate.row) >= BOARD_SIZE
    || Number(coordinate.col) < 0 || Number(coordinate.col) >= BOARD_SIZE) return null;
  return { row: Number(coordinate.row), col: Number(coordinate.col) };
};
/** Strict persisted-action decoder. Network compatibility continues to use
 * asAction; durable history and terminal provenance never accept open shapes. */
export const asPersistedAction = (value: unknown): Action | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "pass" || candidate.type === "end_turn") {
    return hasExactKeys(candidate, ["type"]) ? { type: candidate.type } : null;
  }
  if (!["move", "project", "rush", "push", "follow", "retreat"].includes(String(candidate.type))) return null;
  const keys = candidate.type === "push" && candidate.targetId !== undefined
    ? ["type", "actorId", "targetId", "from", "to"]
    : ["type", "actorId", "from", "to"];
  const from = asActionCoordinate(candidate.from), to = asActionCoordinate(candidate.to);
  if (!hasExactKeys(candidate, keys) || typeof candidate.actorId !== "string" || !candidate.actorId || !from || !to
    || (candidate.type === "push" && candidate.targetId !== undefined
      && (typeof candidate.targetId !== "string" || !candidate.targetId))) return null;
  return { type: candidate.type as Action["type"], actorId: candidate.actorId, from, to,
    ...(candidate.type === "push" && candidate.targetId !== undefined ? { targetId: String(candidate.targetId) } : {}) };
};
const asCoordinate = (value: unknown): { row: number; col: number } | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as { row?: unknown; col?: unknown };
  if (typeof candidate.row !== "number" || typeof candidate.col !== "number") {
    return null;
  }
  return { row: candidate.row, col: candidate.col };
};
const asScenarioSavedSelection = (value: unknown): ScenarioSavedSelection | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const source = asCoordinate(candidate.source);
  const target = candidate.target == null ? null : asCoordinate(candidate.target);
  if (
    !source ||
    (candidate.target != null && !target) ||
    (candidate.actorSide !== "P1" && candidate.actorSide !== "P2") ||
    typeof candidate.turnIndex !== "number"
  ) {
    return null;
  }
  return {
    source,
    target,
    actorSide: candidate.actorSide,
    turnIndex: candidate.turnIndex,
  };
};
export const asScenarioRecord = (value: unknown): ScenarioRecord | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.formatVersion !== 2 ||
    typeof candidate.id !== "string" ||
    !isUuidV4(candidate.id) ||
    typeof candidate.title !== "string"
  ) {
    return null;
  }
  if (!asGameState(candidate.initialState) || !asGameState(candidate.resultingState)) {
    return null;
  }
  if (!Array.isArray(candidate.moves)) {
    return null;
  }
  const moves = candidate.moves.map((entry) => {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const move = entry as Record<string, unknown>;
    const action = asAction(move.action);
    let retreatSemantics: RetreatSemantics;
    try { retreatSemantics = archivedRetreatSemantics(move.retreatSemantics); } catch { return null; }
    if (
      !action ||
      typeof move.turnIndex !== "number" ||
      typeof move.turnMoveIndex !== "number" ||
      (move.actorSide !== "P1" && move.actorSide !== "P2") ||
      typeof move.notation !== "string"
    ) {
      return null;
    }
    return {
      turnIndex: move.turnIndex,
      turnMoveIndex: move.turnMoveIndex,
      actorSide: move.actorSide,
      notation: move.notation,
      action,
      ...(move.retreatSemantics === undefined ? {} : { retreatSemantics }),
    } satisfies ScenarioMoveEntry;
  });
  if (moves.some((move) => move === null)) {
    return null;
  }
  return {
    formatVersion: 2,
    id: candidate.id,
    title: candidate.title,
    description: typeof candidate.description === "string" ? candidate.description : candidate.title,
    incorrect: candidate.incorrect === true,
    initialState: candidate.initialState as GameState,
    moves: moves as ScenarioMoveEntry[],
    resultingState: candidate.resultingState as GameState,
    expectedFinalStateHash:
      typeof candidate.expectedFinalStateHash === "string"
        ? candidate.expectedFinalStateHash
        : typeof candidate.expected_final_state_hash === "string"
          ? candidate.expected_final_state_hash
          : "",
    expectedOutcome:
      candidate.expectedOutcome === "ongoing" ||
      candidate.expectedOutcome === "p1_win" ||
      candidate.expectedOutcome === "p2_win" ||
      candidate.expectedOutcome === "draw"
        ? candidate.expectedOutcome
        : candidate.expected_outcome === "ongoing" ||
            candidate.expected_outcome === "p1_win" ||
            candidate.expected_outcome === "p2_win" ||
            candidate.expected_outcome === "draw"
          ? candidate.expected_outcome
          : "ongoing",
    savedSelection:
      asScenarioSavedSelection(candidate.savedSelection) ??
      asScenarioSavedSelection(candidate.saved_selection) ??
      null,
  };
};

export const asPreparedImportedHistory = (value: unknown): PreparedImportedHistory | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.complete !== "boolean" || !Number.isSafeInteger(candidate.moveCount)
    || Number(candidate.moveCount) < 0 || !Array.isArray(candidate.sources) || !Array.isArray(candidate.moves)) return null;
  const sources = candidate.sources.map(source => {
    if (!source || typeof source !== "object") return null;
    const record = source as Record<string, unknown>;
    if (!asIdentity(record.gameId) || !Number.isSafeInteger(record.gameplayRevision) || Number(record.gameplayRevision) < 0
      || !Number.isSafeInteger(record.moveCount) || Number(record.moveCount) < 0) return null;
    return { gameId: String(record.gameId), gameplayRevision: Number(record.gameplayRevision), moveCount: Number(record.moveCount) };
  });
  if (sources.some(source => source === null)) return null;
  const moves = candidate.moves.map(entry => {
    if (!entry || typeof entry !== "object") return null;
    const move = entry as MoveEntry;
    if (!asIdentity(move.moveId) || !Number.isSafeInteger(move.index) || !Number.isSafeInteger(move.turnIndex)
      || !Number.isSafeInteger(move.turnMoveIndex) || !Number.isFinite(move.displayMoveNumber)
      || (move.actorSide !== "P1" && move.actorSide !== "P2") || typeof move.at !== "string"
      || typeof move.notation !== "string" || !asAction(move.action) || !asGameState(move.selectionSnapshot)
      || !asGameState(move.snapshot) || !move.importedFrom || !asIdentity(move.importedFrom.gameId)
      || !asIdentity(move.importedFrom.decisionId) || !Number.isSafeInteger(move.importedFrom.gameplayRevision)) return null;
    return clone(move);
  });
  if (moves.some(move => move === null) || moves.length !== Number(candidate.moveCount)) return null;
  const parsedSources = sources as ImportedHistorySource[];
  const parsedMoves = moves as MoveEntry[];
  const sourceCounts = new Map<string, number>();
  for (const source of parsedSources) {
    const key = `${source.gameId}\u0000${source.gameplayRevision}`;
    if (source.moveCount < 1 || sourceCounts.has(key)) return null;
    sourceCounts.set(key, source.moveCount);
  }
  const originCounts = new Map<string, number>();
  const originDecisions = new Set<string>();
  for (const move of parsedMoves) {
    const origin = move.importedFrom!;
    const decisionKey = `${origin.gameId}\u0000${origin.decisionId}`;
    const sourceKey = `${origin.gameId}\u0000${origin.gameplayRevision}`;
    if (originDecisions.has(decisionKey) || !sourceCounts.has(sourceKey)) return null;
    originDecisions.add(decisionKey);
    originCounts.set(sourceKey, (originCounts.get(sourceKey) ?? 0) + 1);
  }
  if (parsedSources.some(source => originCounts.get(`${source.gameId}\u0000${source.gameplayRevision}`) !== source.moveCount)) return null;
  if (parsedSources.reduce((total, source) => total + source.moveCount, 0) !== Number(candidate.moveCount)) return null;
  return {
    version: 1,
    complete: candidate.complete,
    moveCount: Number(candidate.moveCount),
    sources: parsedSources,
    moves: parsedMoves,
  };
};

export const addNotification = (game: LiveGame, message: string) => {
  game.notifications.unshift(message);
  if (game.notifications.length > 50) {
    game.notifications = game.notifications.slice(0, 50);
  }
};

export const createInitialGame = ({
  gameId,
  identityId,
  selfPlayMode,
  creatorSide = "p1",
}: {
  gameId: string;
  identityId: string;
  selfPlayMode: boolean;
  creatorSide?: "p1" | "p2";
}): LiveGame => {
  const initial = resolveToStability(createInitialState(), { artifactMode: "full" });
  const createdAt = now();
  return {
    id: gameId,
    gameplayRevision: 0,
    createdAt,
    lastMoveAt: null,
    updatedAt: createdAt,
    selfPlayMode,
    ...(selfPlayMode ? { selfPlayStartSide: creatorSide } : {}),
    board: { state: initial },
    player1: selfPlayMode || creatorSide === "p1" ? {
      identityId,
      connected: true,
      joinedAt: createdAt,
      lastHeartbeatAt: createdAt,
      sessionCount: 0,
    } : null,
    player2: selfPlayMode || creatorSide === "p2"
      ? {
          identityId,
          connected: true,
          joinedAt: createdAt,
          lastHeartbeatAt: createdAt,
          sessionCount: 0,
        }
      : null,
    viewers: [],
    pendingJoinRequests: [],
    pendingRevertRequest: null,
    turns: [
      {
        index: initial.turnIndex ?? 0,
        startedAt: createdAt,
        endedAt: null,
        playerSeat: getSeatForSide(getTurnOwnerSideForState(initial)),
        status: "active",
        moveIndexes: [],
        lastMoveAt: null,
      },
    ],
    moves: [],
    historyIndexByIdentity: {},
    pendingScenarioSelection: null,
    notifications: ["Game created", selfPlayMode ? "Self-play mode active" : "Invite a second player"],
    inviteTokens: {
      viewer: createInviteToken(),
      player1: createInviteToken(),
      player2: createInviteToken(),
    },
  };
};

const cloneParticipant = (participant: Participant | null): Participant | null =>
  participant
    ? {
        identityId: participant.identityId,
        connected: participant.connected,
        joinedAt: participant.joinedAt,
        lastHeartbeatAt: participant.lastHeartbeatAt,
        sessionCount: participant.sessionCount,
      }
    : null;

const renumberImportedHistory = (game: LiveGame) => {
  let activeMoveCounter = 0;
  game.moves.forEach((move, index) => {
    move.index = index;
    if (!move.moveId) {
      move.moveId = nextMoveId();
    }
    if (!isMoveUndone(move)) {
      activeMoveCounter += 1;
      move.displayMoveNumber = activeMoveCounter;
    } else if (typeof move.displayMoveNumber !== "number" || !Number.isFinite(move.displayMoveNumber)) {
      move.displayMoveNumber = activeMoveCounter;
    }
  });
  game.turns.forEach((turn) => {
    turn.moveIndexes = game.moves.filter((move) => !isMoveUndone(move) && move.turnIndex === turn.index).map((move) => move.index);
    turn.lastMoveAt = turn.moveIndexes.length > 0 ? game.moves[turn.moveIndexes[turn.moveIndexes.length - 1]]?.at ?? null : null;
    turn.status = turn === game.turns[game.turns.length - 1] ? "active" : "complete";
    turn.endedAt = turn.status === "complete" ? turn.lastMoveAt : null;
  });
};

export const exportScenarioFromGame = (
  game: LiveGame,
  {
    scenarioId,
    title,
    description,
    incorrect = false,
    moveLimit = game.moves.length,
  }: {
    scenarioId: string;
    title: string;
    description?: string;
    incorrect?: boolean;
    moveLimit?: number;
  },
): ScenarioRecord => {
  const boundedMoveLimit = Math.max(0, Math.min(moveLimit, game.moves.length));
  const exportedMoves = game.moves.slice(0, boundedMoveLimit).filter((move) => !isMoveUndone(move));
  const initialState = exportedMoves[0]?.selectionSnapshot ?? game.board.state;
  const resultingState = exportedMoves[exportedMoves.length - 1]?.snapshot ?? game.board.state;
  return {
    formatVersion: 2,
    id: scenarioId,
    title,
    description: description || title,
    incorrect,
    initialState: clone(initialState),
    moves: exportedMoves.map((move) => ({
      turnIndex: move.turnIndex,
      turnMoveIndex: move.turnMoveIndex,
      actorSide: move.actorSide,
      notation: move.notation,
      action: clone(move.action),
      ...(move.retreatSemantics === undefined ? {} : { retreatSemantics: move.retreatSemantics }),
    })),
    resultingState: clone(resultingState),
    expectedFinalStateHash: "",
    expectedOutcome: resultingState?.outcome?.status ?? "ongoing",
    savedSelection: null,
  };
};

const resolveImportedState = (state: GameState) => {
  const imported = clone(state);
  if (imported.continuation?.type === "push" && !imported.continuation.attackerOwner) {
    imported.continuation.attackerOwner = getTurnOwnerSideForState(imported);
  }
  return resolveToStability(imported, { artifactMode: "full" });
};

export const applyScenarioToGame = (game: LiveGame, scenario: ScenarioRecord) => {
  const initial = resolveImportedState(scenario.initialState);
  game.board.state = initial;
  game.moves = [];
  game.turns = [
    {
      index: initial.turnIndex ?? 0,
      startedAt: game.createdAt,
      endedAt: null,
      playerSeat: getSeatForSide(getTurnOwnerSideForState(initial)),
      status: "active",
      moveIndexes: [],
      lastMoveAt: null,
    },
  ];
  game.historyIndexByIdentity = {};
  game.pendingScenarioSelection = null;
  game.pendingRevertRequest = null;
  game.lastMoveAt = null;
  game.initialSelectionAction = null;

  const moveTimes: string[] = [];
  for (const scenarioMove of scenario.moves) {
    while ((getActiveTurn(game)?.index ?? 0) < scenarioMove.turnIndex) {
      const ended = endServerTurn(game);
      if (!ended.ok) {
        throw new Error(ended.error);
      }
    }
    const moved = applyServerActionForImport(game, scenarioMove.action, scenarioMove.notation, archivedRetreatSemantics(scenarioMove.retreatSemantics));
    if (!moved.ok) {
      throw new Error(moved.error || "scenario_apply_failed");
    }
    if ("move" in moved && moved.move) moveTimes.push(moved.move.at);
  }

  renumberImportedHistory(game);
  game.pendingScenarioSelection = clone(scenario.savedSelection);
  game.updatedAt = moveTimes[moveTimes.length - 1] ?? game.updatedAt;
  game.lastMoveAt = moveTimes[moveTimes.length - 1] ?? null;
  addNotification(game, `Scenario loaded: ${scenario.title}`);
};

export const reconcileGameToScenarioResultingState = (game: LiveGame, scenario: ScenarioRecord) => {
  const reconciled = resolveImportedState(scenario.resultingState);
  reconciled.sideToMove = scenario.resultingState.sideToMove;
  reconciled.turnIndex = scenario.resultingState.turnIndex;
  game.board.state = reconciled;

  const targetTurnIndex = reconciled.turnIndex ?? 0;
  const existingTurns = Array.isArray(game.turns) ? game.turns.filter((turn) => turn.index <= targetTurnIndex) : [];
  let targetTurn = existingTurns.find((turn) => turn.index === targetTurnIndex) ?? null;
  if (!targetTurn) {
    targetTurn = {
      index: targetTurnIndex,
      startedAt: game.createdAt,
      endedAt: null,
      playerSeat: getSeatForSide(getTurnOwnerSideForState(reconciled)),
      status: "active",
      moveIndexes: [],
      lastMoveAt: null,
    };
    existingTurns.push(targetTurn);
    existingTurns.sort((left, right) => left.index - right.index);
  }

  for (const turn of existingTurns) {
    if (turn.index < targetTurnIndex) {
      turn.status = "complete";
      turn.endedAt = turn.lastMoveAt ?? turn.endedAt ?? game.createdAt;
      continue;
    }
    turn.playerSeat = getSeatForSide(getTurnOwnerSideForState(reconciled));
    turn.status = "active";
    turn.endedAt = null;
    turn.lastMoveAt = turn.moveIndexes.length > 0 ? game.moves[turn.moveIndexes[turn.moveIndexes.length - 1]]?.at ?? null : null;
  }

  game.turns = existingTurns;
};

export const copyParticipantsBetweenGames = (source: LiveGame, target: LiveGame) => {
  target.selfPlayMode = source.selfPlayMode;
  target.player1 = cloneParticipant(source.player1);
  target.player2 = cloneParticipant(source.player2);
  target.viewers = source.viewers.map((viewer) => cloneParticipant(viewer)).filter(Boolean) as Viewer[];
  target.pendingJoinRequests = [];
};

const setParticipantForSeat = (game: LiveGame, seat: "Player 1" | "Player 2", participant: Participant | null) => {
  if (seat === "Player 1") {
    game.player1 = participant;
    return;
  }
  game.player2 = participant;
};

export const assignIdentityToScenarioSeat = (
  game: LiveGame,
  identityId: string,
  targetSeat: "Player 1" | "Player 2",
  sessionCount = 0,
) => {
  if (getSeatIdentity(game, targetSeat) === identityId) {
    return;
  }

  const otherSeat = getNextSeat(targetSeat);
  const importerSeat = getRolesForIdentity(game, identityId).find((role) => role === "Player 1" || role === "Player 2") ?? null;
  const targetParticipant = cloneParticipant(targetSeat === "Player 1" ? game.player1 : game.player2);
  const otherParticipant = cloneParticipant(otherSeat === "Player 1" ? game.player1 : game.player2);

  if (importerSeat === otherSeat) {
    setParticipantForSeat(game, targetSeat, otherParticipant);
    setParticipantForSeat(game, otherSeat, targetParticipant);
    return;
  }

  const existingParticipant = getParticipantsForIdentity(game, identityId)[0]?.participant ?? null;
  const joinedAt = existingParticipant?.joinedAt ?? now();
  const lastHeartbeatAt = existingParticipant?.lastHeartbeatAt ?? joinedAt;
  removeViewer(game, identityId);
  setParticipantForSeat(game, targetSeat, {
    identityId,
    connected: existingParticipant?.connected ?? sessionCount > 0,
    joinedAt,
    lastHeartbeatAt,
    sessionCount: existingParticipant?.sessionCount ?? sessionCount,
  });
  if (!otherParticipant && targetParticipant) {
    setParticipantForSeat(game, otherSeat, targetParticipant);
  }
};

export const resolveLaunchParticipantCopyMode = (
  source: LiveGame,
  identityId: string,
): LaunchParticipantCopyMode => {
  const roles = getRolesForIdentity(source, identityId);
  return roles.includes("Player 1") || roles.includes("Player 2")
    ? "copy_source_participants"
    : "viewer_as_side_to_move";
};

export const applyLaunchParticipantCopyMode = (
  source: LiveGame,
  target: LiveGame,
  identityId: string,
  mode: LaunchParticipantCopyMode,
) => {
  if (mode === "copy_source_participants") {
    copyParticipantsBetweenGames(source, target);
    return;
  }

  target.selfPlayMode = false;
  const sideToMoveSeat = getSideToMoveSeat(target);
  const viewerParticipant = {
    identityId,
    connected: true,
    joinedAt: target.createdAt,
    lastHeartbeatAt: target.createdAt,
    sessionCount: 0,
  };
  target.player1 = sideToMoveSeat === "Player 1" ? viewerParticipant : null;
  target.player2 = sideToMoveSeat === "Player 2" ? viewerParticipant : null;
  target.viewers = [];
  target.pendingJoinRequests = [];
};

export const findRoleForIdentity = (game: LiveGame, identityId: string): "Player 1" | "Player 2" | "Viewer" | "Guest" => {
  return getRolesForIdentity(game, identityId)[0] ?? "Guest";
};

export const getRolesForIdentity = (game: LiveGame, identityId: string): IdentityRole[] => {
  const roles: IdentityRole[] = [];
  if (game.player1?.identityId === identityId) roles.push("Player 1");
  if (game.player2?.identityId === identityId) roles.push("Player 2");
  if (game.viewers.some((viewer) => viewer.identityId === identityId)) roles.push("Viewer");
  return roles;
};

export const getParticipantsForIdentity = (
  game: LiveGame,
  identityId: string,
): Array<{ role: IdentityRole; participant: Participant }> => {
  const matches: Array<{ role: IdentityRole; participant: Participant }> = [];
  if (game.player1?.identityId === identityId) {
    matches.push({ role: "Player 1", participant: game.player1 });
  }
  if (game.player2?.identityId === identityId) {
    matches.push({ role: "Player 2", participant: game.player2 });
  }
  for (const viewer of game.viewers) {
    if (viewer.identityId === identityId) {
      matches.push({ role: "Viewer", participant: viewer });
    }
  }
  return matches;
};

export const getSeatIdentity = (game: LiveGame, seat: "Player 1" | "Player 2"): string | null =>
  seat === "Player 1" ? game.player1?.identityId ?? null : game.player2?.identityId ?? null;

export const getClaimableDualSeat = (game: LiveGame, identityId: string): "Player 1" | "Player 2" | null => {
  if (game.player1?.identityId === identityId && !game.player2) {
    return "Player 2";
  }
  if (game.player2?.identityId === identityId && !game.player1) {
    return "Player 1";
  }
  return null;
};

export const getApproverIdentityForSeat = (game: LiveGame, seat: "Player 1" | "Player 2"): string | null =>
  seat === "Player 1" ? game.player2?.identityId ?? null : game.player1?.identityId ?? null;

export const getControlSeatForTurn = (
  state: GameState,
  turnOwnerSeat: "Player 1" | "Player 2",
): "Player 1" | "Player 2" => {
  const continuation = state.continuation;
  if (!continuation) {
    return turnOwnerSeat;
  }
  if (continuation.type === "push" && continuation.phase === "retreat") {
    return getNextSeat(turnOwnerSeat);
  }
  return turnOwnerSeat;
};

export const ensureViewer = (game: LiveGame, identityId: string, sessionCount = 0) => {
  const existing = game.viewers.find((viewer) => viewer.identityId === identityId);
  if (existing) {
    existing.connected = sessionCount > 0 || existing.connected;
    if (sessionCount > 0) {
      existing.sessionCount = sessionCount;
      existing.lastHeartbeatAt = now();
    }
    return false;
  }
  const joinedAt = now();
  game.viewers.push({
    identityId,
    connected: sessionCount > 0,
    joinedAt,
    lastHeartbeatAt: joinedAt,
    sessionCount,
  });
  return true;
};

export const removeViewer = (game: LiveGame, identityId: string) => {
  game.viewers = game.viewers.filter((viewer) => viewer.identityId !== identityId);
};

export const promoteIdentityToSeat = (
  game: LiveGame,
  seat: "Player 1" | "Player 2",
  identityId: string,
  sessionCount = 0,
) => {
  const existingParticipant = getParticipantsForIdentity(game, identityId)[0]?.participant ?? null;
  const joinedAt = existingParticipant?.joinedAt ?? now();
  const lastHeartbeatAt = existingParticipant?.lastHeartbeatAt ?? joinedAt;
  removeViewer(game, identityId);
  const participant: Participant = {
    identityId,
    connected: existingParticipant?.connected ?? sessionCount > 0,
    joinedAt,
    lastHeartbeatAt,
    sessionCount: existingParticipant?.sessionCount ?? sessionCount,
  };
  if (seat === "Player 1") {
    game.player1 = participant;
  } else {
    game.player2 = participant;
  }
};

export const dismissCompetingJoinRequests = (game: LiveGame, acceptedIdentityId: string) => {
  game.pendingJoinRequests = game.pendingJoinRequests.filter((request) => request.identityId === acceptedIdentityId);
};

const getJoinAsPlayerDisabledReason = (game: LiveGame, myRole: string) => {
  if (myRole === "Player 1" || myRole === "Player 2") {
    return "You are already joined as a player.";
  }
  if (game.selfPlayMode) {
    return "Self-play mode does not accept remote player joins.";
  }
  if (game.player1 && game.player2) {
    return "Game already has the maximum number of players.";
  }
  return null;
};

const getJoinAsViewerDisabledReason = (game: LiveGame, myRole: string) => {
  if (myRole === "Viewer") {
    return "You are already joined as a viewer.";
  }
  if (myRole === "Player 1" || myRole === "Player 2") {
    return "You are already in this game.";
  }
  return null;
};

export const toStaticGameCard = (
  game: Pick<LiveGame, "id" | "createdAt" | "lastMoveAt" | "updatedAt" | "selfPlayMode" | "board" | "player1" | "player2" | "viewers"> & {
    pendingJoinRequests?: LiveGame["pendingJoinRequests"];
    historyIndexByIdentity?: LiveGame["historyIndexByIdentity"];
    pendingScenarioSelection?: LiveGame["pendingScenarioSelection"];
    moves?: LiveGame["moves"];
    moveCount?: number;
    previewSnapshot?: GameState | null;
    computer?: ComputerControl;
    eventSeq?: number;
    gameplayRevision?: number;
  },
  identityId: string,
): StaticGameCard => {
  const myRoles = getRolesForIdentity(
    {
      ...game,
      gameplayRevision: 0,
      pendingJoinRequests: Array.isArray(game.pendingJoinRequests) ? game.pendingJoinRequests : [],
      historyIndexByIdentity: game.historyIndexByIdentity ?? {},
      pendingScenarioSelection: game.pendingScenarioSelection ?? null,
      moves: Array.isArray(game.moves) ? game.moves : [],
      turns: [],
      pendingRevertRequest: null,
      notifications: [],
      inviteTokens: { viewer: "", player1: "", player2: "" },
    },
    identityId,
  );
  const myRole = myRoles[0] ?? 'Guest';
  const eventSeq = Number.isSafeInteger(game.eventSeq) && game.eventSeq! >= 0 ? game.eventSeq! : null;
  const gameplayRevision = Number.isSafeInteger(game.gameplayRevision) && game.gameplayRevision! >= 0 ? game.gameplayRevision! : null;
  const status = game.board.state?.outcome?.status;
  const confirmedOutcomeStatus = eventSeq !== null && gameplayRevision !== null && (status === 'ongoing' || isTerminalOutcome(status)) ? status : null;
  const canJoinAsPlayer = myRole !== "Player 1" && myRole !== "Player 2" && !game.selfPlayMode && (!game.player1 || !game.player2);
  return {
    id: game.id,
    eventSeq,
    gameplayRevision,
    confirmedOutcomeStatus,
    selfPlayMode: game.selfPlayMode === true,
    myRoles,
    createdAt: game.createdAt,
    lastMoveAt: game.lastMoveAt,
    updatedAt: game.updatedAt,
    moveCount:
      typeof game.moveCount === "number" && Number.isFinite(game.moveCount)
        ? game.moveCount
        : Array.isArray(game.moves)
          ? game.moves.length
          : 0,
    previewSnapshot: game.previewSnapshot ?? game.board.state ?? null,
    previewSelection: game.pendingScenarioSelection ?? null,
    myRole,
    canJoinAsPlayer,
    player1: game.player1 ? { ...game.player1, ...(game.computer ? { computerProfile: game.computer.seats.p1 } : {}) } : null,
    player2: game.player2 ? { ...game.player2, ...(game.computer ? { computerProfile: game.computer.seats.p2 } : {}) } : null,
  };
};

const buildViewModel = (game: LiveGame, identityId: string, includeLegalActions: boolean) => {
  const historyIndexByIdentity = game.historyIndexByIdentity ?? {};
  const moves = Array.isArray(game.moves) ? game.moves : [];
  const turns = Array.isArray(game.turns) ? game.turns : [];
  const pendingJoinRequests = Array.isArray(game.pendingJoinRequests) ? game.pendingJoinRequests : [];
  const inviteTokens = game.inviteTokens ?? {
    viewer: "",
    player1: "",
    player2: "",
  };
  const myRoles = getRolesForIdentity(
    {
      ...game,
      viewers: Array.isArray(game.viewers) ? game.viewers : [],
    },
    identityId,
  );
  const myRole = myRoles[0] ?? "Guest";
  const myConnectionConnected = myRoles.length > 0
    ? myRoles.every((role) => {
        if (role === "Player 1") return Boolean(game.player1?.connected);
        if (role === "Player 2") return Boolean(game.player2?.connected);
        return game.viewers.some((viewer) => viewer.identityId === identityId && viewer.connected);
      })
    : false;
  const historyIndex = includeLegalActions && typeof historyIndexByIdentity[identityId] === "number" ? historyIndexByIdentity[identityId] : null;
  const inHistoryMode = typeof historyIndex === "number";
  const currentSnapshot =
    typeof historyIndex === "number" && moves[historyIndex]
      ? moves[historyIndex].snapshot
      : game.board.state;
  const pendingScenarioSelection =
    game.pendingScenarioSelection &&
    game.pendingScenarioSelection.actorSide === currentSnapshot?.sideToMove &&
    game.pendingScenarioSelection.turnIndex === currentSnapshot?.turnIndex
      ? clone(game.pendingScenarioSelection)
      : null;
  const historySelectionAction =
    typeof historyIndex === "number" && moves[historyIndex]
      ? clone(moves[historyIndex].action)
      : null;
  const initialSelectionAction = !inHistoryMode ? clone(game.initialSelectionAction ?? null) : null;
  const activeTurn = turns[turns.length - 1] ?? null;
  const turnOwnerSeat = activeTurn?.playerSeat ?? getSideToMoveSeat(game);
  const controlSeat = getControlSeatForTurn(game.board.state, turnOwnerSeat);
  const sideToMoveIdentity = getSeatIdentity(game, controlSeat);
  const turnOwnerIdentity = getSeatIdentity(game, turnOwnerSeat);
  const isPlayer = myRole === "Player 1" || myRole === "Player 2";
  const legalNow = includeLegalActions ? listLegalActions(game.board.state) : [];
  const computerTurn = computerProfileFor(game.computer, getSideForSeat(controlSeat), game.board.state.turnIndex ?? 0);
  const approvableRequesterIds = pendingJoinRequests
    .filter((request) => getApproverIdentityForSeat(game, request.requestedSeat) === identityId)
    .map((request) => request.identityId);
  const myPendingJoinRequest = pendingJoinRequests.find((request) => request.identityId === identityId) ?? null;
  const pendingRevertRequest = game.pendingRevertRequest?.status === "pending" ? game.pendingRevertRequest : null;
  const myPendingRevertRequest = pendingRevertRequest?.requesterIdentityId === identityId ? pendingRevertRequest : null;
  const myPlayerRole = myRoles.find((role) => role === "Player 1" || role === "Player 2") ?? null;
  const pendingRevertRequesterRole = pendingRevertRequest
    ? getRolesForIdentity(game, pendingRevertRequest.requesterIdentityId).find((role) => role === "Player 1" || role === "Player 2") ?? null
    : null;
  const approvableRevertRequest =
    pendingRevertRequest && pendingRevertRequesterRole
      ? getApproverIdentityForSeat(game, pendingRevertRequesterRole) === identityId
        ? pendingRevertRequest
        : null
      : null;
  const activeMoves = moves.filter((move) => !isMoveUndone(move));
  const latestActiveMove = activeMoves[activeMoves.length - 1] ?? null;
  const latestActiveMoveSeat = latestActiveMove ? getSeatForSide(latestActiveMove.actorSide) : null;
  const canUndoLastMove = Boolean(
    latestActiveMove &&
      !latestActiveMove.importedFrom &&
      latestActiveMoveSeat &&
      getSeatIdentity(game, latestActiveMoveSeat) === identityId,
  );
  const joinAsPlayerDisabledReason = getJoinAsPlayerDisabledReason(game, myRole);
  const joinAsViewerDisabledReason = getJoinAsViewerDisabledReason(game, myRole);

  return {
    ...clone(game),
    ...(game.computer ? {
      player1: game.player1 ? { ...clone(game.player1), computerProfile: game.computer.manual ? null : game.computer.seats.p1 } : null,
      player2: game.player2 ? { ...clone(game.player2), computerProfile: game.computer.manual ? null : game.computer.seats.p2 } : null,
    } : {}),
    historyIndexByIdentity: undefined,
    historyIndex,
    myRole,
    myRoles,
    myConnectionConnected,
    inHistoryMode,
    currentSnapshot,
    pendingScenarioSelection,
    canJoinAsPlayer: !joinAsPlayerDisabledReason,
    canJoinAsViewer: !joinAsViewerDisabledReason,
    canPlayAsBothPlayers: !game.computer && Boolean(getClaimableDualSeat(game, identityId)),
    joinAsPlayerDisabledReason,
    joinAsViewerDisabledReason,
    canInvite: true,
    inviteToken:
      myRole === "Player 1"
        ? inviteTokens.player1
        : myRole === "Player 2"
          ? inviteTokens.player2
          : inviteTokens.viewer,
    showJoinActions: true,
    computerTurn,
    canControlComputer: game.computer?.ownerId === identityId,
    canRecordMove: !computerTurn && isPlayer && !inHistoryMode && sideToMoveIdentity === identityId && legalNow.length > 0,
    legalActions: legalNow,
    canEndTurn:
      !computerTurn && isPlayer &&
      !inHistoryMode &&
      controlSeat === turnOwnerSeat &&
      turnOwnerIdentity === identityId &&
      validateAction(game.board.state, { type: "end_turn" }).ok,
    currentTurn: activeTurn ? clone(activeTurn) : null,
    historySelectionAction,
    initialSelectionAction,
    turnOwnerSeat,
    controlSeat,
    control: controlSeat === turnOwnerSeat ? "turn-owner" : "opponent",
    pendingPlayerRequestSeat: myPendingJoinRequest?.requestedSeat ?? null,
    approvableRequesterIds,
    pendingRevertRequest,
    myPendingRevertRequest,
    approvableRevertRequest,
    canUndoLastMove,
    latestActiveMoveId: latestActiveMove?.moveId ?? null,
  };
};

export const withFullViewModel = (game: LiveGame, identityId: string) => buildViewModel(game, identityId, true);

/** Presentation only. Never use this projection as command/reconciliation state. */
export const withPositionViewModel = (game: LiveGame, identityId: string) => {
  const view = buildViewModel(game, identityId, false);
  return { ...view, legalActions: undefined, positionOnly: true as const, historyProjection: LIVE_HISTORY.snapshotValue,
    canRecordMove: false, canEndTurn: false, canUndoLastMove: false,
    canPlayAsBothPlayers: false, canControlComputer: false, canInvite: false, canJoinAsPlayer: false,
    canJoinAsViewer: false, showJoinActions: false, inviteToken: null,
    sharedMutationsBlocked: true };
};
export const withViewModel = withFullViewModel;

const formatCoordinate = (coord: { row: number; col: number } | null | undefined) =>
  coord ? `(${coord.row},${coord.col})` : "(?,?)";

const defaultNotationForAction = (action: Action) => {
  if (action.type === "end_turn") return "END TURN";
  if (action.type === "pass") {
    return "PASS";
  }
  return `${action.type.toUpperCase()} ${formatCoordinate(action.from)} -> ${formatCoordinate(action.to)}`;
};

const renumberHistory = (game: LiveGame, preservedMoves?: Set<MoveEntry>) => {
  let activeMoveCounter = 0;
  game.moves.forEach((move, index) => {
    if (preservedMoves?.has(move)) return;
    move.index = index;
    if (!move.moveId) {
      move.moveId = nextMoveId();
    }
    const hasStableDisplayNumber = typeof move.displayMoveNumber === "number" && Number.isFinite(move.displayMoveNumber);
    if (!isMoveUndone(move)) {
      activeMoveCounter += 1;
      if (!hasStableDisplayNumber) {
        move.displayMoveNumber = activeMoveCounter;
      }
    } else if (!hasStableDisplayNumber) {
      move.displayMoveNumber = activeMoveCounter;
    }
  });
  game.turns.forEach((turn) => {
    turn.moveIndexes = game.moves
      .filter((move) => !isMoveUndone(move) && move.turnIndex === turn.index)
      .map((move) => move.index);
    turn.lastMoveAt = turn.moveIndexes.length > 0 ? game.moves[turn.moveIndexes[turn.moveIndexes.length - 1]]?.at ?? null : null;
  });
};

const rebuildTurnsFromActiveMoves = (game: LiveGame, referenceState: GameState) => {
  const activeMoves = getActiveMoves(game);
  const turnsByIndex = new Map<number, TurnEntry>();
  for (const move of activeMoves) {
    const turn = turnsByIndex.get(move.turnIndex) ?? {
      index: move.turnIndex,
      startedAt: move.at,
      endedAt: null,
      playerSeat: getSeatForSide(getTurnOwnerSideForState(move.selectionSnapshot)),
      status: "complete",
      moveIndexes: [],
      lastMoveAt: null,
    };
    turn.moveIndexes.push(move.index);
    turn.lastMoveAt = move.at;
    turnsByIndex.set(move.turnIndex, turn);
  }
  const activeTurnIndex = referenceState.turnIndex ?? 0;
  const activeTurn = turnsByIndex.get(activeTurnIndex) ?? {
    index: activeTurnIndex,
    startedAt: now(),
    endedAt: null,
    playerSeat: getSeatForSide(getTurnOwnerSideForState(referenceState)),
    status: "active",
    moveIndexes: [],
    lastMoveAt: null,
  };
  activeTurn.playerSeat = getSeatForSide(getTurnOwnerSideForState(referenceState));
  activeTurn.status = "active";
  activeTurn.endedAt = null;
  turnsByIndex.set(activeTurnIndex, activeTurn);
  game.turns = [...turnsByIndex.values()].sort((left, right) => left.index - right.index);
  for (const turn of game.turns) {
    if (turn.index < activeTurnIndex) {
      turn.status = "complete";
      turn.endedAt = turn.lastMoveAt ?? turn.endedAt ?? now();
    } else if (turn.index > activeTurnIndex) {
      turn.status = "complete";
      turn.endedAt = turn.lastMoveAt ?? turn.endedAt ?? now();
    }
  }
};

export const applyImportedHistoryToGame = (game: LiveGame, prepared: PreparedImportedHistory) => {
  const seen = new Set<string>();
  const activeMoves = prepared.moves.flatMap(move => {
    const origin = move.importedFrom!;
    const key = `${origin.gameId}\u0000${origin.decisionId}`;
    if (seen.has(key) || move.undone) return [];
    seen.add(key);
    return [clone(move)];
  });
  if (activeMoves.length !== prepared.moveCount) throw new Error("invalid_imported_history_count");
  game.moves = activeMoves.map((move, index) => ({ ...move, index }));
  game.importedHistory = {
    version: 1,
    complete: prepared.complete,
    moveCount: activeMoves.length,
    sources: clone(prepared.sources),
  };
  rebuildTurnsFromActiveMoves(game, game.board.state);
};

const toSavedSelectionFromMove = (move: MoveEntry) => {
  const source = move.action?.from ?? null;
  const target = move.action?.to ?? null;
  if (!source || typeof source.row !== "number" || typeof source.col !== "number") {
    return null;
  }
  return {
    source: { row: source.row, col: source.col },
    target: target && typeof target.row === "number" && typeof target.col === "number" ? { row: target.row, col: target.col } : null,
    actorSide: move.actorSide,
    turnIndex: move.turnIndex,
  } satisfies ScenarioSavedSelection;
};

export const applyRevertToMove = (game: LiveGame, targetMoveId: string, requesterIdentityId: string, archivedTarget?: MoveEntry) => {
  const targetIndex = game.moves.findIndex((move) => move.moveId === targetMoveId);
  if (targetIndex < 0 && !archivedTarget) {
    return { ok: false as const, error: "move_not_found" };
  }
  const targetMove = targetIndex < 0 ? archivedTarget! : game.moves[targetIndex];
  if (targetMove.importedFrom) {
    return { ok: false as const, error: "imported_move_read_only" };
  }
  const revertedAt = now();
  const previouslyUndone = new Set(game.moves.filter(move => move.undone === true));
  for (let index = Math.max(0, targetIndex); index < game.moves.length; index += 1) {
    if (previouslyUndone.has(game.moves[index])) continue;
    game.moves[index].undone = true;
    game.moves[index].undoneAt = revertedAt;
    game.moves[index].undoneByIdentityId = requesterIdentityId;
  }
  game.lastRestoration = { decisionId: targetMove.moveId, at: revertedAt };
  if (game.computer) { game.computer.generation++; game.computer.lease = null; game.computer.singleStep = false; game.computer.takeoverTurn = null; }
  game.board.state = clone(targetMove.selectionSnapshot);
  game.pendingScenarioSelection = toSavedSelectionFromMove(targetMove);
  game.initialSelectionAction = clone(targetMove.action);
  game.pendingRevertRequest = null;
  delete game.terminalOutcome;
  game.historyIndexByIdentity = {};
  renumberHistory(game, previouslyUndone);
  rebuildTurnsFromActiveMoves(game, game.board.state);
  game.lastMoveAt = getActiveMoves(game).at(-1)?.at ?? null;
  game.updatedAt = revertedAt;
  addNotification(game, "Undo applied");
  return { ok: true as const, targetMove };
};

type AcceptedGameplayResult = {
  move?: MoveEntry;
  destroyedPieces?: DestroyedPieceRecord[];
  removedPieces?: RemovedPieceNotice[];
  turnSettled?: boolean;
  terminalEffect?: TerminalOutcomeRecord["effect"];
};

export const activeActionEvidence = (game: Pick<LiveGame, "moves" | "importedHistory">) => {
  const active = game.moves.filter(move => move.undone !== true && move.action.type !== "end_turn");
  const imported = active.filter(move => move.importedFrom !== undefined);
  const local = active.filter(move => move.importedFrom === undefined);
  const lineage = game.importedHistory;
  const origins = new Set(imported.map(move => `${move.importedFrom!.gameId}\u0000${move.importedFrom!.decisionId}`));
  const importedMetadataMatches = lineage
    ? lineage.version === 1 && lineage.moveCount === imported.length && origins.size === imported.length
      && lineage.sources.reduce((total, source) => total + source.moveCount, 0) === imported.length
    : imported.length === 0;
  const localIds = new Set(local.flatMap(move => typeof move.moveId === "string" && move.moveId ? [move.moveId] : []));
  // A full retained window is ambiguous: older local decisions may already
  // have been archived away, and the archive does not currently persist a
  // canonical active-action total. Never manufacture completeness from it.
  const localComplete = localIds.size === local.length && (lineage !== undefined || local.length < MAX_HISTORY);
  const importedComplete = importedMetadataMatches && (lineage?.complete ?? true);
  return {
    activeActionCount: origins.size + localIds.size,
    activeActionCountComplete: importedComplete && localComplete,
    lineage: {
      version: lineage?.version ?? null,
      complete: importedComplete,
      importedMoveCount: origins.size,
      sources: clone(lineage?.sources ?? []),
    },
  };
};

const freezeTerminalOutcome = (
  game: LiveGame,
  action: Action,
  result: AcceptedGameplayResult,
  cause: TerminalOutcomeRecord["cause"],
  commit: { clientCommandId: string; eventSeq: number; gameplayRevision: number; actorSide: "P1" | "P2"; turnIndex: number },
): TerminalOutcomeRecord => {
  const actionEvidence = activeActionEvidence(game);
  const terminalOutcome: TerminalOutcomeRecord = {
    version: 1,
    decisive: { action: clone(action), actorSide: commit.actorSide, decisionId: result.move?.moveId ?? null,
      clientCommandId: commit.clientCommandId, turnIndex: commit.turnIndex },
    board: clone(game.board.state),
    removals: clone([...(result.destroyedPieces ?? [])]),
    result: clone(game.board.state.outcome as TerminalOutcomeRecord["result"]),
    ...(result.terminalEffect ? { effect: clone(result.terminalEffect) } : {}),
    cause,
    commit: { clientCommandId: commit.clientCommandId, eventSeq: commit.eventSeq, gameplayRevision: commit.gameplayRevision },
    lineage: actionEvidence.lineage,
    activeActionCount: actionEvidence.activeActionCount,
    activeActionCountComplete: actionEvidence.activeActionCountComplete,
  };
  game.terminalOutcome = terminalOutcome;
  return clone(terminalOutcome);
};

/** A retained or restored sole-Pass position is ended only when its current
 * owner submits the still-legal Pass mutation. The Pass is acknowledged as the
 * transaction trigger but is never appended as a played decision. */
export const applyAuthorizedPendingAutomaticEnding = (
  game: LiveGame,
  action: Action,
  commit: { clientCommandId: string; eventSeq: number; gameplayRevision: number; actorSide: "P1" | "P2"; turnIndex: number },
  expectedState: GameState | null,
): TerminalOutcomeRecord | null => {
  if (game.terminalOutcome || action.type !== "pass" || game.board.state.outcome.status !== "ongoing" || game.board.state.continuation) return null;
  const stable = resolveToStability(game.board.state, { artifactMode: "full" });
  const expectedStable = expectedState && resolveToStability(expectedState, { artifactMode: "full" });
  if (!expectedStable || deterministicStateHash(expectedStable) !== deterministicStateHash(stable)
    || !validateAction(stable, action).ok) return null;
  const incoming = probeIncomingTurnImmobility(stable, {
    kind: "ordinary-incoming-live-turn", incomingSide: stable.sideToMove, turnIndex: stable.turnIndex,
  });
  if (incoming.kind !== "incoming-loss" || incoming.incomingSide !== commit.actorSide) return null;
  const effectBefore = clone(stable);
  game.board.state = stable;
  game.board.state.outcome = { status: incoming.winner === "P1" ? "p1_win" : "p2_win",
    reason: `${incoming.incomingSide.toLowerCase()}_incoming_turn_immobility` };
  const endedAt = now();
  const activeTurn = getActiveTurn(game);
  if (activeTurn) { activeTurn.status = "complete"; activeTurn.endedAt = endedAt; }
  game.updatedAt = endedAt;
  return freezeTerminalOutcome(game, action, { terminalEffect: { version: 1, kind: "pending-pass", before: effectBefore } },
    { kind: "incoming-turn-immobility", incomingSide: incoming.incomingSide }, commit);
};

/** Accepted Undo is a current-rules mutation. Evaluate its restored frame in
 * the same fenced transaction, without fabricating or appending a move. */
export const applyAcceptedRestorationAutomaticEnding = (
  game: LiveGame,
  operation: { clientCommandId: string; eventSeq: number; gameplayRevision: number },
): TerminalOutcomeRecord | null => {
  const turnIndex = getActiveTurn(game)?.index ?? game.board.state.turnIndex;
  const pending = applyAuthorizedPendingAutomaticEnding(game, { type: "pass" }, {
    ...operation, actorSide: game.board.state.sideToMove, turnIndex,
  }, clone(game.board.state));
  if (pending) return pending;
  if (game.terminalOutcome || game.board.state.outcome.status !== "ongoing") return null;
  const before = clone(game.board.state), turnOwnerSide = getTurnOwnerSideForState(before);
  const removals: RemovalEvent[] = [];
  const stable = resolveToStability(before, { artifactMode: "full", onRemoval: event => removals.push(clone(event)) });
  let cause: TerminalOutcomeRecord["cause"] | null = null;
  if (isTerminalOutcome(stable.outcome.status)) {
    game.board.state = stable;
    cause = { kind: "commander-settlement", reason: stable.outcome.reason ?? "commander_outcome" };
  } else if (stable.continuation) {
    const proof = proveRelevantContinuation(stable, turnOwnerSide);
    if (proof.kind !== "proven-terminal") return null;
    const settlement = probeTerminalSettlement(stable);
    if (settlement.kind !== "settled" || !settlement.persistable
      || settlement.frame.occupancy.outcome.status !== proof.candidateOutcome.status) return null;
    game.board.state = clone(settlement.frame.occupancy);
    removals.push(...clone(settlement.removals));
    cause = { kind: "relevant-continuation-finality", endpointCount: proof.endpointCount,
      optionalEndpointCount: proof.optionalEndpointCount };
  }
  if (!cause) return null;
  const endedAt = now(), activeTurn = getActiveTurn(game);
  if (activeTurn) { activeTurn.status = "complete"; activeTurn.endedAt = endedAt; }
  game.updatedAt = endedAt;
  const destroyedPieces = destructionRecords(removals, operation.clientCommandId);
  return freezeTerminalOutcome(game, { type: "end_turn" }, {
    destroyedPieces, terminalEffect: { version: 1, kind: "restoration", before },
  }, cause, { ...operation, actorSide: turnOwnerSide, turnIndex });
};

export const terminalEffectMatches = (record: TerminalOutcomeRecord, turns: TurnEntry[]): boolean => {
  if (record.decisive.decisionId !== null) return record.effect === undefined;
  const effect = record.effect;
  if (!effect || effect.version !== 1) return false;
  try {
    if (effect.kind === "pending-pass") {
      if (record.decisive.action.type !== "pass" || record.removals.length !== 0) return false;
      const stable = resolveToStability(clone(effect.before), { artifactMode: "full" });
      if (stable.turnIndex !== record.decisive.turnIndex || stable.sideToMove !== record.decisive.actorSide) return false;
      const proof = probeIncomingTurnImmobility(stable, {
        kind: "ordinary-incoming-live-turn", incomingSide: stable.sideToMove, turnIndex: stable.turnIndex,
      });
      if (proof.kind !== "incoming-loss" || proof.incomingSide !== record.decisive.actorSide) return false;
      stable.outcome = { status: proof.winner === "P1" ? "p1_win" : "p2_win",
        reason: `${proof.incomingSide.toLowerCase()}_incoming_turn_immobility` };
      return deterministicStateHash(stable) === deterministicStateHash(record.board);
    }
    if (effect.kind === "restoration") {
      if (record.decisive.action.type !== "end_turn") return false;
      const removals: RemovalEvent[] = [];
      const stable = resolveToStability(clone(effect.before), { artifactMode: "full", onRemoval: event => removals.push(clone(event)) });
      if (stable.turnIndex !== record.decisive.turnIndex || getTurnOwnerSideForState(stable) !== record.decisive.actorSide) return false;
      if (isTerminalOutcome(stable.outcome.status)) {
        return record.cause.kind === "commander-settlement"
          && deterministicStateHash(stable) === deterministicStateHash(record.board)
          && JSON.stringify(destructionRecords(removals, record.decisive.clientCommandId)) === JSON.stringify(record.removals);
      }
      if (!stable.continuation) return false;
      const owner = getTurnOwnerSideForState(stable), proof = proveRelevantContinuation(stable, owner);
      const settlement = probeTerminalSettlement(stable);
      if (record.cause.kind !== "relevant-continuation-finality" || proof.kind !== "proven-terminal"
        || settlement.kind !== "settled" || !settlement.persistable) return false;
      removals.push(...clone(settlement.removals));
      return proof.endpointCount === record.cause.endpointCount
        && proof.optionalEndpointCount === record.cause.optionalEndpointCount
        && deterministicStateHash(settlement.frame.occupancy) === deterministicStateHash(record.board)
        && JSON.stringify(destructionRecords(removals, record.decisive.clientCommandId)) === JSON.stringify(record.removals);
    }
    if (effect.kind !== "end-turn" || record.decisive.action.type !== "end_turn") return false;
    if (effect.before.turnIndex !== record.decisive.turnIndex
      || getTurnOwnerSideForState(effect.before) !== record.decisive.actorSide) return false;
    const turn = turns.find(candidate => candidate.index === record.decisive.turnIndex);
    if (!turn?.endedAt) return false;
    const removals: RemovalEvent[] = [];
    const applied = applyAction(clone(effect.before), { type: "end_turn" }, { onRemoval: event => removals.push(clone(event)) });
    const resolved = finalizeResolvedTurn({ state: applied.state,
      activeTurn: { ...clone(turn), status: "active", endedAt: null }, endedAt: turn.endedAt,
      resolveToStability, onRemoval: event => removals.push(clone(event)) });
    return deterministicStateHash(resolved.nextState) === deterministicStateHash(record.board)
      && JSON.stringify(destructionRecords(removals, record.decisive.clientCommandId)) === JSON.stringify(record.removals);
  } catch {
    return false;
  }
};

/**
 * Apply current automatic-ending rules only inside an already-authorized
 * accepted gameplay command. Callers must persist the returned game, event and
 * receipt atomically. Reads and branch preparation never enter this function.
 */
export const applyAcceptedAutomaticEnding = (
  game: LiveGame,
  action: Action,
  result: AcceptedGameplayResult,
  commit: { clientCommandId: string; eventSeq: number; gameplayRevision: number; actorSide: "P1" | "P2"; turnOwnerSide: "P1" | "P2"; turnIndex: number },
): TerminalOutcomeRecord | null => {
  if (game.terminalOutcome) return clone(game.terminalOutcome);
  const activeTurn = getActiveTurn(game);
  let cause: TerminalOutcomeRecord["cause"] | null = null;
  let additionalRemovals: RemovalEvent[] = [];

  if (isTerminalOutcome(game.board.state.outcome.status)) {
    cause = { kind: "commander-settlement", reason: game.board.state.outcome.reason ?? "commander_outcome" };
  } else if (game.board.state.continuation) {
    const push = action.type === "push" && result.move
      ? { decisionId: result.move.moveId, action: clone(action), frameHash: deterministicStateHash(game.board.state) }
      : undefined;
    const proof = proveRelevantContinuation(game.board.state, commit.turnOwnerSide, { push });
    if (proof.kind === "proven-terminal") {
      const settlement = probeTerminalSettlement(game.board.state, push);
      if (settlement.kind !== "settled" || !settlement.persistable
        || settlement.frame.occupancy.outcome.status !== proof.candidateOutcome.status) return null;
      game.board.state = clone(settlement.frame.occupancy);
      additionalRemovals = clone(settlement.removals);
      cause = { kind: "relevant-continuation-finality", endpointCount: proof.endpointCount,
        optionalEndpointCount: proof.optionalEndpointCount };
      if (activeTurn) {
        activeTurn.status = "complete";
        activeTurn.endedAt = game.updatedAt;
      }
    }
  } else if (result.turnSettled) {
    const incoming = probeIncomingTurnImmobility(game.board.state, {
      kind: "ordinary-incoming-live-turn",
      incomingSide: game.board.state.sideToMove,
      turnIndex: game.board.state.turnIndex,
    });
    if (incoming.kind === "incoming-loss") {
      game.board.state.outcome = {
        status: incoming.winner === "P1" ? "p1_win" : "p2_win",
        reason: `${incoming.incomingSide.toLowerCase()}_incoming_turn_immobility`,
      };
      cause = { kind: "incoming-turn-immobility", incomingSide: incoming.incomingSide };
    }
  }
  if (!cause || !isTerminalOutcome(game.board.state.outcome.status)) return null;

  const operationId = commit.clientCommandId || result.move?.moveId || "terminal-outcome";
  const addedDestroyed = destructionRecords(additionalRemovals, operationId);
  if (result.move && addedDestroyed.length) {
    result.move.snapshot = clone(game.board.state);
    result.move.destroyedPieces = [...(result.move.destroyedPieces ?? []), ...addedDestroyed];
  }
  if (additionalRemovals.length) {
    result.destroyedPieces = [...(result.destroyedPieces ?? []), ...addedDestroyed];
    result.removedPieces = [...(result.removedPieces ?? []), ...removalNotices(additionalRemovals, operationId)];
  }
  return freezeTerminalOutcome(game, action, result, cause, commit);
};

const pickLegalAction = (state: GameState): Action | null => {
  const legal = listLegalActions(state);
  if (legal.length === 0) {
    return null;
  }
  return legal[0] as Action;
};

export const resolveServerMoveAction = (game: LiveGame): Action | null =>
  pickLegalAction(resolveToStability(game.board.state, { artifactMode: "full" }));

export const applyServerAction = (game: LiveGame, action: Action, notation?: string, clientCommandId?: string | null) => {
  return applyServerActionWithExpectedState(game, action, null, notation, clientCommandId);
};

// Import-only adapter: HTTP/live callers always enter the current-rule wrapper.
const applyServerActionForImport = (game: LiveGame, action: Action, notation: string, retreatSemantics: RetreatSemantics) =>
  applyServerActionInternal(game, action, null, notation, null, retreatSemantics);

export const applyServerActionWithExpectedState = (
  game: LiveGame,
  action: Action,
  expectedState: GameState | null,
  notation?: string,
  clientCommandId?: string | null,
) => applyServerActionInternal(game, action, expectedState, notation, clientCommandId, CURRENT_RETREAT_SEMANTICS);

const applyServerActionInternal = (
  game: LiveGame,
  action: Action,
  expectedState: GameState | null,
  notation: string | undefined,
  clientCommandId: string | null | undefined,
  retreatSemantics: RetreatSemantics,
) => {
  if (clientCommandId) {
    const existingMove = game.moves.find((entry) => !isMoveUndone(entry) && entry.clientCommandId === clientCommandId);
    if (existingMove) {
      return {
        ok: true as const,
        duplicate: true as const,
        move: clone(existingMove),
        state: clone(existingMove.snapshot ?? game.board.state),
        removedPieces: [],
        destroyedPieces: existingMove.destroyedPieces ?? [],
      };
    }
  }
  const activeTurn = getActiveTurn(game);
  if (!activeTurn) {
    return { ok: false as const, error: "turn_not_initialized" };
  }
  const stable = resolveToStability(game.board.state, { artifactMode: "full" });
  if (expectedState) {
    const expectedStable = resolveToStability(expectedState, { artifactMode: "full" });
    if (deterministicStateHash(expectedStable) !== deterministicStateHash(stable)) {
      return {
        ok: false as const,
        error: "stale_state",
        validation: { ok: false as const, code: "stale_state" },
        state: stable,
      };
    }
  }
  const validation = validateAction(stable, action, { retreatSemantics });
  if (!validation.ok) {
    return { ok: false as const, error: validation.code || "invalid_action", validation, state: stable };
  }
  if (action.type === "end_turn") return endServerTurn(game, clientCommandId ?? undefined);
  const moveIdForEffects = nextMoveId();
  const events: RemovalEvent[] = [];
  const onRemoval = (event: RemovalEvent) => events.push(event);
  const applied = applyAction(stable, action, { onRemoval, retreatSemantics });
  const next = resolveToStability(applied.state, { artifactMode: "full", onRemoval });
  const destroyedPieces = destructionRecords(events, clientCommandId ?? moveIdForEffects);
  next.sideToMove = getSideForSeat(getControlSeatForTurn(next, activeTurn.playerSeat));
  next.turnIndex = activeTurn.index;

  const move: MoveEntry = {
    moveId: moveIdForEffects,
    index: game.moves.length,
    turnIndex: activeTurn.index,
    turnMoveIndex: activeTurn.moveIndexes.length,
    displayMoveNumber: getNextDisplayMoveNumber(game),
    actorSide: stable.sideToMove,
    at: now(),
    notation: notation || defaultNotationForAction(action),
    action: clone(action),
    retreatSemantics,
    clientCommandId: clientCommandId ?? null,
    selectionSnapshot: stable,
    snapshot: clone(next),
    destroyedPieces,
  };
  game.moves.push(move);
  activeTurn.moveIndexes.push(move.index);
  activeTurn.lastMoveAt = move.at;
  game.pendingScenarioSelection = null;
  // Imported ancestry is the destination's immutable evidence, not a bounded
  // live-history cache. Keep it intact; the existing atomic storage bound
  // rejects an oversized write instead of silently rewriting the lineage.
  if (game.moves.length > MAX_HISTORY && !game.importedHistory) {
    game.moves.shift();
    renumberHistory(game);
  }
  game.board.state = next;
  game.initialSelectionAction = null;
  game.lastMoveAt = move.at;
  game.updatedAt = move.at;
  addNotification(game, `Move recorded in turn ${activeTurn.index + 1}`);
  let turnSettled = false;
  if (next.continuation == null) {
    const ended = settleServerTurn(game, clientCommandId ?? moveIdForEffects);
    if (ended.ok) events.push(...ended.removalEvents);
    if (!ended.ok) {
      return { ok: false as const, error: ended.error };
    }
    turnSettled = true;
  }
  move.snapshot = clone(game.board.state);
  move.destroyedPieces = destructionRecords(events, clientCommandId ?? moveIdForEffects);
  return { ok: true as const, move, state: clone(game.board.state), removedPieces: removalNotices(events, clientCommandId ?? moveIdForEffects), destroyedPieces: move.destroyedPieces, turnSettled };
};

export const applyServerMove = (game: LiveGame, notation?: string, clientCommandId?: string | null) => {
  const action = resolveServerMoveAction(game);
  if (!action) {
    return { ok: false as const, error: "no_legal_actions" };
  }
  return applyServerAction(game, action, notation, clientCommandId);
};

const settleServerTurn = (game: LiveGame, operationId = nextMoveId(), observedRemovals: RemovalEvent[] = []) => {
  const activeTurn = getActiveTurn(game);
  if (!activeTurn) {
    return { ok: false as const, error: "turn_not_initialized" };
  }
  const removalEvents: RemovalEvent[] = observedRemovals.map(event => clone(event));
  const endedAt = now();
  activeTurn.endedAt = endedAt;
  activeTurn.status = "complete";
  const { nextState, nextTurn } = finalizeResolvedTurn({
    state: game.board.state,
    activeTurn,
    endedAt,
    resolveToStability,
    onRemoval: (event) => removalEvents.push(event),
  });
  const lastMove = [...game.moves].reverse().find((move) => !isMoveUndone(move) && move.turnIndex === activeTurn.index);
  if (lastMove) {
    lastMove.snapshot = clone(nextState);
    lastMove.destroyedPieces = [...(lastMove.destroyedPieces ?? []), ...destructionRecords(removalEvents, operationId)];
  }
  game.turns.push(nextTurn);
  game.board.state = nextState;
  game.updatedAt = endedAt;
  addNotification(game, `Turn ${activeTurn.index + 1} ended. ${nextTurn.playerSeat} to play`);
  return { ok: true as const, turn: clone(nextTurn), removalEvents, removedPieces: removalNotices(removalEvents, operationId), destroyedPieces: destructionRecords(removalEvents, operationId) };
};

/** Explicit closure uses the same engine legality/transition as computer search. */
export const endServerTurn = (game: LiveGame, operationId = nextMoveId()) => {
  const activeTurn = getActiveTurn(game);
  if (!activeTurn || activeTurn.moveIndexes.length === 0 && !game.board.state.continuation) {
    return { ok: false as const, error: activeTurn ? "turn_has_no_moves" : "turn_not_initialized" };
  }
  const validation = validateAction(game.board.state, { type: "end_turn" });
  if (!validation.ok) return { ok: false as const, error: validation.code, validation };
  const removalEvents: RemovalEvent[] = [];
  game.board.state = applyAction(game.board.state, { type: "end_turn" }, {
    onRemoval: event => removalEvents.push(clone(event)),
  }).state;
  const ended = settleServerTurn(game, operationId, removalEvents);
  return ended.ok ? { ...ended, state: clone(game.board.state), turnSettled: true as const } : ended;
};

export const enumeratePieceActions = (state: GameState, pieceId: string): Action[] => {
  const piece = state.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) {
    return [];
  }
  const candidates: Action[] = [];
  const withTargets = ["move", "project", "rush", "push", "follow", "retreat"] as const;
  for (const type of withTargets) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const action: Action = {
          type,
          actorId: piece.id,
          from: { row: piece.position.row, col: piece.position.col },
          to: { row, col },
        };
        const validation = validateAction(state, action);
        if (validation.ok) {
          candidates.push(action);
        }
      }
    }
  }
  return candidates.sort(compareActions);
};

const compareActions = (left: Action, right: Action): number => {
  if (left.type !== right.type) {
    return left.type.localeCompare(right.type);
  }
  if (!left.to && !right.to) {
    return 0;
  }
  if (!left.to) {
    return -1;
  }
  if (!right.to) {
    return 1;
  }
  if (left.to.row !== right.to.row) {
    return left.to.row - right.to.row;
  }
  return left.to.col - right.to.col;
};

const compareActionPreviews = (left: PieceMovePreview, right: PieceMovePreview): number => {
  const actionOrder = compareActions(left, right);
  if (actionOrder !== 0) {
    return actionOrder;
  }
  if (left.legal !== right.legal) {
    return left.legal ? -1 : 1;
  }
  return (left.blockedReason ?? "").localeCompare(right.blockedReason ?? "");
};

export const enumeratePieceActionPreviews = (state: GameState, pieceId: string): PieceMovePreview[] => {
  const piece = state.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) {
    return [];
  }
  const previews: PieceMovePreview[] = [];
  const withTargets = ["move", "project", "rush", "push", "follow", "retreat"] as const;
  for (const type of withTargets) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const action: Action = {
          type,
          actorId: piece.id,
          from: { row: piece.position.row, col: piece.position.col },
          to: { row, col },
        };
        const validation = validateAction(state, action);
        if (validation.ok) {
          previews.push({ ...action, legal: true });
          continue;
        }
        if (
          validation.code === "SUPPLY_DESTINATION_UNSUPPLIED" ||
          validation.code === "PUSH_STRENGTH_TOO_WEAK"
        ) {
          previews.push({ ...action, legal: false, blockedReason: validation.code });
        }
      }
    }
  }
  return previews.sort(compareActionPreviews);
};
