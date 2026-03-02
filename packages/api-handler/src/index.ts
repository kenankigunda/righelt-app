import type { ClientCommand, ServerEvent } from "../../shared-types/src";
import { applyAction } from "../../game-engine/src/apply";
import { createInitialState } from "../../game-engine/src/state";
import { deterministicStateHash } from "../../game-engine/src/hash";
import { listLegalActions, validateAction } from "../../game-engine/src/legal";
import { resolveToStability } from "../../game-engine/src/resolve";
import type { Action, GameState } from "../../game-engine/src/types";
import { handleShellLiveRequest, handleShellLiveWebSocketUpgrade } from "./shell-live";

type D1RunResult = {
  success: boolean;
  meta?: {
    last_row_id?: number;
  };
};

type D1Statement = {
  bind: (...args: unknown[]) => D1Statement;
  run: () => Promise<D1RunResult>;
};

export type D1DatabaseLike = {
  prepare: (query: string) => D1Statement;
};

export type ApiEnv = {
  DB: D1DatabaseLike;
};

type RemovedPieceNotice = {
  pieceId: string;
  position: { row: number; col: number };
  reason: "loss_of_supply" | "no_retreat";
  message: string;
};

const CACHE_NO_STORE = "no-store";
const CACHE_BOOTSTRAP_SHORT = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

const json = (body: unknown, status = 200, cacheControl = CACHE_NO_STORE): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });

const jsonNoStore = (body: unknown, status = 200): Response => json(body, status, CACHE_NO_STORE);
const jsonBootstrap = (body: unknown, status = 200): Response => json(body, status, CACHE_BOOTSTRAP_SHORT);

const parseJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const asGameState = (value: unknown): GameState | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as GameState;
};

const asAction = (value: unknown): Action | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (typeof (value as Action).type !== "string") {
    return null;
  }
  return value as Action;
};

const BOARD_SIZE = 10;

const INITIAL_PLAYGROUND_STATE = resolveToStability(createInitialState(), { artifactMode: "full" });
const INITIAL_PLAYGROUND_LEGAL_ACTIONS = listLegalActions(INITIAL_PLAYGROUND_STATE);

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

type PieceMovePreview = Action & {
  legal: boolean;
  blockedReason?: "SUPPLY_DESTINATION_UNSUPPLIED";
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

const enumeratePieceActions = (state: GameState, pieceId: string): Action[] => {
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
          from: {
            row: piece.position.row,
            col: piece.position.col,
          },
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

const collectRemovedPieceNotices = (
  before: GameState,
  afterApply: GameState,
  afterStability: GameState,
): RemovedPieceNotice[] => {
  const afterApplyIds = new Set(afterApply.pieces.map((piece) => piece.id));
  const afterStableIds = new Set(afterStability.pieces.map((piece) => piece.id));
  const notices: RemovedPieceNotice[] = [];

  for (const piece of before.pieces) {
    if (!afterApplyIds.has(piece.id)) {
      notices.push({
        pieceId: piece.id,
        position: { ...piece.position },
        reason: "no_retreat",
        message: `Piece at (${piece.position.row}, ${piece.position.col}) destroyed because it could not retreat`,
      });
    }
  }

  for (const piece of afterApply.pieces) {
    if (!afterStableIds.has(piece.id)) {
      notices.push({
        pieceId: piece.id,
        position: { ...piece.position },
        reason: "loss_of_supply",
        message: `Piece at (${piece.position.row}, ${piece.position.col}) destroyed due to loss of supply`,
      });
    }
  }

  return notices.sort((left, right) => {
    if (left.position.row !== right.position.row) {
      return left.position.row - right.position.row;
    }
    if (left.position.col !== right.position.col) {
      return left.position.col - right.position.col;
    }
    return left.pieceId.localeCompare(right.pieceId);
  });
};

const enumeratePieceActionPreviews = (state: GameState, pieceId: string): PieceMovePreview[] => {
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
          from: {
            row: piece.position.row,
            col: piece.position.col,
          },
          to: { row, col },
        };

        const validation = validateAction(state, action);
        if (validation.ok) {
          previews.push({
            ...action,
            legal: true,
          });
          continue;
        }

        if (validation.code === "SUPPLY_DESTINATION_UNSUPPLIED") {
          previews.push({
            ...action,
            legal: false,
            blockedReason: "SUPPLY_DESTINATION_UNSUPPLIED",
          });
        }
      }
    }
  }

  return previews.sort(compareActionPreviews);
};

export const handleApiRequest = async (request: Request, env: ApiEnv): Promise<Response> => {
  const url = new URL(request.url);
  const websocketUpgrade = handleShellLiveWebSocketUpgrade(request);
  if (websocketUpgrade) {
    return websocketUpgrade;
  }
  const liveResponse = await handleShellLiveRequest(request);
  if (liveResponse?.handled) {
    return json(liveResponse.body, liveResponse.status, liveResponse.cacheControl);
  }

  if (request.method === "GET" && url.pathname === "/api/engine/playground/state") {
    return jsonBootstrap({
      ok: true,
      state: INITIAL_PLAYGROUND_STATE,
      legalActions: INITIAL_PLAYGROUND_LEGAL_ACTIONS,
    });
  }

  if (request.method === "POST" && url.pathname === "/api/engine/playground/legal") {
    const body = await parseJsonBody(request);
    const state = asGameState(body.state);
    if (!state) {
      return jsonNoStore({ ok: false, error: "invalid_state" }, 400);
    }

    const resolved = resolveToStability(state, { artifactMode: "full" });
    return json({
      ok: true,
      state: resolved,
      legalActions: listLegalActions(resolved),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/engine/playground/piece-moves") {
    const body = await parseJsonBody(request);
    const state = asGameState(body.state);
    const pieceId = typeof body.pieceId === "string" ? body.pieceId : null;

    if (!state) {
      return jsonNoStore({ ok: false, error: "invalid_state" }, 400);
    }
    if (!pieceId) {
      return jsonNoStore({ ok: false, error: "invalid_piece_id" }, 400);
    }

    const resolved = resolveToStability(state, { artifactMode: "full" });
    return json({
      ok: true,
      state: resolved,
      pieceId,
      actions: enumeratePieceActions(resolved, pieceId),
      previewActions: enumeratePieceActionPreviews(resolved, pieceId),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/engine/playground/apply") {
    const body = await parseJsonBody(request);
    const state = asGameState(body.state);
    const action = asAction(body.action);
    if (!state) {
      return jsonNoStore({ ok: false, error: "invalid_state" }, 400);
    }
    if (!action) {
      return jsonNoStore({ ok: false, error: "invalid_action" }, 400);
    }

    const resolved = resolveToStability(state, { artifactMode: "full" });
    const validation = validateAction(resolved, action);
    if (!validation.ok) {
      return json({
        ok: true,
        accepted: false,
        validation,
        state: resolved,
        legalActions: listLegalActions(resolved),
      });
    }

    try {
      const result = applyAction(resolved, action);
      const stabilized = resolveToStability(result.state, { artifactMode: "full" });
      const removedPieces = collectRemovedPieceNotices(resolved, result.state, stabilized);
      return json({
        ok: true,
        accepted: true,
        validation,
        state: stabilized,
        outcome: stabilized.outcome,
        legalActions: listLegalActions(stabilized),
        removedPieces,
      });
    } catch (error) {
      return jsonNoStore(
        {
          ok: false,
          error: "apply_failed",
          message: error instanceof Error ? error.message : "Unknown applyAction error",
        },
        501,
      );
    }
  }

  if (request.method === "POST" && url.pathname === "/api/engine/playground/hash") {
    const body = await parseJsonBody(request);
    const state = asGameState(body.state);
    if (!state) {
      return jsonNoStore({ ok: false, error: "invalid_state" }, 400);
    }

    return json({
      ok: true,
      hash: deterministicStateHash(state),
      outcome: state.outcome,
    });
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return jsonNoStore({ ok: true, service: "righelt" });
  }

  if (request.method === "POST" && url.pathname === "/api/test-action") {
    try {
      const payload = await parseJsonBody(request);
      const message =
        typeof payload.message === "string" && payload.message.trim().length > 0
          ? payload.message.trim()
          : "Button clicked from web client";

      const insert = await env.DB.prepare("INSERT INTO milestone_actions (message) VALUES (?1)")
        .bind(message)
        .run();

      if (!insert.success) {
        return jsonNoStore({ ok: false, error: "insert_failed" }, 500);
      }

      const actionId = insert.meta?.last_row_id ?? null;
      const createdAt = new Date().toISOString();
      const event: ServerEvent = {
        type: "test_action_recorded",
        gameId: null,
        at: createdAt,
        payload: { actionId, message }
      };

      return jsonNoStore({ ok: true, actionId, createdAt, event });
    } catch {
      return jsonNoStore({ ok: false, error: "insert_failed" }, 500);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/commands/validate") {
    const body = await parseJsonBody(request);
    const command = body.command as ClientCommand | undefined;

    if (!command || typeof command.type !== "string") {
      return jsonNoStore({ ok: false, error: "invalid_command" }, 400);
    }

    return jsonNoStore({ ok: true, accepted: true, commandType: command.type });
  }

  return jsonNoStore({ ok: false, error: "not_found" }, 404);
};
