// Mandatory receipt gate even when Playwright's --reporter overrides presentation.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { checkProxyFailureJournal } from "./auth-proxy-failures.mjs";

const runId = randomUUID();
const directory = path.resolve("test-results/auth-stack-diagnostics", runId);
const child = spawn(process.execPath, [createRequire(import.meta.url).resolve("@playwright/test/cli"), "test", "--config", "playwright.auth.config.mjs", ...process.argv.slice(2)], {
  stdio: "inherit", env: { ...process.env, RIGHELT_AUTH_FAILURE_DIRECTORY: directory, RIGHELT_AUTH_FAILURE_RUN_ID: runId },
});
let interrupted = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { interrupted = true; child.kill(signal); });
let code = await new Promise(resolve => {
  child.once("error", () => resolve(1));
  child.once("close", code => resolve(code ?? 1));
});
try {
  const result = await checkProxyFailureJournal(directory, runId);
  if (!result.passed) { console.error(`[auth-e2e] ${result.count} unresolved transport failure(s).`); code ||= 1; }
} catch { console.error("[auth-e2e] Request failure accounting is incomplete."); code ||= 1; }
process.exitCode = interrupted ? (code || 130) : code;
