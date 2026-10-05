import {
  AUTH_PROTOCOL_VERSION,
  AUTH_PROTOCOL_HEADER,
  AUTH_REQUEST_HEADER,
  SESSION_CONTEXT_HEADER,
  SESSION_COOKIE,
} from "../packages/shared-types/src/auth-policy.js";
import { fileURLToPath } from "node:url";
export function requireLegacyGameId(legacyGameId) {
  if (typeof legacyGameId !== "string" || !legacyGameId.trim())
    throw Error(
      "ACCOUNT_SMOKE_LEGACY_GAME_ID must identify a preserved legacy game",
    );
}
export async function accountSmoke({
  origin,
  username,
  password,
  fetcher = fetch,
  legacyGameId,
}) {
  requireLegacyGameId(legacyGameId);
  const base = new URL(origin);
  if (
    base.protocol !== "https:" ||
    base.pathname !== "/" ||
    base.username ||
    base.password
  )
    throw Error("Smoke requires an HTTPS site origin");
  if (!username || !password)
    throw Error("Acknowledged smoke account credentials required");
  const browsers = [];
  const browser = () => {
    const cookies = new Map();
    let context = "";
    return {
      async call(route, body, extra = {}) {
        const response = await fetcher(new URL(route, base), {
          method: body === undefined ? "GET" : "POST",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: {
            Origin: base.origin,
            "Content-Type": "application/json",
            [AUTH_REQUEST_HEADER]: "1",
            [AUTH_PROTOCOL_HEADER]: String(AUTH_PROTOCOL_VERSION),
            [SESSION_CONTEXT_HEADER]: context,
            Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
            ...extra,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        for (const line of response.headers.getSetCookie()) {
          const [pair] = line.split(";"),
            i = pair.indexOf("=");
          cookies.set(pair.slice(0, i), pair.slice(i + 1));
          if (
            pair.startsWith(SESSION_COOKIE + "=") &&
            !/Max-Age=0/i.test(line) &&
            (!/; Secure/i.test(line) ||
              !/; HttpOnly/i.test(line) ||
              !/; SameSite=Lax(?:;|$)/i.test(line) ||
              !/; Path=\/(?:;|$)/i.test(line) ||
              /; Domain=/i.test(line))
          )
            throw Error("Unsafe session cookie");
        }
        const data = await response.json();
        if (data.contextId) context = data.contextId;
        if (response.headers.get("cache-control") !== "no-store")
          throw Error("Smoke response unexpectedly cacheable");
        return { status: response.status, data };
      },
    };
  };
  const requireOk = (result, label) => {
    if (result.status !== 200 || result.data.ok === false)
      throw Error(`${label} failed (${result.status})`);
    return result.data;
  };
  try {
    const a = browser(),
      b = browser();
    browsers.push(a, b);
    const bootstrap = requireOk(
      await a.call("/api/shell/bootstrap"),
      "Bootstrap",
    );
    if (!bootstrap.accountsRequired || !bootstrap.accountsAvailable)
      throw Error("Accounts are not available and required");
    for (const client of browsers) {
      const login = requireOk(
        await client.call("/api/auth/login", { username, password }),
        "Login",
      );
      if (!login.authenticated)
        throw Error("Smoke account must be authenticated");
    }
    const game = requireOk(
      await a.call("/api/shell/games", { selfPlayMode: true }),
      "Canary game",
    ).game;
    if (game.ownershipMode !== "account_v1")
      throw Error("Canary ownership mismatch");
    const resumed = requireOk(
      await b.call(`/api/shell/games/${encodeURIComponent(game.id)}`),
      "Second browser",
    ).game;
    if (resumed.myRole !== "Player 1" && resumed.myRole !== "Player 2")
      throw Error("Second browser did not resume a seat");
    const wrongContext = await b.call(
      "/api/shell/games",
      { selfPlayMode: true },
      { [SESSION_CONTEXT_HEADER]: "wrong-context" },
    );
    if (wrongContext.status !== 409)
      throw Error("Wrong session context accepted");
    const publicReader = browser();
    const old = requireOk(
      await publicReader.call(
        `/api/shell/games/${encodeURIComponent(legacyGameId)}`,
      ),
      "Legacy public read",
    ).game;
    if (
      old?.ownershipMode !== "legacy_guest" ||
      old.canRecordMove ||
      old.inviteTokens
    )
      throw Error("Legacy game is not public read-only");
    const write = await a.call(
      `/api/shell/games/${encodeURIComponent(legacyGameId)}/live`,
      {},
    );
    if (write.status !== 409 || write.data.error !== "legacy_read_only")
      throw Error("Legacy write not explicitly rejected");
    const spoof = await b.call("/api/shell/games", {
      identityId: "forged",
      selfPlayMode: true,
    });
    if (spoof.status !== 403) throw Error("Spoofed identity accepted");
    requireOk(
      await a.call("/api/auth/password", {
        newPassword: password,
      }),
      "Session revocation",
    );
    if (
      requireOk(await b.call("/api/auth/session"), "Revoked browser")
        .authenticated
    )
      throw Error("Prior browser session survived password change");
    requireOk(await a.call("/api/auth/logout", {}), "Logout");
    if (
      requireOk(await a.call("/api/auth/session"), "Logged out browser")
        .authenticated
    )
      throw Error("Logout failed");
    return {
      ok: true,
      checks: [
        "secure cookies",
        "account ownership",
        "cross-browser seat",
        "spoof rejection",
        "session context",
        "legacy read-only",
        "revocation",
        "logout",
      ],
    };
  } finally {
    for (const client of browsers)
      try {
        await client.call("/api/auth/logout", {});
      } catch {}
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        await accountSmoke({
          origin: process.env.RIGHELT_SITE_ORIGIN,
          username: process.env.ACCOUNT_SMOKE_USERNAME,
          password: process.env.ACCOUNT_SMOKE_PASSWORD,
          legacyGameId: process.env.ACCOUNT_SMOKE_LEGACY_GAME_ID,
        }),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
