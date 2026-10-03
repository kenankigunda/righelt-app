import {
  FLOW_COOKIE,
  FLOW_TTL_MS,
  SESSION_COOKIE,
  SESSION_IDLE_MS,
} from "../../shared-types/src/auth-policy.js";
const encoder = new TextEncoder();
export function randomToken(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}
export async function tokenHash(token: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(token)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function createRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let buffer = 0,
    bits = 0,
    code = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      code += alphabet[(buffer >>> bits) & 31];
    }
  }
  return code.match(/.{4}/g)!.join("-");
}
export function normalizeRecoveryCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.replace(/[ -]/g, "").toUpperCase();
  return /^[0-9A-HJKMNP-TV-Z]{32}$/.test(value) ? value : null;
}
export function sessionExpired(expiresAt: number, now: number): boolean {
  return (
    !Number.isFinite(expiresAt) || !Number.isFinite(now) || expiresAt <= now
  );
}
export function sessionExpiry(now: number): number {
  return now + SESSION_IDLE_MS;
}
export function authCookie(
  token: string,
  kind: "session" | "flow" = "session",
  remainingSeconds?: number,
): string {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error("Invalid opaque cookie token");
  const name = kind === "session" ? SESSION_COOKIE : FLOW_COOKIE;
  const duration = kind === "session" ? SESSION_IDLE_MS : FLOW_TTL_MS;
  const maxAge = remainingSeconds ?? duration / 1000;
  if (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > duration / 1000)
    throw new Error("Invalid cookie lifetime");
  return `${name}=${token}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}
export function clearAuthCookie(kind: "session" | "flow" = "session"): string {
  return `${kind === "session" ? SESSION_COOKIE : FLOW_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}
export function readAuthCookie(
  request: Request,
  kind: "session" | "flow" = "session",
): string | null {
  const name = kind === "session" ? SESSION_COOKIE : FLOW_COOKIE;
  const values = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export async function recoverySessionToken(
  secret: string,
  flowToken: string,
): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(secret) || !/^[a-f0-9]{64}$/.test(flowToken))
    throw new Error("Invalid recovery key material");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`righelt/recovery-session/v1\0${flowToken}`),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// Both operands are SHA-256 hex digests. Always examine all 64 characters.
export function equalTokenDigests(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right))
    return false;
  let difference = 0;
  for (let index = 0; index < 64; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
