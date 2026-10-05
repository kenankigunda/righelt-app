import { maintenanceAllowed, type CutoverPolicy } from './account-cutover';
import {
  AUTH_PROTOCOL_VERSION,
  AUTH_PROTOCOL_HEADER,
  SESSION_CONTEXT_HEADER,
  AUTH_REQUEST_HEADER,
  SESSION_IDLE_MS,
} from "../../shared-types/src/auth-policy.js";
import { authenticatedActor, type AuthEnv } from "./auth-handler";
import { allowedOrigin, AuthProblem } from "./auth-controls";
import {
  primaryAuthDatabase,
  sessionGuard,
  clearTransactionGuard,
  DB_NOW,
  type AuthDatabase,
  type AuthStatement,
} from "./auth-db";
import { randomToken } from "./auth-security";
import { readSyncBody, SyncBodyError } from "./sync-body";
export type GameAuthority = {
  accountId: string;
  tokenHash: string;
  contextId: string;
  renew: boolean;
};
export type GameAuthEnv = {
  AUTH_ENABLED?: string;
  AUTH_REQUIRED?: string;
  ACCOUNT_POLICY?: CutoverPolicy;
  AUTH_ALLOWED_ORIGINS?: string;
  DB: unknown;
};
export const authActive = (env: GameAuthEnv) => env.AUTH_REQUIRED === "true" || env.AUTH_ENABLED === "true";
export const authDatabase = (env: GameAuthEnv) =>
  primaryAuthDatabase(env.DB as AuthDatabase);
export async function readGameAuthority(
  request: Request,
  env: GameAuthEnv,
): Promise<GameAuthority | null> {
  const actor = await authenticatedActor(request, env as AuthEnv);
  return actor
    ? {
        accountId: actor.account_id,
        tokenHash: actor.token_hash,
        contextId: actor.context_id,
        renew: false,
      }
    : null;
}
export async function currentGameAuthority(
  env: GameAuthEnv,
  authority: GameAuthority,
): Promise<boolean> {
  if (env.AUTH_ENABLED !== "true") return false;
  const found = await authDatabase(env)
    .prepare(
      `SELECT 1 AS valid FROM account_sessions s JOIN accounts a ON a.account_id=s.account_id WHERE s.token_hash=? AND s.context_id=? AND s.account_id=? AND s.revoked_at IS NULL AND s.expires_at>${DB_NOW} AND s.session_epoch=a.session_epoch`,
    )
    .bind(authority.tokenHash, authority.contextId, authority.accountId)
    .first<{ valid: number }>();
  return Boolean(found);
}
export async function authorizeGameRequest(
  request: Request,
  env: GameAuthEnv,
  websocket = false,
): Promise<{ request: Request; authority: GameAuthority | null }> {
  if (!authActive(env)) return { request, authority: null };
  if (request.method !== "GET" && env.AUTH_ENABLED !== "true") throw new AuthProblem("temporarily_unavailable",503);
  const cleanHeaders = new Headers(request.headers);
  for (const name of [...cleanHeaders.keys()])
    if (name.toLowerCase().startsWith("x-righelt-internal-"))
      cleanHeaders.delete(name);
  request = new Request(request, { headers: cleanHeaders });
  const url = new URL(request.url),
    authority = await readGameAuthority(request, env);
  if (websocket) {
    allowedOrigin(request, env);
    if (
      url.searchParams.get("authProtocolVersion") !==
      String(AUTH_PROTOCOL_VERSION)
    )
      throw new AuthProblem("upgrade_required", 426);
    const context = url.searchParams.get("sessionContext") ?? "";
    if (context !== (authority?.contextId ?? ""))
      throw new AuthProblem("session_changed", 409);
  } else if (request.method !== "GET") {
    allowedOrigin(request, env);
    if (
      request.headers.get(AUTH_PROTOCOL_HEADER) !==
      String(AUTH_PROTOCOL_VERSION)
    )
      throw new AuthProblem("upgrade_required", 426);
    if (
      request.headers.get(AUTH_REQUEST_HEADER) !== "1" ||
      request.headers
        .get("Content-Type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      throw new AuthProblem("invalid_input", 403);
    if (!authority) throw new AuthProblem("invalid_credentials", 401);
    if (!maintenanceAllowed(env,authority.accountId)) throw new AuthProblem("temporarily_unavailable",503);
    if (request.headers.get(SESSION_CONTEXT_HEADER) !== authority.contextId)
      throw new AuthProblem("session_changed", 409);
    // Same bounded reader as T-114, before dispatch; never trust an identity field.
    const body = await readSyncBody(request);
    if (
      body.identityId !== undefined &&
      body.identityId !== authority.accountId
    )
      throw new AuthProblem("identity_mismatch", 403);
    if (
      Array.isArray(body.commands) &&
      body.commands.some(
        (command) =>
          !command ||
          typeof command !== "object" ||
          (command as Record<string, unknown>).identityId !==
            authority.accountId,
      )
    )
      throw new AuthProblem("identity_mismatch", 403);
    const operation = url.pathname.split("/").at(-1);
    authority.renew = !["presence", "reconcile"].includes(operation ?? "");
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    return {
      request: new Request(url, {
        method: request.method,
        headers,
        body: JSON.stringify({ ...body, identityId: authority.accountId }),
      }),
      authority,
    };
  }
  // Public reads ignore identity supplied in the URL. Empty identity cannot own a seat.
  url.searchParams.set("identityId", authority?.accountId ?? "");
  return { request: new Request(url, request), authority };
}
export function gameGuardStatements(
  env: GameAuthEnv,
  authority: GameAuthority,
): AuthStatement[] {
  const db = authDatabase(env),
    id = randomToken();
  return [
    sessionGuard(db, id, authority.tokenHash, authority.contextId),
    ...(authority.renew
      ? [
          db
            .prepare(
              `UPDATE account_sessions SET last_activity_at=${DB_NOW},expires_at=${DB_NOW}+? WHERE token_hash=?`,
            )
            .bind(SESSION_IDLE_MS, authority.tokenHash),
        ]
      : []),
    clearTransactionGuard(db, id),
  ];
}
export async function registerSessionRoom(
  env: GameAuthEnv,
  authority: GameAuthority,
  roomId: string,
): Promise<void> {
  const db = authDatabase(env),
    id = randomToken();
  await db.batch([
    sessionGuard(db, id, authority.tokenHash, authority.contextId),
    db
      .prepare(
        "INSERT OR IGNORE INTO account_session_rooms(session_hash,room_id) VALUES(?,?)",
      )
      .bind(authority.tokenHash, roomId),
    clearTransactionGuard(db, id),
  ]);
}
export const authErrorResponse = (error: unknown): Response => {
  const problem =
    error instanceof AuthProblem
      ? error
      : error instanceof SyncBodyError
        ? new AuthProblem(error.message, error.status)
        : new AuthProblem("temporarily_unavailable", 503);
  return Response.json(
    {
      ok: false,
      error: problem.code,
      authProtocolVersion: AUTH_PROTOCOL_VERSION,
    },
    { status: problem.status, headers: { "Cache-Control": "no-store" } },
  );
};
export async function deliverRevocations(
  env: GameAuthEnv & {
    GAME_ROOMS?: {
      idFromName(id: string): unknown;
      get(id: unknown): { fetch(request: Request): Promise<Response> };
    };
  },
): Promise<void> {
  if (!authActive(env) || !env.GAME_ROOMS) return;
  const db = authDatabase(env),
    rows = await db
      .prepare(
        "SELECT notification_id,room_id FROM account_revocation_outbox WHERE delivered_at IS NULL ORDER BY created_at LIMIT 100",
      )
      .all<{ notification_id: string; room_id: string }>();
  for (const roomId of new Set(
    (rows.results ?? []).map((row) => row.room_id),
  )) {
    try {
      const response = await env.GAME_ROOMS.get(
        env.GAME_ROOMS.idFromName(roomId),
      ).fetch(
        new Request("https://game-room/auth-recheck", {
          method: "POST",
          headers: { "x-game-id": roomId },
        }),
      );
      if (response.ok)
        await db.batch(
          (rows.results ?? [])
            .filter((row) => row.room_id === roomId)
            .map((row) =>
              db
                .prepare(
                  `UPDATE account_revocation_outbox SET delivered_at=${DB_NOW} WHERE notification_id=?`,
                )
                .bind(row.notification_id),
            ),
        );
    } catch {
      /* A future delivery retries. Every send independently checks live authority. */
    }
  }
}

// Raw boards are projected for the session actor; already authorized projections
// retain their selected history. Raw invitation credentials stay private.
export function sanitizeGameView(
  value: Record<string, unknown>,
  authority: GameAuthority | null,
  readOnly = false,
): Record<string, unknown> {
  const game = value as unknown as import("./shell-live-core").LiveGame;
  const legacy = game.ownershipMode !== "account_v1";
  const identity = !legacy && authority ? authority.accountId : "";
  const projected =
    !legacy && authority && Array.isArray(value.myRoles)
      ? structuredClone(value)
      : (withFullViewModel(game, identity) as Record<string, unknown>);
  if (
    !value.inviteTokens &&
    typeof value.inviteToken === "string" &&
    authority &&
    !legacy
  )
    projected.inviteToken = value.inviteToken;
  delete projected.inviteTokens;
  const player =
    projected.myRole === "Player 1" || projected.myRole === "Player 2";
  const requests = Array.isArray(projected.pendingJoinRequests)
    ? (projected.pendingJoinRequests as Array<{ identityId: string }>)
    : [];
  const approvable = Array.isArray(projected.approvableRequesterIds)
    ? projected.approvableRequesterIds
    : [];
  projected.pendingJoinRequests = requests.filter(
    (item) =>
      item.identityId === identity || approvable.includes(item.identityId),
  );
  if (!projected.myPendingRevertRequest && !projected.approvableRevertRequest)
    projected.pendingRevertRequest = null;
  if (!authority || readOnly || legacy) {
    for (const key of [
      "canInvite",
      "canRecordMove",
      "canEndTurn",
      "canPlayAsBothPlayers",
      "canUndoLastMove",
    ])
      projected[key] = false;
    projected.inviteToken = null;
    projected.canJoinAsPlayer = !legacy && projected.canJoinAsPlayer;
    projected.canJoinAsViewer = false;
  }
  if (!authority || readOnly) projected.legalActions = [];
  if (!player) projected.approvableRequesterIds = [];
  projected.ownershipMode = legacy ? "legacy_guest" : "account_v1";
  return projected;
}
import { withFullViewModel } from "./shell-live-core";
export function sanitizeGameResponse(
  body: Record<string, unknown>,
  authority: GameAuthority | null,
  readOnly = false,
): Record<string, unknown> {
  const result = { ...body };
  if (result.game && typeof result.game === "object")
    result.game = sanitizeGameView(
      result.game as Record<string, unknown>,
      authority,
      readOnly,
    );
  const receipt = result.commandOutcome as { identityId?: string } | undefined;
  if (receipt?.identityId !== authority?.accountId) {
    delete result.commandOutcome;
    delete result.clientCommandId;
  }
  if (Array.isArray(result.commandOutcomes))
    result.commandOutcomes = result.commandOutcomes.filter(
      (item) => item?.identityId === authority?.accountId,
    );
  return result;
}
