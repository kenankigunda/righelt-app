import { requireDeploymentOrigin } from "./deployment-origin.mjs";
import { fileURLToPath } from "node:url";
import { readEmbeddedClientBuild } from "./client-build-identity.mjs";

const CLIENT_PROPAGATION_DEADLINE_MS = 30_000;
const CLIENT_READ_TIMEOUT_MS = 15_000;
const CLIENT_RETRY_DELAYS_MS = [500, 1_000, 2_000];

const clientTiming = {
  now: () => performance.now(),
  wait: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  async within(operation, timeoutMs, onTimeout) {
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        onTimeout();
        reject(Error("Client artifact verification timed out"));
      }, timeoutMs);
    });
    try {
      return await Promise.race([operation, deadline]);
    } finally {
      clearTimeout(timeout);
    }
  },
};

function clientPropagationExpired() {
  return Error(
    "Loaded client commit did not reach the expected deployment commit before the propagation deadline",
  );
}

async function verifyExactClientBuild({
  origin,
  expectedCommit,
  fetcher,
  timing,
}) {
  const startedAt = timing.now();
  let retryIndex = 0;
  while (true) {
    const elapsed = timing.now() - startedAt;
    if (elapsed >= CLIENT_PROPAGATION_DEADLINE_MS)
      throw clientPropagationExpired();

    const controller = new AbortController();
    const readTimeout = Math.min(
      CLIENT_READ_TIMEOUT_MS,
      CLIENT_PROPAGATION_DEADLINE_MS - elapsed,
    );
    const read = (async () => {
      const response = await fetcher(new URL("/main.js", origin), {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw Error("Loaded client artifact request failed");
      return readEmbeddedClientBuild(await response.text());
    })();
    const observedCommit = await timing.within(
      read,
      readTimeout,
      () => controller.abort(),
    );
    if (timing.now() - startedAt >= CLIENT_PROPAGATION_DEADLINE_MS)
      throw clientPropagationExpired();
    if (observedCommit === expectedCommit) return;

    const remaining =
      CLIENT_PROPAGATION_DEADLINE_MS - (timing.now() - startedAt);
    if (remaining <= 0) throw clientPropagationExpired();
    const delay = Math.min(
      CLIENT_RETRY_DELAYS_MS[
        Math.min(retryIndex, CLIENT_RETRY_DELAYS_MS.length - 1)
      ],
      remaining,
    );
    retryIndex += 1;
    await timing.wait(delay);
  }
}

export async function boundarySmoke({
  origin,
  privateOrigin,
  expectedCommit,
  preparation = false,
  fetcher = fetch,
  timing = clientTiming,
}) {
  requireDeploymentOrigin(origin, "RIGHELT_SITE_ORIGIN");
  requireDeploymentOrigin(privateOrigin, "CLOUDFLARE_API_BASE_URL");
  if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? "")) throw Error("Expected deployment commit is missing or malformed");
  const health = await fetcher(new URL("/api/health", origin), {
    signal: AbortSignal.timeout(15000),
  });
  const body = await health.json();
  if (!health.ok || !body.ok || !body.bindings?.db || !body.bindings?.gameRooms)
    throw Error("Pages service binding is not healthy");
  let direct;
  try {
    direct = await fetcher(new URL("/api/health", privateOrigin), {
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
  } catch {
    throw Error(
      "Direct API boundary could not be verified; network failure is not proof of privacy",
    );
  }
  if (
    ![403, 404].includes(direct.status) ||
    !(
      direct.headers.get("server")?.toLowerCase() === "cloudflare" ||
      direct.headers.has("cf-ray")
    )
  )
    throw Error(
      "Direct API did not return an expected Cloudflare route rejection",
    );
  await verifyExactClientBuild({ origin, expectedCommit, fetcher, timing });
  if (preparation) {
    const r = await fetcher(new URL("/api/shell/bootstrap", origin), {
        signal: AbortSignal.timeout(15000),
      }),
      b = await r.json();
    if (!r.ok || !b.accountsRequired || !b.accountsAvailable || !b.maintenance)
      throw Error("Account preparation must remain closed for play");
  }
  return { ok: true };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await boundarySmoke({
      origin: process.env.RIGHELT_SITE_ORIGIN,
      privateOrigin: process.env.CLOUDFLARE_API_BASE_URL,
      expectedCommit: process.env.DEPLOY_SHA,
      preparation: process.argv.includes("--preparation"),
    });
    console.log(
      "Pages service binding healthy; direct API route rejected by Cloudflare.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
