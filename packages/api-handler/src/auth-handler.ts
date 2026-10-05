import passwords from "../../shared-types/data/common-passwords.json";
import {
  normalizeUsername,
  validateAccountPatch,
  normalizePassword,
  normalizeDisplayName,
  isPasswordAllowed,
  SESSION_CONTEXT_HEADER,
  SESSION_IDLE_MS,
  SCRYPT_PARAMETERS,
  type SessionState,
  type HashInput,
  type HashOutput,
} from "../../shared-types/src/auth";
import {
  type AuthDatabase,
  type AuthStatement,
  type AccountRow,
  credentialGuard,
  sessionGuard,
  clearTransactionGuard,
  primaryAuthDatabase,
} from "./auth-db";
import {
  randomToken,
  tokenHash,
  authCookie,
  clearAuthCookie,
  readAuthCookie,
} from "./auth-security";
import {
  DB_NOW,
  AuthProblem,
  authBody,
  exactKeys,
  admitAuthAttempt,
  markAuthFailure,
  validateChallenge,
  type AuthControlsEnv,
} from "./auth-controls";
export type AuthEnv = AuthControlsEnv & {
  DB: AuthDatabase;
  AUTH_ENABLED?: string;
  HASH_SERVICE?: {
    fetch(request: Request): Promise<Response>;
  };
};
type Actor = AccountRow & {
  token_hash: string;
  context_id: string;
  expires_at: number;
  issued_epoch: number;
  read_at: number;
};
const blocklist = new Set(
  passwords.map((password) => password.normalize("NFC")),
);
const dummyHash =
  "scrypt$1$16384$8$5$630a4f72d23997af3c66cc8c1fb152aa$65605f9702e509269b52200f5b582274c4a49007be34a2d221bc072bfb8ca1ee";
const actorSelect = `SELECT a.*,s.token_hash,s.context_id,s.expires_at,s.session_epoch AS issued_epoch,${DB_NOW} AS read_at FROM account_sessions s JOIN accounts a ON a.account_id=s.account_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>${DB_NOW} AND s.session_epoch=a.session_epoch`;
const versions = (account: AccountRow) => ({
  accountId: account.account_id,
  credentialVersion: account.credential_version,
  sessionEpoch: account.session_epoch,
});
const json = (body: unknown, status = 200, cookies: string[] = []) => {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return Response.json(body, { status, headers });
};
function sessionState(actor: Actor | null): SessionState {
  if (!actor) return { authenticated: false };
  return {
    authenticated: true,
    account: {
      id: actor.account_id,
      username: actor.username,
      displayName: actor.display_name,
      joinedMonth: new Date(actor.created_at).toISOString().slice(0, 7),
      preferences: {
        tutorial: actor.tutorial_state,
        view: actor.view_preference,
      },
    },
    contextId: actor.context_id,
    expiresAt: actor.expires_at,
  };
}
export async function authenticatedActor(
  request: Request,
  env: AuthEnv,
): Promise<Actor | null> {
  if (env.AUTH_ENABLED !== "true") return null;
  const token = readAuthCookie(request);
  return token
    ? primaryAuthDatabase(env.DB)
        .prepare(actorSelect)
        .bind(await tokenHash(token))
        .first<Actor>()
    : null;
}
function requireActor(actor: Actor | null): Actor {
  if (!actor) throw new AuthProblem("invalid_credentials", 401);
  return actor;
}
function passwordValue(
  value: unknown,
  username: string,
  newPassword: boolean,
): string {
  const parsed = normalizePassword(value);
  if (
    !parsed.ok ||
    (newPassword && !isPasswordAllowed(parsed.value, username, blocklist))
  )
    throw new AuthProblem("invalid_input");
  return parsed.value;
}
async function hashCall(env: AuthEnv, input: HashInput): Promise<HashOutput> {
  try {
    const response = await env.HASH_SERVICE!.fetch(
      new Request("https://auth.internal/hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    if (!response.ok)
      throw new AuthProblem(
        "temporarily_unavailable",
        503,
        response.status === 429 ? 1 : undefined,
      );
    const result = (await response.json()) as HashOutput;
    if (
      input.operation === "hash" &&
      "encoded" in result &&
      result.encoded.startsWith(
        `scrypt$1$${SCRYPT_PARAMETERS.N}$${SCRYPT_PARAMETERS.r}$${SCRYPT_PARAMETERS.p}$`,
      ) &&
      result.encoded.split("$").length === 7 &&
      /\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(result.encoded)
    )
      return result;
    if (
      input.operation === "verify" &&
      "verified" in result &&
      typeof result.verified === "boolean"
    )
      return result;
    throw new Error();
  } catch (error) {
    if (error instanceof AuthProblem) throw error;
    throw new AuthProblem("temporarily_unavailable", 503);
  }
}
async function encodePassword(env: AuthEnv, password: string): Promise<string> {
  return (
    (await hashCall(env, { operation: "hash", password })) as {
      encoded: string;
    }
  ).encoded;
}
async function verifyPassword(
  env: AuthEnv,
  password: string,
  encoded: string,
): Promise<boolean> {
  return (
    (await hashCall(env, { operation: "verify", password, encoded })) as {
      verified: boolean;
    }
  ).verified;
}
function addSession(
  db: AuthDatabase,
  hash: string,
  accountId: string,
  epoch: number,
  contextId: string,
): AuthStatement {
  return db
    .prepare(
      `INSERT INTO account_sessions(token_hash,account_id,session_epoch,context_id,created_at,last_activity_at,expires_at) VALUES(?,?,?,?,${DB_NOW},${DB_NOW},${DB_NOW}+?)`,
    )
    .bind(hash, accountId, epoch, contextId, SESSION_IDLE_MS);
}
function renewal(db: AuthDatabase, hash: string): AuthStatement {
  return db
    .prepare(
      `UPDATE account_sessions SET last_activity_at=${DB_NOW},expires_at=${DB_NOW}+? WHERE token_hash=?`,
    )
    .bind(SESSION_IDLE_MS, hash);
}
function revoke(
  db: AuthDatabase,
  where: string,
  values: unknown[],
): AuthStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO account_revocation_outbox(notification_id,session_hash,room_id,created_at) SELECT lower(hex(randomblob(16))),s.token_hash,r.room_id,${DB_NOW} FROM account_sessions s JOIN account_session_rooms r ON r.session_hash=s.token_hash WHERE ${where} AND s.revoked_at IS NULL`,
      )
      .bind(...values),
    db
      .prepare(
        `UPDATE account_sessions AS s SET revoked_at=${DB_NOW} WHERE ${where} AND s.revoked_at IS NULL`,
      )
      .bind(...values),
  ];
}
async function guarded(
  db: AuthDatabase,
  guards: AuthStatement[],
  writes: AuthStatement[],
  ids: string[],
): Promise<void> {
  try {
    await db.batch([
      ...guards,
      ...writes,
      ...ids.map((id) => clearTransactionGuard(db, id)),
    ]);
  } catch (error) {
    if (
      /CHECK constraint failed|UNIQUE constraint failed: account_transaction_guards/.test(
        String(error),
      )
    )
      throw new AuthProblem("stale_operation", 409);
    throw error;
  }
}
async function sessionResponse(
  db: AuthDatabase,
  token: string,
  extra: Record<string, unknown> = {},
  cookies: string[] = [],
): Promise<Response> {
  const actor = await db
    .prepare(actorSelect)
    .bind(await tokenHash(token))
    .first<Actor>();
  if (!actor) throw new AuthProblem("stale_operation", 409);
  return json({ ok: true, ...sessionState(actor), ...extra }, 200, [
    authCookie(
      token,
      Math.max(0, Math.floor((actor.expires_at - actor.read_at) / 1000)),
    ),
    ...cookies,
  ]);
}
export async function handleAuthRequest(
  request: Request,
  rawEnv: AuthEnv,
  services: {
    turnstileFetch?: typeof fetch;
  } = {},
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (
    !path.startsWith("/api/auth/") &&
    path !== "/api/account" &&
    !path.startsWith("/api/profiles/")
  )
    return null;
  try {
    const env = rawEnv,
      db = primaryAuthDatabase(env.DB);
    if (request.method === "GET" && path.startsWith("/api/profiles/")) {
      const name = normalizeUsername(
        decodeURIComponent(path.slice("/api/profiles/".length)),
      );
      if (!name.ok) throw new AuthProblem("invalid_input");
      const profile = await db
        .prepare(
          "SELECT username,display_name,created_at FROM accounts WHERE username_canonical=?",
        )
        .bind(name.value.canonical)
        .first<{
          username: string;
          display_name: string;
          created_at: number;
        }>();
      return profile
        ? json({
            username: profile.username,
            displayName: profile.display_name,
            joinedMonth: new Date(profile.created_at).toISOString().slice(0, 7),
          })
        : json({ ok: false, error: "not_found" }, 404);
    }
    if (rawEnv.AUTH_ENABLED !== "true")
      throw new AuthProblem("temporarily_unavailable", 503);
    if (
      !rawEnv.HASH_SERVICE ||
      !/^[a-f0-9]{64}$/.test(rawEnv.AUTH_HMAC_SECRET ?? "") ||
      !rawEnv.AUTH_ALLOWED_ORIGINS
    )
      throw new AuthProblem("temporarily_unavailable", 503);
    if (request.method === "GET" && path === "/api/auth/session")
      return json({
        ok: true,
        ...sessionState(await authenticatedActor(request, env)),
      });
    if (request.method !== (path === "/api/account" ? "PATCH" : "POST"))
      throw new AuthProblem("invalid_input", 405);
    const body = await authBody(request, env);
    const actor = await authenticatedActor(request, env);
    if (
      actor &&
      request.headers.get(SESSION_CONTEXT_HEADER) !== actor.context_id
    )
      throw new AuthProblem("session_changed", 409);
    if (path === "/api/account") {
      const current = requireActor(actor),
        parsed = validateAccountPatch(body, current.username);
      if (!parsed.ok) throw new AuthProblem("invalid_input");
      const patch = parsed.value,
        id = randomToken();
      await guarded(
        db,
        [sessionGuard(db, id, current.token_hash, current.context_id)],
        [
          db
            .prepare(
              "UPDATE accounts SET display_name=COALESCE(?,display_name),view_preference=COALESCE(?,view_preference),tutorial_state=CASE WHEN tutorial_state='completed' THEN tutorial_state ELSE COALESCE(?,tutorial_state) END WHERE account_id=?",
            )
            .bind(
              patch.displayName ?? null,
              patch.preferences?.view ?? null,
              patch.preferences?.tutorial ?? null,
              current.account_id,
            ),
          renewal(db, current.token_hash),
        ],
        [id],
      );
      return await sessionResponse(db, readAuthCookie(request)!);
    }
    const attempt = async (
      kind: "register" | "login" | "change" | "username",
      identity: string,
    ) => {
      const rate = await admitAuthAttempt(db, env, request, kind, identity);
      if (rate.challenge)
        await validateChallenge(
          request,
          env,
          kind,
          body.challengeToken,
          services.turnstileFetch,
        );
      return rate;
    };
    if (path === "/api/auth/username") {
      exactKeys(body, ["username"]);
      const name = normalizeUsername(body.username);
      if (!name.ok) throw new AuthProblem("invalid_input");
      await attempt("username", "");
      const found = await db
        .prepare("SELECT 1 AS found FROM accounts WHERE username_canonical=?")
        .bind(name.value.canonical)
        .first();
      return json({ ok: true, exists: Boolean(found) });
    }
    if (path === "/api/auth/register") {
      exactKeys(
        body,
        ["username", "password"],
        ["displayName", "challengeToken"],
      );
      const name = normalizeUsername(body.username);
      if (!name.ok) throw new AuthProblem("invalid_input");
      const display = normalizeDisplayName(
        body.displayName,
        name.value.username,
      );
      if (!display.ok) throw new AuthProblem("invalid_input");
      const password = passwordValue(body.password, name.value.canonical, true);
      await attempt("register", name.value.canonical);
      const encoded = await encodePassword(env, password),
        accountId = crypto.randomUUID(),
        token = randomToken(),
        hash = await tokenHash(token);
      const transitionId = actor ? randomToken() : null;
      try {
        await db.batch([
          ...(actor
            ? [
                sessionGuard(
                  db,
                  transitionId!,
                  actor.token_hash,
                  actor.context_id,
                ),
              ]
            : []),
          db
            .prepare(
              `INSERT INTO accounts(account_id,username,username_canonical,display_name,created_at,password_hash) VALUES(?,?,?,?,${DB_NOW},?)`,
            )
            .bind(
              accountId,
              name.value.username,
              name.value.canonical,
              display.value,
              encoded,
            ),
          addSession(db, hash, accountId, 1, randomToken()),
          ...(actor
            ? [
                ...revoke(db, "s.token_hash=?", [actor.token_hash]),
                clearTransactionGuard(db, transitionId!),
              ]
            : []),
        ]);
      } catch (error) {
        if (
          /UNIQUE constraint failed: accounts.username_canonical/.test(
            String(error),
          )
        )
          throw new AuthProblem("username_unavailable", 409);
        if (/CHECK constraint failed/.test(String(error)))
          throw new AuthProblem("stale_operation", 409);
        throw error;
      }
      return await sessionResponse(db, token);
    }
    if (path === "/api/auth/login") {
      exactKeys(body, ["username", "password"], ["challengeToken"]);
      const name = normalizeUsername(body.username);
      if (!name.ok) throw new AuthProblem("invalid_input");
      const password = passwordValue(
          body.password,
          name.value.canonical,
          false,
        ),
        rate = await attempt("login", name.value.canonical);
      const account = await db
        .prepare("SELECT * FROM accounts WHERE username_canonical=?")
        .bind(name.value.canonical)
        .first<AccountRow>();
      const verified = await verifyPassword(
        env,
        password,
        account?.password_hash ?? dummyHash,
      );
      if (!account || !verified) {
        await markAuthFailure(db, rate.failureKey);
        throw new AuthProblem("invalid_credentials", 401);
      }
      const id = randomToken(),
        token = randomToken();
      const transitionId = actor ? randomToken() : null;
      await guarded(
        db,
        [
          credentialGuard(db, id, versions(account)),
          ...(actor
            ? [
                sessionGuard(
                  db,
                  transitionId!,
                  actor.token_hash,
                  actor.context_id,
                ),
              ]
            : []),
        ],
        [
          ...(actor ? revoke(db, "s.token_hash=?", [actor.token_hash]) : []),
          addSession(
            db,
            await tokenHash(token),
            account.account_id,
            account.session_epoch,
            randomToken(),
          ),
        ],
        [id, ...(transitionId ? [transitionId] : [])],
      );
      return await sessionResponse(db, token);
    }
    if (path === "/api/auth/logout") {
      exactKeys(body, []);
      const token = readAuthCookie(request);
      if (token)
        await db.batch(revoke(db, "s.token_hash=?", [await tokenHash(token)]));
      return json({ ok: true, authenticated: false }, 200, [clearAuthCookie()]);
    }

    if (path === "/api/auth/activity") {
      exactKeys(body, []);
      const current = requireActor(actor),
        id = randomToken();
      await guarded(
        db,
        [sessionGuard(db, id, current.token_hash, current.context_id)],
        [renewal(db, current.token_hash)],
        [id],
      );
      return await sessionResponse(db, readAuthCookie(request)!);
    }
    if (path === "/api/auth/password") {
      exactKeys(body, ["newPassword"]);
      const current = requireActor(actor);
      // Account-scoped before hashing: session rotation and other browsers share the budget.
      await attempt("change", current.account_id);
      const next = passwordValue(
        body.newPassword,
        current.username_canonical,
        true,
      );
      const encoded = await encodePassword(env, next),
        token = randomToken(),
        ids = [randomToken(), randomToken()];
      await guarded(
        db,
        [
          credentialGuard(db, ids[0], versions(current)),
          sessionGuard(db, ids[1], current.token_hash, current.context_id),
        ],
        [
          db
            .prepare(
              "UPDATE accounts SET password_hash=?,credential_version=credential_version+1,session_epoch=session_epoch+1 WHERE account_id=?",
            )
            .bind(encoded, current.account_id),
          ...revoke(db, "s.account_id=?", [current.account_id]),
          addSession(
            db,
            await tokenHash(token),
            current.account_id,
            current.session_epoch + 1,
            randomToken(),
          ),
        ],
        ids,
      );
      return await sessionResponse(db, token);
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (error) {
    const problem =
      error instanceof AuthProblem
        ? error
        : new AuthProblem("temporarily_unavailable", 503);
    const response = json(
      {
        ok: false,
        error: problem.code,
        ...(problem.challengeRequired ? { challengeRequired: true } : {}),
      },
      problem.status,
    );
    if (problem.retryAfter)
      response.headers.set("Retry-After", String(problem.retryAfter));
    return response;
  }
}
