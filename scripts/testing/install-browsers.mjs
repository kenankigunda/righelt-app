import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function ubuntuArchiveMirrors(source) {
  const lines = source.split(/\r?\n/);
  const azure = /^http:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/(?:[\t ].*)?$/;
  if (!lines.some(line => azure.test(line))) return source;
  // Keep the runner's existing signed Ubuntu archives. Slow successful Azure
  // downloads do not trigger APT failover and can consume the entire test job.
  for (const host of ["archive.ubuntu.com", "security.ubuntu.com"]) {
    if (!lines.some(line => line.split(/\s+/)[0] === `https://${host}/ubuntu/`))
      throw Error("Expected official Ubuntu fallback mirror is missing");
  }
  return lines.filter(line => !azure.test(line)).join("\n");
}

export function installBrowsers({ env = process.env, platform = process.platform,
  read = readFileSync, spawn = spawnSync } = {}) {
  const browsers = env.PROJECT ? [env.PROJECT] : ["chromium"];
  if (browsers.some(browser => !["chromium", "firefox", "webkit"].includes(browser)))
    throw Error("Unknown browser project");
  if (platform === "linux" && env.GITHUB_ACTIONS === "true" && env.RUNNER_ENVIRONMENT === "github-hosted") {
    const file = "/etc/apt/apt-mirrors.txt";
    const original = read(file, "utf8");
    const mirrors = ubuntuArchiveMirrors(original);
    if (mirrors !== original) {
      const saved = spawn("sudo", ["tee", file], { input: mirrors, stdio: ["pipe", "ignore", "inherit"] });
      if (saved.error || saved.status !== 0) throw Error("Could not select official Ubuntu browser dependency mirrors");
    }
  }
  const result = spawn("pnpm", ["exec", "playwright", "install", "--with-deps", ...browsers], { stdio: "inherit" });
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = installBrowsers();
