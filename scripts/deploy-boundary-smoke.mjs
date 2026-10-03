import { fileURLToPath } from "node:url";
export async function boundarySmoke({
  origin,
  privateOrigin,
  preparation = false,
  fetcher = fetch,
}) {
  if (!origin || !privateOrigin)
    throw Error("Pages and former direct API origins required");
  for (const value of [origin, privateOrigin])
    if (new URL(value).origin !== value || !value.startsWith("https://"))
      throw Error("Exact HTTPS origins required");
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
