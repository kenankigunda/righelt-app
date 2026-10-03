// Called only by the deployment workflow; never by tests or application code.
import { requireLegacyGameId } from "./account-smoke.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const run = (args, input) => {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    input,
  });
  if (result.status !== 0)
    throw Error("Account service deployment command failed");
};
export function validateDeployment(env) {
  const enabled = env.RIGHELT_AUTH_ENABLED || "false";
  if (!["true", "false"].includes(enabled))
    throw Error("RIGHELT_AUTH_ENABLED must be true or false");
  const origin = env.RIGHELT_SITE_ORIGIN;
  if (
    !origin ||
    new URL(origin).origin !== origin ||
    !origin.startsWith("https://")
  )
    throw Error("RIGHELT_SITE_ORIGIN must be one exact HTTPS origin");
  if (
    enabled === "true" &&
    (!/^[a-f0-9]{64}$/.test(env.AUTH_HMAC_SECRET || "") ||
      !env.TURNSTILE_SECRET ||
      !env.AUTH_TURNSTILE_SITE_KEY)
  )
    throw Error("Missing account secret or challenge configuration");
  if (env.PREPARE_ACCOUNTS === "true" && enabled !== "true")
    throw Error("Account preparation requires enabled credentials");
  if (
    enabled === "true" &&
    env.PREPARE_ACCOUNTS !== "true" &&
    (!env.ACCOUNT_SMOKE_USERNAME || !env.ACCOUNT_SMOKE_PASSWORD)
  )
    throw Error(
      "Acknowledged canary smoke credentials required before deployment",
    );
  if (enabled === "true" && env.PREPARE_ACCOUNTS !== "true")
    requireLegacyGameId(env.ACCOUNT_SMOKE_LEGACY_GAME_ID);
  return { enabled, origin };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { enabled, origin } = validateDeployment(process.env);
    if (!process.argv.includes("--check-only")) {
      run(["deploy", "--config", "apps/auth-hash/wrangler.toml"]);
      run(["deploy", "--config", "apps/auth/wrangler.toml"]);
      run([
        "deploy",
        "--config",
        "apps/api/wrangler.toml",
        "--var",
        `AUTH_ENABLED:${enabled}`,
        "--var",
        `AUTH_ALLOWED_ORIGINS:${origin}`,
        "--var",
        `AUTH_TURNSTILE_SITE_KEY:${process.env.AUTH_TURNSTILE_SITE_KEY || ""}`,
      ]);
      if (enabled === "true")
        run(
          ["secret", "bulk", "--config", "apps/api/wrangler.toml"],
          JSON.stringify({
            AUTH_HMAC_SECRET: process.env.AUTH_HMAC_SECRET,
            TURNSTILE_SECRET: process.env.TURNSTILE_SECRET,
          }),
        );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
