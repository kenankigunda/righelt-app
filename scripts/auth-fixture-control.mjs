// Local test control only. Retry only fixed, idempotent fixture assignments.
const operations = new Map([
  ["/activate-cutover", "UPDATE account_cutover SET activated_at=COALESCE(activated_at,CAST(unixepoch('subsec')*1000 AS INTEGER)),maintenance=1,canary_account_id=(SELECT account_id FROM accounts WHERE username_canonical='cutover_canary') WHERE singleton=1"],
  ["/maintenance-on", "UPDATE account_cutover SET maintenance=1 WHERE singleton=1 AND activated_at IS NOT NULL"],
  ["/maintenance-off", "UPDATE account_cutover SET maintenance=0 WHERE singleton=1 AND activated_at IS NOT NULL"],
  ["/reset-limits", "DELETE FROM account_rate_limits"],
  ["/expire-sessions", "UPDATE account_sessions SET expires_at = created_at + 1, last_activity_at = created_at"],
]);
const retryableOperations = new Set(["/reset-limits", "/maintenance-on", "/maintenance-off"]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createAuthFixtureControl(execute, { sleep = delay } = {}) {
  let busy = false;
  return async (request, response) => {
    const sql = operations.get(request.url);
    if (request.method !== "POST" || request.headers.origin || !sql) {
      response.writeHead(404).end(); return;
    }
    if (busy) { response.writeHead(409).end(); return; }
    busy = true;
    try {
      for (let attempt = 0; ; attempt++) {
        try { await execute(sql); break; }
        catch (error) {
          // Inspect captured subprocess diagnostics, never generic HTTP failures.
          if (!retryableOperations.has(request.url) || attempt >= 3 ||
              !/\bSQLITE_BUSY\b/.test(error?.stderr ?? "")) throw error;
          await sleep(250 * (attempt + 1));
        }
      }
      response.writeHead(200).end("done");
    } catch { response.writeHead(500).end("Local fixture operation failed"); }
    finally { busy = false; }
  };
}
