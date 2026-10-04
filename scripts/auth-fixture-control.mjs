// Local test-runner controls only. Never imported by application workers.
import { spawn } from "node:child_process";

const operations = Object.freeze({
  "/reset-limits": "DELETE FROM account_rate_limits",
  "/activate-cutover": "UPDATE account_cutover SET activated_at=COALESCE(activated_at,CAST(unixepoch('subsec')*1000 AS INTEGER)),maintenance=1,canary_account_id=(SELECT account_id FROM accounts WHERE username_canonical='cutover_canary' AND recovery_acknowledged=1) WHERE singleton=1",
  "/maintenance-on": "UPDATE account_cutover SET maintenance=1 WHERE singleton=1 AND activated_at IS NOT NULL",
  "/maintenance-off": "UPDATE account_cutover SET maintenance=0 WHERE singleton=1 AND activated_at IS NOT NULL",
  "/expire-sessions": "UPDATE account_sessions SET expires_at = created_at + 1, last_activity_at = created_at",
});

// Keep streamed diagnostics visible and retain a bounded tail for classification.
export function runFixtureCommand(args, { cwd, spawnCommand = spawn, stdout = process.stdout, stderr = process.stderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand("pnpm", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let diagnostics = "";
    const capture = (destination) => (chunk) => {
      destination.write(chunk);
      diagnostics = (diagnostics + String(chunk)).slice(-65536);
    };
    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));
    child.once("error", reject);
    // close follows stdout/stderr completion, unlike exit.
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`Local fixture command exited ${code}${signal ? ` (${signal})` : ""}`), { diagnostics }));
    });
  });
}

export function createFixtureControlHandler({ execute, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), report = error => console.error(error) }) {
  let busy = false;
  return async (request, response) => {
    const sql = Object.hasOwn(operations, request.url) ? operations[request.url] : null;
    if (request.method !== "POST" || request.headers.origin !== undefined || !sql) { response.writeHead(404).end(); return; }
    if (busy) { response.writeHead(409).end(); return; }
    busy = true;
    try {
      // Only the idempotent rate-limit reset retries explicit SQLite busy
      // diagnostics. Cutover and session controls retain one execution.
      for (let attempt = 0; ; attempt++) {
        try { await execute(sql); break; }
        catch (error) {
          if (request.url !== "/reset-limits" || attempt >= 2 || !/\bSQLITE_BUSY\b/.test(error?.diagnostics ?? "")) throw error;
          await wait(attempt === 0 ? 100 : 250);
        }
      }
      response.writeHead(200).end("done");
    } catch (error) {
      report(error);
      response.writeHead(500).end("Local fixture operation failed");
    } finally { busy = false; }
  };
}
