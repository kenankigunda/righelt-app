import {
  PASSWORD_MIN_CODE_POINTS,
  PASSWORD_MAX_CODE_POINTS,
} from "./auth-policy.js";
export * from "./auth-policy.js";

export type AuthErrorCode =
  | "invalid_input"
  | "invalid_credentials"
  | "username_unavailable"
  | "stale_operation"
  | "session_changed"
  | "identity_mismatch"
  | "upgrade_required"
  | "legacy_read_only"
  | "rate_limited"
  | "temporarily_unavailable";
export type AccountPreferences = {
  tutorial: "new" | "completed" | "skipped";
  view: "focused" | "explanatory";
};
export type PublicProfile = {
  username: string;
  displayName: string;
  joinedMonth: string;
};
export type AuthenticatedAccount = PublicProfile & {
  id: string;
  preferences: AccountPreferences;
};
export type SessionState =
  | { authenticated: false }
  | {
      authenticated: true;
      account: AuthenticatedAccount;
      contextId: string;
      expiresAt: number;
    };
export type AuthFailure = {
  ok: false;
  error: AuthErrorCode;
  retryAfterSeconds?: number;
  challengeRequired?: boolean;
};
export type RegisterInput = {
  username: string;
  displayName?: string;
  password: string;
  challengeToken?: string;
};
export type LoginInput = {
  username: string;
  password: string;
  challengeToken?: string;
};
export type UsernameLookupInput = { username: string };
export type UsernameLookupResult = { ok: true; exists: boolean };
export type PasswordChangeInput = { newPassword: string };
export type HashInput =
  | { operation: "hash"; password: string }
  | { operation: "verify"; password: string; encoded: string };
export type HashOutput = { encoded: string } | { verified: boolean };
export type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; error: "invalid_input" };
const invalid = { ok: false, error: "invalid_input" } as const;

export function normalizeUsername(
  input: unknown,
): Validation<{ username: string; canonical: string }> {
  if (typeof input !== "string") return invalid;
  const username = input.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");
  return /^[A-Za-z0-9_]{3,24}$/.test(username)
    ? { ok: true, value: { username, canonical: username.toLowerCase() } }
    : invalid;
}
export function normalizeDisplayName(
  input: unknown,
  fallback: string,
): Validation<string> {
  if (input === undefined || input === "") return { ok: true, value: fallback };
  if (
    typeof input !== "string" ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      input,
    )
  )
    return invalid;
  const value = input.normalize("NFC").trim();
  if (!value) return { ok: true, value: fallback };
  if (
    new TextEncoder().encode(value).length > 256 ||
    /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(value)
  )
    return invalid;
  // Keep emoji joiners while rejecting names consisting only of invisible marks.
  if (!value.replace(/[\p{Default_Ignorable_Code_Point}\p{Z}\p{M}]/gu, ""))
    return invalid;
  const count = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
  ).length;
  return count <= 32 ? { ok: true, value } : invalid;
}
export function normalizePassword(input: unknown): Validation<string> {
  if (
    typeof input !== "string" ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      input,
    )
  )
    return invalid;
  const value = input.normalize("NFC");
  const length = Array.from(value).length;
  return length >= PASSWORD_MIN_CODE_POINTS &&
    length <= PASSWORD_MAX_CODE_POINTS
    ? { ok: true, value }
    : invalid;
}
export function isPasswordAllowed(
  password: string,
  canonicalUsername: string,
  blocklist: ReadonlySet<string>,
): boolean {
  return (
    !blocklist.has(password) && password.toLowerCase() !== canonicalUsername
  );
}
/** Local feedback uses the same normalization and rejection rules as submission. */
export function evaluatePasswordRequirements(
  input: string,
  username: string,
  blocklist: ReadonlySet<string> | null,
): { length: boolean; differentFromUsername: boolean; notCommon: boolean | null } {
  const password = input.normalize("NFC");
  const name = normalizeUsername(username);
  const canonical = name.ok ? name.value.canonical : "";
  return {
    length: normalizePassword(input).ok,
    differentFromUsername: isPasswordAllowed(password, canonical, new Set()),
    notCommon: blocklist === null ? null : !blocklist.has(password),
  };
}
export function safeContinuation(
  input: unknown,
  origin: string,
): string | null {
  if (
    typeof input !== "string" ||
    !input.startsWith("/") ||
    input.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/u.test(input)
  )
    return null;
  try {
    const target = new URL(input, origin);
    return target.origin === new URL(origin).origin
      ? target.pathname + target.search + target.hash
      : null;
  } catch {
    return null;
  }
}

export type AccountPatch = {
  displayName?: string;
  preferences?: Partial<AccountPreferences>;
};
export function validateAccountPatch(
  input: unknown,
  username: string,
): Validation<AccountPatch> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid;
  const body = input as Record<string, unknown>;
  if (
    !Object.keys(body).length ||
    Object.keys(body).some(
      (key) => !["displayName", "preferences"].includes(key),
    )
  )
    return invalid;
  const result: AccountPatch = {};
  if ("displayName" in body) {
    const name = normalizeDisplayName(body.displayName, username);
    if (!name.ok) return invalid;
    result.displayName = name.value;
  }
  if ("preferences" in body) {
    if (
      !body.preferences ||
      typeof body.preferences !== "object" ||
      Array.isArray(body.preferences)
    )
      return invalid;
    const preferences = body.preferences as Record<string, unknown>;
    if (
      !Object.keys(preferences).length ||
      Object.keys(preferences).some(
        (key) => !["tutorial", "view"].includes(key),
      )
    )
      return invalid;
    if (
      "tutorial" in preferences &&
      (typeof preferences.tutorial !== "string" ||
        !["completed", "skipped"].includes(preferences.tutorial))
    )
      return invalid;
    if (
      "view" in preferences &&
      (typeof preferences.view !== "string" ||
        !["focused", "explanatory"].includes(preferences.view))
    )
      return invalid;
    result.preferences = preferences as Partial<AccountPreferences>;
  }
  return { ok: true, value: result };
}
