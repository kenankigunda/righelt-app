import type { ClientCommand, ServerEvent } from "../../shared-types/src";
import {
  applyAction,
  createInitialState,
  deterministicStateHash,
  listLegalActions,
  validateAction,
} from "../../game-engine/src";
import type { Action, GameState } from "../../game-engine/src";

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

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });

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

export const handleApiRequest = async (request: Request, env: ApiEnv): Promise<Response> => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/engine/playground/state") {
    const state = createInitialState();
    return json({
      ok: true,
      state,
      legalActions: listLegalActions(state),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/engine/playground/legal") {
    const body = await parseJsonBody(request);
    const state = asGameState(body.state);
    if (!state) {
      return json({ ok: false, error: "invalid_state" }, 400);
    }

    return json({
      ok: true,
      legalActions: listLegalActions(state),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/engine/playground/apply") {
    const body = await parseJsonBody(request);
    const state = asGameState(body.state);
    const action = asAction(body.action);
    if (!state) {
      return json({ ok: false, error: "invalid_state" }, 400);
    }
    if (!action) {
      return json({ ok: false, error: "invalid_action" }, 400);
    }

    const validation = validateAction(state, action);
    if (!validation.ok) {
      return json({
        ok: true,
        accepted: false,
        validation,
        state,
        legalActions: listLegalActions(state),
      });
    }

    try {
      const result = applyAction(state, action);
      return json({
        ok: true,
        accepted: true,
        validation,
        state: result.state,
        outcome: result.outcome,
        legalActions: listLegalActions(result.state),
      });
    } catch (error) {
      return json(
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
      return json({ ok: false, error: "invalid_state" }, 400);
    }

    return json({
      ok: true,
      hash: deterministicStateHash(state),
      outcome: state.outcome,
    });
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({ ok: true, service: "righelt" });
  }

  if (request.method === "POST" && url.pathname === "/api/test-action") {
    const payload = await parseJsonBody(request);
    const message =
      typeof payload.message === "string" && payload.message.trim().length > 0
        ? payload.message.trim()
        : "Button clicked from web client";

    const insert = await env.DB.prepare("INSERT INTO milestone_actions (message) VALUES (?1)")
      .bind(message)
      .run();

    if (!insert.success) {
      return json({ ok: false, error: "insert_failed" }, 500);
    }

    const actionId = insert.meta?.last_row_id ?? null;
    const createdAt = new Date().toISOString();
    const event: ServerEvent = {
      type: "test_action_recorded",
      gameId: null,
      at: createdAt,
      payload: { actionId, message }
    };

    return json({ ok: true, actionId, createdAt, event });
  }

  if (request.method === "POST" && url.pathname === "/api/commands/validate") {
    const body = await parseJsonBody(request);
    const command = body.command as ClientCommand | undefined;

    if (!command || typeof command.type !== "string") {
      return json({ ok: false, error: "invalid_command" }, 400);
    }

    return json({ ok: true, accepted: true, commandType: command.type });
  }

  return json({ ok: false, error: "not_found" }, 404);
};
