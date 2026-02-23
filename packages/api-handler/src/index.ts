import type { ClientCommand, ServerEvent } from "../../shared-types/src";

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

export const handleApiRequest = async (request: Request, env: ApiEnv): Promise<Response> => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({ ok: true, service: "righelt-api" });
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

