import { spawn } from "node:child_process";
import { cliPath } from "./resources/supervisor.mjs";

// Always create a guardian, including inside an existing test supervisor. The
// browser runner may put its web server in a separate process group.
export function spawnAuthStackCommand(args, { cwd, env = process.env, service = false, captureStderr = false } = {}) {
  return spawn(process.execPath, [cliPath, "run", "--kind", service ? "preview" : "heavy", "--", "pnpm", ...args], {
    cwd, env, stdio: captureStderr ? ["inherit", "inherit", "pipe"] : "inherit"
  });
}

export async function stopAuthStackCommand(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return child.exitCode === 0 || child.exitCode === 130;
  }
  const closed = new Promise(resolve => child.once("close", code => resolve(code === 0 || code === 130)));
  // The guardian owns escalation and verifies all descendants before closing.
  child.kill("SIGTERM");
  return closed;
}
