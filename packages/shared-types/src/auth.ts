import { PASSWORD_MIN_CODE_POINTS, PASSWORD_MAX_CODE_POINTS } from './auth-policy.js';
export * from './auth-policy.js';

export type AuthErrorCode = 'invalid_input' | 'invalid_credentials' | 'username_unavailable' | 'recovery_acknowledgment_required' | 'stale_operation' | 'session_changed' | 'identity_mismatch' | 'upgrade_required' | 'legacy_read_only' | 'rate_limited' | 'temporarily_unavailable';
export type AccountPreferences = { tutorial: 'new' | 'completed' | 'skipped'; view: 'focused' | 'explanatory' };
export type PublicProfile = { username: string; displayName: string; joinedMonth: string };
export type AuthenticatedAccount = PublicProfile & { id: string; preferences: AccountPreferences };
export type SessionState = { authenticated: false } | { authenticated: true; account: AuthenticatedAccount; contextId: string; expiresAt: number; recoveryAcknowledgmentRequired: boolean };
export type AuthFailure = { ok: false; error: AuthErrorCode; retryAfterSeconds?: number; challengeRequired?: boolean };
export type RegisterInput = { username: string; displayName?: string; password: string; challengeToken?: string };
export type LoginInput = { username: string; password: string; challengeToken?: string };
export type RecoveryPrepareInput = { username: string; recoveryCode: string; newPassword: string; challengeToken?: string };
export type SavedCodeInput = { saved: true; recoveryVersion: number };
export type HashInput = { operation: 'hash'; password: string } | { operation: 'verify'; password: string; encoded: string };
export type HashOutput = { encoded: string } | { verified: boolean };
export type Validation<T> = { ok: true; value: T } | { ok: false; error: 'invalid_input' };
const invalid = { ok: false, error: 'invalid_input' } as const;

export function normalizeUsername(input: unknown): Validation<{ username: string; canonical: string }> {
  if (typeof input !== 'string') return invalid;
  const username = input.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '');
  return /^[A-Za-z0-9_]{3,24}$/.test(username) ? { ok: true, value: { username, canonical: username.toLowerCase() } } : invalid;
}
export function normalizeDisplayName(input: unknown, fallback: string): Validation<string> {
  if (input === undefined || input === '') return { ok: true, value: fallback };
  if (typeof input !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input)) return invalid;
  const value = input.normalize('NFC').trim();
  if (!value) return { ok: true, value: fallback };
  if (new TextEncoder().encode(value).length > 256 || /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(value)) return invalid;
  // Keep emoji joiners while rejecting names consisting only of invisible marks.
  if (!value.replace(/[\p{Default_Ignorable_Code_Point}\p{Z}\p{M}]/gu, '')) return invalid;
  const count = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)).length;
  return count <= 32 ? { ok: true, value } : invalid;
}
export function normalizePassword(input: unknown): Validation<string> {
  if (typeof input !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input)) return invalid;
  const value = input.normalize('NFC');
  const length = Array.from(value).length;
  return length >= PASSWORD_MIN_CODE_POINTS && length <= PASSWORD_MAX_CODE_POINTS ? { ok: true, value } : invalid;
}
export function isPasswordAllowed(password: string, canonicalUsername: string, blocklist: ReadonlySet<string>): boolean {
  return !blocklist.has(password) && password.toLowerCase() !== canonicalUsername;
}
export function safeContinuation(input: unknown, origin: string): string | null {
  if (typeof input !== 'string' || !input.startsWith('/') || input.startsWith('//') || /[\\\u0000-\u001f\u007f]/u.test(input)) return null;
  try { const target = new URL(input, origin); return target.origin === new URL(origin).origin ? target.pathname + target.search + target.hash : null; }
  catch { return null; }
}
