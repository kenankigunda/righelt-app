import { AUTH_REQUEST_HEADER } from "../../shared-types/src/auth-policy.js";
import { DB_NOW, type AuthDatabase } from "./auth-db";
export { DB_NOW } from "./auth-db";
export class AuthProblem extends Error {
  constructor(
    public code: string,
    public status = 400,
    public retryAfter?: number,
    public challengeRequired = false,
  ) {
    super(code);
  }
}
export type AuthControlsEnv = {
  AUTH_ALLOWED_ORIGINS?: string;
  AUTH_HMAC_SECRET?: string;
  TURNSTILE_SECRET?: string;
};
export function allowedOrigin(request: Request, env: AuthControlsEnv): string {
  const origin = request.headers.get("Origin");
  const allowed = (env.AUTH_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origin || origin === "null" || !allowed.includes(origin))
    throw new AuthProblem("invalid_input", 403);
  try {
    if (new URL(origin).origin !== origin) throw new Error();
  } catch {
    throw new AuthProblem("invalid_input", 403);
  }
  return origin;
}
export async function authBody(
  request: Request,
  env: AuthControlsEnv,
): Promise<Record<string, unknown>> {
  allowedOrigin(request, env);
  if (
    request.headers.get(AUTH_REQUEST_HEADER) !== "1" ||
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
      "application/json"
  )
    throw new AuthProblem("invalid_input", 403);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthProblem("invalid_input");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) {
        await reader.cancel();
        throw new AuthProblem("invalid_input");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AuthProblem) throw error;
    throw new AuthProblem("invalid_input");
  }
}
export function exactKeys(
  body: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): void {
  if (
    required.some((key) => !Object.hasOwn(body, key)) ||
    Object.keys(body).some((key) => ![...required, ...optional].includes(key))
  )
    throw new AuthProblem("invalid_input");
}
export async function privateCounterKey(
  secret: string,
  value: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`righelt/rate/v1\0${value}`),
    ),
  );
  return Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
}
type Counter = {
  bucket_key: string;
  attempts: number;
  failures: number;
  expires_at: number;
  now: number;
};
export async function admitAuthAttempt(
  db: AuthDatabase,
  env: AuthControlsEnv,
  request: Request,
  kind: "register" | "login" | "recovery" | "change",
  identity: string,
): Promise<{
  challenge: boolean;
  failureKey: string;
}> {
  const ip = await privateCounterKey(
    env.AUTH_HMAC_SECRET!,
    request.headers.get("CF-Connecting-IP") ?? "missing-provider-ip",
  );
  const principal = await privateCounterKey(env.AUTH_HMAC_SECRET!, identity);
  const window = kind === "register" ? 3600000 : 900000;
  const definitions =
    kind === "register"
      ? [{ key: `register:${ip}`, limit: 5 }]
      : kind === "change"
        ? [{ key: `change:${principal}`, limit: 5 }]
        : [
            { key: `verify:${ip}:${principal}`, limit: 10 },
            { key: `verify-ip:${ip}`, limit: 50 },
            { key: `verify-user:${principal}`, limit: 50 },
          ];
  const results = await db.batch([
    db.prepare(
      `DELETE FROM account_rate_limits WHERE bucket_key IN (SELECT bucket_key FROM account_rate_limits WHERE expires_at<=${DB_NOW} LIMIT 100)`,
    ),
    ...definitions.map(({ key }) =>
      db
        .prepare(
          `INSERT INTO account_rate_limits(bucket_key,attempts,failures,expires_at) VALUES(?,1,0,${DB_NOW}+?) ON CONFLICT(bucket_key) DO UPDATE SET attempts=CASE WHEN expires_at<=${DB_NOW} THEN 1 ELSE attempts+1 END,failures=CASE WHEN expires_at<=${DB_NOW} THEN 0 ELSE failures END,expires_at=CASE WHEN expires_at<=${DB_NOW} THEN ${DB_NOW}+? ELSE expires_at END RETURNING *,${DB_NOW} AS now`,
        )
        .bind(key, window, window),
    ),
  ]);
  const rows = results.slice(1).map(
    (result) =>
      (
        result as {
          results: Counter[];
        }
      ).results?.[0],
  );
  if (rows.some((row) => !row))
    throw new AuthProblem("temporarily_unavailable", 503);
  for (let i = 0; i < rows.length; i++)
    if (rows[i].attempts > definitions[i].limit)
      throw new AuthProblem(
        "rate_limited",
        429,
        Math.max(1, Math.ceil((rows[i].expires_at - rows[i].now) / 1000)),
      );
  return {
    challenge:
      kind === "register"
        ? rows[0].attempts > 2
        : kind === "change"
          ? false
          : rows[0].failures >= 3,
    failureKey: definitions[0].key,
  };
}
export async function markAuthFailure(
  db: AuthDatabase,
  key: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE account_rate_limits SET failures=failures+1 WHERE bucket_key=? AND expires_at>${DB_NOW}`,
    )
    .bind(key)
    .run();
}
export async function validateChallenge(
  request: Request,
  env: AuthControlsEnv,
  action: string,
  token: unknown,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048)
    throw new AuthProblem("invalid_input", 403, undefined, true);
  if (!env.TURNSTILE_SECRET)
    throw new AuthProblem("temporarily_unavailable", 503);
  try {
    const response = await fetcher(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET,
          response: token,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error();
    const result = (await response.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    if (
      result.success !== true ||
      result.hostname !== new URL(allowedOrigin(request, env)).hostname ||
      result.action !== action
    )
      throw new AuthProblem("invalid_input", 403, undefined, true);
  } catch (error) {
    if (error instanceof AuthProblem) throw error;
    throw new AuthProblem("temporarily_unavailable", 503);
  }
}
