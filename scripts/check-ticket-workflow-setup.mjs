import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const resolveMainRepoFromGit = ({ gitCommonDir, topLevel }) => {
  if (!gitCommonDir || gitCommonDir === ".git") {
    return topLevel;
  }
  return gitCommonDir.endsWith("/.git") ? gitCommonDir.slice(0, -5) : gitCommonDir;
};

export const resolveBacklogRepoFromMainRepo = (mainRepo) => path.join(path.dirname(mainRepo), "righelt-backlog");
export const resolveBacklogDirFromMainRepo = (mainRepo) => path.join(resolveBacklogRepoFromMainRepo(mainRepo), "backlog");

export const detectBacklogBin = (env = process.env) => {
  if (typeof env.BACKLOG_BIN === "string" && env.BACKLOG_BIN.trim().length > 0) {
    return env.BACKLOG_BIN.trim();
  }
  const resolved = spawnSync("bash", ["-lc", "command -v backlog"], { encoding: "utf8" });
  if (resolved.status === 0) {
    return resolved.stdout.trim();
  }
  return "/opt/homebrew/bin/backlog";
};

export const buildSetupChecks = ({
  cwd,
  gitCommonDir,
  topLevel,
  backlogBin,
  backlogRepoExists,
  backlogDirExists,
  backlogHelpOk,
}) => {
  const mainRepo = resolveMainRepoFromGit({ gitCommonDir, topLevel });
  const backlogRepo = resolveBacklogRepoFromMainRepo(mainRepo);
  const backlogDir = resolveBacklogDirFromMainRepo(mainRepo);

  return {
    cwd,
    mainRepo,
    backlogRepo,
    backlogDir,
    checks: [
      { name: "backlog CLI", ok: typeof backlogBin === "string" && backlogBin.trim().length > 0, detail: backlogBin },
      { name: "sibling backlog repo", ok: backlogRepoExists, detail: backlogRepo },
      { name: "backlog working directory", ok: backlogDirExists, detail: backlogDir },
      { name: "wrapper resolution", ok: backlogHelpOk, detail: "./scripts/backlog.sh task --help" },
    ],
  };
};

const run = () => {
  const cwd = process.cwd();
  const gitCommon = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8" });
  const topLevel = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });

  if (gitCommon.status !== 0 || topLevel.status !== 0) {
    console.error("Ticket workflow setup check failed: current directory is not inside a git checkout.");
    process.exit(1);
  }

  const gitCommonDir = gitCommon.stdout.trim();
  const topLevelPath = topLevel.stdout.trim();
  const backlogBin = detectBacklogBin();
  const mainRepo = resolveMainRepoFromGit({ gitCommonDir, topLevel: topLevelPath });
  const backlogRepo = resolveBacklogRepoFromMainRepo(mainRepo);
  const backlogDir = resolveBacklogDirFromMainRepo(mainRepo);

  const backlogHelp = spawnSync(path.join(mainRepo, "scripts", "backlog.sh"), ["task", "--help"], {
    cwd,
    encoding: "utf8",
  });

  const report = buildSetupChecks({
    cwd,
    gitCommonDir,
    topLevel: topLevelPath,
    backlogBin,
    backlogRepoExists: existsSync(backlogRepo),
    backlogDirExists: existsSync(backlogDir),
    backlogHelpOk: backlogHelp.status === 0,
  });

  console.log(`Ticket workflow setup check for ${report.mainRepo}`);
  for (const check of report.checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  if (!report.checks.every((check) => check.ok)) {
    process.exit(1);
  }
};

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run();
}
