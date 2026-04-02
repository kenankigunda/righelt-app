import { execFileSync } from "node:child_process";

const GENERATED_ROOT = "apps/web/generated";

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    ...options,
  });

try {
  run("pnpm", ["build:web-engine"]);
  const status = run("git", ["status", "--short", "--untracked-files=all", "--", GENERATED_ROOT]).trim();
  if (status) {
    console.error("Generated web engine output is stale. Run `pnpm build:web-engine` and commit the resulting changes.");
    console.error(status);
    process.exit(1);
  }
} catch (error) {
  if (typeof error?.stdout === "string" && error.stdout) {
    process.stdout.write(error.stdout);
  }
  if (typeof error?.stderr === "string" && error.stderr) {
    process.stderr.write(error.stderr);
  }
  process.exit(error?.status ?? 1);
}
