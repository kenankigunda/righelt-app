import { spawnSync } from "node:child_process";
const project = process.env.PROJECT;
const browsers = project ? [project] : ["chromium"];
if (
  browsers.some(
    (browser) => !["chromium", "firefox", "webkit"].includes(browser),
  )
)
  throw Error("Unknown browser project");
const result = spawnSync(
  "pnpm",
  ["exec", "playwright", "install", "--with-deps", ...browsers],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
