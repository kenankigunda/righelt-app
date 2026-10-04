import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { browserLaunchOptions } from "../../../scripts/playwright-launch-options.mjs";

for (const platform of ["darwin", "linux", "win32"]) {
  for (const name of ["chromium", "firefox", "webkit"]) {
    test(`browser launcher scope: ${platform}/${name}`, () => {
      const env = { [`RIGHELT_${name.toUpperCase()}_EXECUTABLE`]: "/custom browser/bin", FORWARD_MARKER: "retained" };
      const before = { ...env };
      const result = browserLaunchOptions(name, { platform, env, webkitExecutablePath: () => { throw new Error("override must win"); } });
      if (platform === "darwin" && name === "webkit") {
        assert.ok(result.executablePath.endsWith("/scripts/webkit-no-window-animations.sh"));
        assert.deepEqual(result.env, { ...env, RIGHELT_WEBKIT_BROWSER_EXECUTABLE: "/custom browser/bin" });
      } else assert.deepEqual(result, { executablePath: "/custom browser/bin" });
      assert.deepEqual(env, before, "configuration must not mutate the caller's environment");
    });
  }
}

test("only Darwin WebKit resolves the bundled executable when no override exists", () => {
  let resolutions = 0;
  const options = { env: {}, webkitExecutablePath: () => { resolutions++; return "/bundled browser/pw_run.sh"; } };
  assert.deepEqual(browserLaunchOptions("webkit", { ...options, platform: "linux" }), { executablePath: undefined });
  assert.deepEqual(browserLaunchOptions("chromium", { ...options, platform: "darwin" }), { executablePath: undefined });
  assert.equal(resolutions, 0);
  assert.equal(browserLaunchOptions("webkit", { ...options, platform: "darwin" }).env.RIGHELT_WEBKIT_BROWSER_EXECUTABLE, "/bundled browser/pw_run.sh");
  assert.equal(resolutions, 1);
});

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "righelt browser args "));
  const executable = path.join(directory, "fake browser.sh");
  const program = path.join(directory, "fake browser.mjs");
  writeFileSync(program, `process.stdout.write(JSON.stringify({ args: process.argv.slice(2), marker: process.env.FORWARD_MARKER, pid: process.pid }) + "\\n");
if (process.env.WAIT_FOR_SIGNAL === "yes") setInterval(() => {}, 1000);
else process.exit(Number(process.env.BROWSER_EXIT || 0));\n`);
  writeFileSync(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(program)} "$@"\n`, { mode: 0o755 });
  const options = browserLaunchOptions("webkit", { platform: "darwin", env: { ...process.env, RIGHELT_WEBKIT_EXECUTABLE: executable, FORWARD_MARKER: "retained" } });
  return { directory, options };
}

test("launcher forwards spaced executable/arguments and environment and preserves exit status", { skip: process.platform === "win32" }, () => {
  const { directory, options } = fixture();
  try {
    const args = ["--inspector-pipe", "--path=contains spaces", "literal;$value"];
    const result = spawnSync(options.executablePath, args, { env: { ...options.env, BROWSER_EXIT: "23" }, encoding: "utf8" });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 23);
    const observed = JSON.parse(result.stdout);
    assert.deepEqual(observed.args, [...args, "-NSAutomaticWindowAnimationsEnabled", "NO"]);
    assert.equal(observed.marker, "retained");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("launcher exec keeps the browser PID and signal termination", { skip: process.platform === "win32", timeout: 5000 }, async () => {
  const { directory, options } = fixture();
  const child = spawn(options.executablePath, [], { env: { ...options.env, WAIT_FOR_SIGNAL: "yes" }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const exit = once(child, "exit");
    const [data] = await once(child.stdout, "data");
    assert.equal(JSON.parse(data.toString()).pid, child.pid, "exec must replace the wrapper process");
    child.kill("SIGTERM");
    const [code, signal] = await exit;
    assert.equal(code, null);
    assert.equal(signal, "SIGTERM");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

test("launcher fails closed when its browser target is missing", { skip: process.platform === "win32" }, () => {
  const { executablePath } = browserLaunchOptions("webkit", { platform: "darwin", env: {}, webkitExecutablePath: () => "/unused" });
  const result = spawnSync(executablePath, [], { env: {}, encoding: "utf8" });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing WebKit executable/);
  assert.equal(result.stdout, "");
});
