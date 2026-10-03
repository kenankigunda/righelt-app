import passwords from "../../shared-types/data/common-passwords.json";
import {
  normalizeUsername,
  validateAccountPatch,
  normalizePassword,
  normalizeDisplayName,
  isPasswordAllowed,
  SESSION_CONTEXT_HEADER,
  SESSION_IDLE_MS,
  FLOW_TTL_MS,
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
  createRecoveryCode,
  normalizeRecoveryCode,
  authCookie,
  clearAuthCookie,
  readAuthCookie,
  recoverySessionToken,
  recoveryOperationContext,
  equalTokenDigests,
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
type Operation = {
  flow_hash: string;
  account_id: string;
  kind: "recovery" | "recovery_code";
  credential_version: number;
  recovery_version: number;
  session_epoch: number;
  initiating_session_hash: string | null;
  password_hash: string | null;
  replacement_recovery_hash: string;
  expires_at: number;
  completed_at: number | null;
  issued_session_hash: string | null;
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
  recoveryVersion: account.recovery_version,
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
    recoveryAcknowledgmentRequired: actor.recovery_acknowledged !== 1,
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
async function retireBrowserFlow(
  db: AuthDatabase,
  request: Request,
): Promise<AuthStatement[]> {
  const token = readAuthCookie(request, "flow");
  if (!token) return [];
  const hash = await tokenHash(token);
  return [
    ...revoke(
      db,
      "s.token_hash IN (SELECT issued_session_hash FROM account_operations WHERE flow_hash=?)",
      [hash],
    ),
    db.prepare("DELETE FROM account_operations WHERE flow_hash=?").bind(hash),
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
      "session",
      Math.max(0, Math.floor((actor.expires_at - actor.read_at) / 1000)),
    ),
    ...cookies,
  ]);
}
function operationGuard(
  db: AuthDatabase,
  id: string,
  flowHash: string,
): AuthStatement {
  return db
    .prepare(
      `INSERT INTO account_transaction_guards(guard_id,valid) VALUES(?,COALESCE((SELECT 1 FROM account_operations WHERE flow_hash=? AND completed_at IS NULL AND expires_at>${DB_NOW}),0))`,
    )
    .bind(id, flowHash);
}
async function flowOperation(
  db: AuthDatabase,
  flowHash: string,
): Promise<Operation | null> {
  return db
    .prepare(
      `SELECT * FROM account_operations WHERE flow_hash=? AND expires_at>${DB_NOW}`,
    )
    .bind(flowHash)
    .first<Operation>();
}
async function finishRecovery(
  db: AuthDatabase,
  env: AuthEnv,
  flowToken: string,
  operation: Operation,
  actor: Actor | null,
): Promise<Response> {
  const token = await recoverySessionToken(env.AUTH_HMAC_SECRET!, flowToken),
    hash = await tokenHash(token);
  const readRetry = async () => {
    const account = await db
      .prepare("SELECT * FROM accounts WHERE account_id=?")
      .bind(operation.account_id)
      .first<AccountRow>();
    if (
      operation.issued_session_hash !== hash ||
      !account ||
      account.credential_version !== operation.credential_version + 1 ||
      account.recovery_version !== operation.recovery_version + 1 ||
      account.session_epoch !== operation.session_epoch + 1
    )
      throw new AuthProblem("stale_operation", 409);
    return await sessionResponse(db, token, {}, []);
  };
  if (operation.completed_at !== null) return await readRetry();
  const ids = [randomToken(), randomToken(), ...(actor ? [randomToken()] : [])];
  const expected = {
    accountId: operation.account_id,
    credentialVersion: operation.credential_version,
    recoveryVersion: operation.recovery_version,
    sessionEpoch: operation.session_epoch,
  };
  try {
    await guarded(
      db,
      [
        credentialGuard(db, ids[0], expected),
        operationGuard(db, ids[1], operation.flow_hash),
        ...(actor
          ? [
              sessionGuard(
                db,
                ids[2],
                actor.token_hash,
                actor.context_id,
                false,
              ),
            ]
          : []),
      ],
      [
        db
          .prepare(
            "UPDATE accounts SET password_hash=?,recovery_hash=?,credential_version=credential_version+1,recovery_version=recovery_version+1,session_epoch=session_epoch+1,recovery_acknowledged=1 WHERE account_id=?",
          )
          .bind(
            operation.password_hash,
            operation.replacement_recovery_hash,
            operation.account_id,
          ),
        ...revoke(db, "s.account_id=?", [operation.account_id]),
        ...(actor && actor.account_id !== operation.account_id
          ? revoke(db, "s.token_hash=?", [actor.token_hash])
          : []),
        addSession(
          db,
          hash,
          operation.account_id,
          operation.session_epoch + 1,
          randomToken(),
        ),
        db
          .prepare(
            `UPDATE account_operations SET completed_at=${DB_NOW},issued_session_hash=? WHERE flow_hash=?`,
          )
          .bind(hash, operation.flow_hash),
      ],
      ids,
    );
  } catch (error) {
    if (!(error instanceof AuthProblem) || error.code !== "stale_operation")
      throw error;
    const completed = await flowOperation(db, operation.flow_hash);
    if (!completed || completed.completed_at === null) throw error;
    operation = completed;
    return await readRetry();
  }
  return await sessionResponse(db, token);
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
    ) throw new AuthProblem("temporarily_unavailable", 503);
    if (request.method === "GET" && path === "/api/auth/session")
      return json({ ok: true, ...sessionState(await authenticatedActor(request, env)) });
    if (request.method !== (path === "/api/account" ? "PATCH" : "POST"))
      throw new AuthProblem("invalid_input", 405);
    const body = await authBody(request, env);
    const actor = await authenticatedActor(request, env);
    if (
      actor &&
      request.headers.get(SESSION_CONTEXT_HEADER) !== actor.context_id
    ) {
      // A completion response can apply its cookie before the response body is
      // lost. Only the matching completed flow may retry with the old context.
      const flow =
        path === "/api/auth/recovery/finish"
          ? readAuthCookie(request, "flow")
          : null;
      const completed = flow
        ? await flowOperation(db, await tokenHash(flow))
        : null;
      if (
        !completed ||
        completed.kind !== "recovery" ||
        completed.completed_at === null ||
        completed.issued_session_hash !== actor.token_hash ||
        completed.account_id !== actor.account_id
      )
        throw new AuthProblem("session_changed", 409);
    }
    if (path === "/api/account") {
      const current = requireActor(actor),
        parsed = validateAccountPatch(body, current.username);
      if (!parsed.ok) throw new AuthProblem("invalid_input");
      const patch = parsed.value,
        id = randomToken();
      await guarded(
        db,
        [sessionGuard(db, id, current.token_hash, current.context_id, false)],
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
      kind: "register" | "login" | "recovery" | "change",
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
        hash = await tokenHash(token),
        code = createRecoveryCode();
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
                  false,
                ),
              ]
            : []),
          db
            .prepare(
              `INSERT INTO accounts(account_id,username,username_canonical,display_name,created_at,password_hash,recovery_hash) VALUES(?,?,?,?,${DB_NOW},?,?)`,
            )
            .bind(
              accountId,
              name.value.username,
              name.value.canonical,
              display.value,
              encoded,
              await tokenHash(normalizeRecoveryCode(code)!),
            ),
          addSession(db, hash, accountId, 1, randomToken()),
          ...(actor
            ? [
                ...revoke(db, "s.token_hash=?", [actor.token_hash]),
                clearTransactionGuard(db, transitionId!),
              ]
            : []),
          ...(await retireBrowserFlow(db, request)),
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
      return await sessionResponse(
        db,
        token,
        { recoveryCode: code, recoveryVersion: 1 },
        [clearAuthCookie("flow")],
      );
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
                  false,
                ),
              ]
            : []),
        ],
        [
          ...(actor ? revoke(db, "s.token_hash=?", [actor.token_hash]) : []),
          ...(await retireBrowserFlow(db, request)),
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
      return await sessionResponse(db, token, {}, [clearAuthCookie("flow")]);
    }
    if (path === "/api/auth/logout") {
      exactKeys(body, []);
      const token = readAuthCookie(request),
        flowToken = readAuthCookie(request, "flow");
      const hashes: string[] = [];
      if (token) hashes.push(await tokenHash(token));
      const flowHash = flowToken ? await tokenHash(flowToken) : null;
      const writes: AuthStatement[] = [];
      if (flowHash) {
        writes.push(
          ...revoke(
            db,
            "s.token_hash IN (SELECT issued_session_hash FROM account_operations WHERE flow_hash=?)",
            [flowHash],
          ),
        );
        writes.push(
          db
            .prepare("DELETE FROM account_operations WHERE flow_hash=?")
            .bind(flowHash),
        );
      }
      for (const hash of new Set(hashes))
        writes.push(...revoke(db, "s.token_hash=?", [hash]));
      if (writes.length) await db.batch(writes);
      return json({ ok: true, authenticated: false }, 200, [
        clearAuthCookie(),
        clearAuthCookie("flow"),
      ]);
    }
    if (path === "/api/auth/activity") {
      exactKeys(body, []);
      const current = requireActor(actor),
        id = randomToken();
      await guarded(
        db,
        [sessionGuard(db, id, current.token_hash, current.context_id, false)],
        [renewal(db, current.token_hash)],
        [id],
      );
      return await sessionResponse(db, readAuthCookie(request)!);
    }
    if (path === "/api/auth/recovery-code/acknowledge") {
      exactKeys(body, ["saved", "recoveryVersion"]);
      const current = requireActor(actor);
      if (
        body.saved !== true ||
        body.recoveryVersion !== current.recovery_version
      )
        throw new AuthProblem("stale_operation", 409);
      const ids = [randomToken(), randomToken()];
      await guarded(
        db,
        [
          credentialGuard(db, ids[0], versions(current)),
          sessionGuard(
            db,
            ids[1],
            current.token_hash,
            current.context_id,
            false,
          ),
        ],
        [
          db
            .prepare(
              "UPDATE accounts SET recovery_acknowledged=1 WHERE account_id=?",
            )
            .bind(current.account_id),
          renewal(db, current.token_hash),
        ],
        ids,
      );
      return await sessionResponse(db, readAuthCookie(request)!);
    }
    if (path === "/api/auth/password") {
      exactKeys(body, ["currentPassword", "newPassword"]);
      const current = requireActor(actor);
      await attempt("change", current.token_hash);
      const old = passwordValue(
          body.currentPassword,
          current.username_canonical,
          false,
        ),
        next = passwordValue(
          body.newPassword,
          current.username_canonical,
          true,
        );
      if (!(await verifyPassword(env, old, current.password_hash)))
        throw new AuthProblem("invalid_credentials", 401);
      const encoded = await encodePassword(env, next),
        token = randomToken(),
        ids = [randomToken(), randomToken()];
      await guarded(
        db,
        [
          credentialGuard(db, ids[0], versions(current)),
          sessionGuard(
            db,
            ids[1],
            current.token_hash,
            current.context_id,
            false,
          ),
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
      return await sessionResponse(db, token, {}, [clearAuthCookie("flow")]);
    }
    if (
      path === "/api/auth/recovery/prepare" ||
      path === "/api/auth/recovery-code/prepare"
    ) {
      const recovery = path === "/api/auth/recovery/prepare";
      let account: AccountRow;
      let encoded: string | null = null;
      if (recovery) {
        exactKeys(
          body,
          ["username", "recoveryCode", "newPassword"],
          ["challengeToken"],
        );
        const name = normalizeUsername(body.username);
        if (!name.ok) throw new AuthProblem("invalid_input");
        const rate = await attempt("recovery", name.value.canonical),
          code = normalizeRecoveryCode(body.recoveryCode);
        const found = await db
          .prepare("SELECT * FROM accounts WHERE username_canonical=?")
          .bind(name.value.canonical)
          .first<AccountRow>();
        if (
          !code ||
          !found ||
          !equalTokenDigests(await tokenHash(code), found.recovery_hash)
        ) {
          await markAuthFailure(db, rate.failureKey);
          throw new AuthProblem("invalid_credentials", 401);
        }
        account = found;
        encoded = await encodePassword(
          env,
          passwordValue(body.newPassword, account.username_canonical, true),
        );
      } else {
        exactKeys(body, ["currentPassword"]);
        const current = requireActor(actor);
        await attempt("change", current.token_hash);
        account = current;
        if (
          !(await verifyPassword(
            env,
            passwordValue(
              body.currentPassword,
              current.username_canonical,
              false,
            ),
            current.password_hash,
          ))
        )
          throw new AuthProblem("invalid_credentials", 401);
      }
      const code = createRecoveryCode(),
        flowToken = randomToken(),
        flowHash = await tokenHash(flowToken),
        ids = [randomToken()];
      const guards = [credentialGuard(db, ids[0], versions(account))];
      if (!recovery) {
        ids.push(randomToken());
        guards.push(
          sessionGuard(db, ids[1], actor!.token_hash, actor!.context_id, false),
        );
      }
      const writes = [
        db
          .prepare(
            `INSERT INTO account_operations(flow_hash,account_id,kind,credential_version,recovery_version,session_epoch,initiating_session_hash,password_hash,replacement_recovery_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,${DB_NOW},${DB_NOW}+?)`,
          )
          .bind(
            flowHash,
            account.account_id,
            recovery ? "recovery" : "recovery_code",
            account.credential_version,
            account.recovery_version,
            account.session_epoch,
            recovery ? null : actor!.token_hash,
            encoded,
            await tokenHash(normalizeRecoveryCode(code)!),
            FLOW_TTL_MS,
          ),
      ];
      if (!recovery) writes.push(renewal(db, actor!.token_hash));
      await guarded(db, guards, writes, ids);
      return json(
        {
          ok: true,
          recoveryCode: code,
          recoveryVersion: account.recovery_version + 1,
          operationContext: await recoveryOperationContext(flowToken),
        },
        200,
        [
          authCookie(flowToken, "flow"),
          ...(!recovery ? [authCookie(readAuthCookie(request)!)] : []),
        ],
      );
    }
    if (
      path === "/api/auth/recovery/finish" ||
      path === "/api/auth/recovery-code/finish"
    ) {
      exactKeys(body, ["saved", "recoveryVersion", "operationContext"]);
      if (body.saved !== true) throw new AuthProblem("invalid_input");
      const flowToken = readAuthCookie(request, "flow");
      if (!flowToken || typeof body.operationContext !== "string" ||
          !equalTokenDigests(body.operationContext, await recoveryOperationContext(flowToken)))
        throw new AuthProblem("stale_operation", 409);
      const operation = await flowOperation(db, await tokenHash(flowToken));
      const recovery = path === "/api/auth/recovery/finish";
      if (
        !operation ||
        operation.kind !== (recovery ? "recovery" : "recovery_code") ||
        body.recoveryVersion !== operation.recovery_version + 1
      )
        throw new AuthProblem("stale_operation", 409);
      if (recovery)
        return await finishRecovery(db, env, flowToken, operation, actor);
      const current = requireActor(actor);
      if (
        operation.initiating_session_hash !== current.token_hash ||
        operation.account_id !== current.account_id
      )
        throw new AuthProblem("stale_operation", 409);
      if (operation.completed_at !== null) {
        if (
          current.recovery_version !== operation.recovery_version + 1 ||
          current.credential_version !== operation.credential_version ||
          current.session_epoch !== operation.session_epoch
        )
          throw new AuthProblem("stale_operation", 409);
        return await sessionResponse(db, readAuthCookie(request)!);
      }
      const ids = [randomToken(), randomToken(), randomToken()];
      await guarded(
        db,
        [
          credentialGuard(db, ids[0], {
            accountId: operation.account_id,
            credentialVersion: operation.credential_version,
            recoveryVersion: operation.recovery_version,
            sessionEpoch: operation.session_epoch,
          }),
          operationGuard(db, ids[1], operation.flow_hash),
          sessionGuard(
            db,
            ids[2],
            current.token_hash,
            current.context_id,
            false,
          ),
        ],
        [
          db
            .prepare(
              "UPDATE accounts SET recovery_hash=?,recovery_version=recovery_version+1,recovery_acknowledged=1 WHERE account_id=?",
            )
            .bind(operation.replacement_recovery_hash, current.account_id),
          db
            .prepare(
              `UPDATE account_operations SET completed_at=${DB_NOW} WHERE flow_hash=?`,
            )
            .bind(operation.flow_hash),
          renewal(db, current.token_hash),
        ],
        ids,
      );
      return await sessionResponse(db, readAuthCookie(request)!);
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
