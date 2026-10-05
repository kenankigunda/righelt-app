// Operator-only D1 control. No HTTP administration endpoint is deployed.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
export function cutoverSql(action, canaryId) {
  if (action === "activate") {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(canaryId || ""))
      throw Error("A reviewed immutable canary account ID is required");
    return `UPDATE account_cutover SET activated_at=COALESCE(activated_at,CAST(unixepoch('subsec')*1000 AS INTEGER)),maintenance=1,canary_account_id='${canaryId}' WHERE singleton=1;`;
  }
  if (action === "pause")
    return "UPDATE account_cutover SET maintenance=1 WHERE singleton=1;";
  if (action === "reopen")
    return "UPDATE account_cutover SET maintenance=0 WHERE singleton=1 AND activated_at IS NOT NULL;";
  if (action === "status")
    return "SELECT activated_at,maintenance,canary_account_id FROM account_cutover WHERE singleton=1;";
  throw Error(
    "Use status, activate, pause or reopen; deactivation is forbidden",
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const action = process.argv[2],
      sql = cutoverSql(action, process.env.ACCOUNT_CANARY_ID);
    if (!process.argv.includes("--remote"))
      throw Error(
        "Explicit --remote required; review the runbook and backup before mutation",
      );
    const db = process.env.CLOUDFLARE_D1_DB_NAME;
    if (!db) throw Error("CLOUDFLARE_D1_DB_NAME required");
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        db,
        "--config",
        path.resolve("apps/api/wrangler.toml"),
        "--remote",
        "--command",
        sql,
      ],
      { stdio: "inherit" },
    );
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
