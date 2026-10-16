// Called only by the deployment workflow; never by tests or application code.
import { requireDeploymentOrigin } from "./deployment-origin.mjs";
import { requireLegacyGameId } from "./account-smoke.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync,writeFileSync,unlinkSync } from "node:fs";
import { archiveDeploymentConfig } from "./storage-archive-config.mjs";
const run = (args, input) => {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    env: wranglerEnvironment(process.env),
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    input,
  });
  if (result.status !== 0)
    throw Error("Account service deployment command failed");
};
export function wranglerEnvironment(env) {
  const childEnv = { ...env };
  // This application boundary setting is also Wrangler's control-plane override.
  // Validate it in the parent, but let Wrangler use its default Cloudflare API.
  delete childEnv.CLOUDFLARE_API_BASE_URL;
  return childEnv;
}
export function validateDeployment(env) {
  const enabled = env.RIGHELT_AUTH_ENABLED || "false";
  if (!["true", "false"].includes(enabled))
    throw Error("RIGHELT_AUTH_ENABLED must be true or false");
  const origin = requireDeploymentOrigin(env.RIGHELT_SITE_ORIGIN, "RIGHELT_SITE_ORIGIN");
  requireDeploymentOrigin(env.CLOUDFLARE_API_BASE_URL, "CLOUDFLARE_API_BASE_URL");
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
export function validateStorageDeployment(env,source) {
  if(!/^[a-f0-9]{40}$/.test(env.DEPLOY_SHA||""))throw Error("Missing deployment revision");
  const name=/database_name\s*=\s*"([^"]+)"/.exec(source)?.[1];
  if(!name)throw Error("Missing database binding");
  if(env.CLOUDFLARE_D1_DB_NAME && ![name,"DB"].includes(env.CLOUDFLARE_D1_DB_NAME))throw Error("Migration target differs from deployed database binding");
  if(name.startsWith("righelt-db-prod") && !env.RIGHELT_STORAGE_GENERATION)throw Error("Prepared production database requires RIGHELT_STORAGE_GENERATION");
  if(env.RIGHELT_STORAGE_GENERATION && !/^[A-Za-z0-9_-]{1,96}$/.test(env.RIGHELT_STORAGE_GENERATION))throw Error("Invalid storage generation");
  const configured=/^STORAGE_GENERATION\s*=\s*"([^"]*)"/m.exec(source)?.[1];
  if(configured && env.RIGHELT_STORAGE_GENERATION!==configured)throw Error("Storage generation differs from prepared binding");
  if(!["true","false"].includes(env.RIGHELT_STORAGE_COMPRESSION||"false"))throw Error("Storage compression must be true or false");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { enabled, origin } = validateDeployment(process.env);
    const source=readFileSync(new URL("../apps/api/wrangler.toml",import.meta.url),"utf8");
    validateStorageDeployment(process.env,source);
    const archiveSource=archiveDeploymentConfig(process.env,source);
    if (!process.argv.includes("--check-only")) {
      run(["deploy", "--config", "apps/auth-hash/wrangler.toml"]);
      run(["deploy", "--config", "apps/auth/wrangler.toml"]);
      const archivePath=`apps/api/.archive-deploy-${process.pid}.toml`;
      writeFileSync(archivePath,archiveSource,{mode:0o600});
      try { run([
        "deploy",
        "--config",
        archivePath,
        "--tag",process.env.DEPLOY_SHA,
        "--var",
        `AUTH_ENABLED:${enabled}`,
        "--var",
        `STORAGE_GENERATION:${process.env.RIGHELT_STORAGE_GENERATION || ""}`,
        "--var",
        `STORAGE_COMPRESSION:${process.env.RIGHELT_STORAGE_COMPRESSION || "false"}`,
        "--var",
        `AUTH_ALLOWED_ORIGINS:${origin}`,
        "--var",
        `AUTH_TURNSTILE_SITE_KEY:${process.env.AUTH_TURNSTILE_SITE_KEY || ""}`,
      ]); } finally { unlinkSync(archivePath); }
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
