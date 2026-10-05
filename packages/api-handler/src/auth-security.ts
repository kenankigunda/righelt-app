import {
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
export function sessionExpired(expiresAt: number, now: number): boolean {
  return (
    !Number.isFinite(expiresAt) || !Number.isFinite(now) || expiresAt <= now
  );
}
export function sessionExpiry(now: number): number {
  return now + SESSION_IDLE_MS;
}
export function authCookie(token: string, remainingSeconds?: number): string {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error("Invalid opaque cookie token");
  const name = SESSION_COOKIE;
  const duration = SESSION_IDLE_MS;
  const maxAge = remainingSeconds ?? duration / 1000;
  if (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > duration / 1000)
    throw new Error("Invalid cookie lifetime");
  return `${name}=${token}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}
export function clearAuthCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}
export function readAuthCookie(request: Request): string | null {
  const name = SESSION_COOKIE;
  const values = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
