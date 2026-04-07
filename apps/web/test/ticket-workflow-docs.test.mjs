import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildSetupChecks,
  resolveBacklogDirFromMainRepo,
  resolveBacklogRepoFromMainRepo,
  resolveMainRepoFromGit,
} from "../../../scripts/check-ticket-workflow-setup.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const workflowDoc = readFileSync(path.join(repoRoot, "docs", "ai", "TICKET_WORKFLOW.md"), "utf8");
const agentsDoc = readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");

const roles = [
  { slug: "lead", skill: "ticket-lead", claude: "lead" },
  { slug: "product-owner", skill: "ticket-product-owner", claude: "product-owner" },
  { slug: "architect", skill: "ticket-architect", claude: "architect" },
  { slug: "eng", skill: "ticket-eng", claude: "eng" },
  { slug: "tester", skill: "ticket-tester", claude: "tester" },
];

test("ticket workflow doc points both Claude and Codex at the shared canon", () => {
  assert.match(workflowDoc, /docs\/ai\/ticket-workflow\/README\.md/);
  assert.match(workflowDoc, /docs\/ai\/ticket-workflow\/lead\.md/);
  assert.match(workflowDoc, /skills\/ticket-lead\/SKILL\.md/);
  assert.match(workflowDoc, /node scripts\/check-ticket-workflow-setup\.mjs/);
  assert.match(workflowDoc, /scripts\/backlog\.sh/);
  assert.match(workflowDoc, /scripts\/backlog-git\.sh/);
});

test("AGENTS backlog guidance makes Codex workflow setup explicit", () => {
  assert.match(agentsDoc, /Codex implementations should use the shared canon in `docs\/ai\/ticket-workflow\/`/);
  assert.match(agentsDoc, /node scripts\/check-ticket-workflow-setup\.mjs/);
  assert.match(agentsDoc, /`\.\/scripts\/backlog\.sh` CLI wrapper \| Always preferred/);
});

for (const role of roles) {
  test(`${role.slug} Claude wrapper and Codex skill share the same canon`, () => {
    const canonPath = `docs/ai/ticket-workflow/${role.slug}.md`;
    const wrapper = readFileSync(path.join(repoRoot, ".claude", "agents", `${role.claude}.md`), "utf8");
    const skill = readFileSync(path.join(repoRoot, "skills", role.skill, "SKILL.md"), "utf8");
    const skillUi = readFileSync(path.join(repoRoot, "skills", role.skill, "agents", "openai.yaml"), "utf8");

    assert.match(wrapper, new RegExp(canonPath.replaceAll("/", "\\/")));
    assert.match(skill, new RegExp(canonPath.replaceAll("/", "\\/")));
    assert.match(skillUi, new RegExp(`\\$${role.skill}`));
  });
}

test("ticket workflow setup helper resolves sibling backlog paths from the main repo", () => {
  const mainRepo = resolveMainRepoFromGit({
    gitCommonDir: "/Users/example/Documents/righelt/.git",
    topLevel: "/Users/example/.codex/worktrees/123/righelt",
  });

  assert.equal(mainRepo, "/Users/example/Documents/righelt");
  assert.equal(resolveBacklogRepoFromMainRepo(mainRepo), "/Users/example/Documents/righelt-backlog");
  assert.equal(resolveBacklogDirFromMainRepo(mainRepo), "/Users/example/Documents/righelt-backlog/backlog");
});

test("ticket workflow setup helper reports the required readiness checks", () => {
  const report = buildSetupChecks({
    cwd: "/Users/example/.codex/worktrees/123/righelt",
    gitCommonDir: "/Users/example/Documents/righelt/.git",
    topLevel: "/Users/example/.codex/worktrees/123/righelt",
    backlogBin: "/opt/homebrew/bin/backlog",
    backlogRepoExists: true,
    backlogDirExists: true,
    backlogHelpOk: false,
  });

  assert.equal(report.mainRepo, "/Users/example/Documents/righelt");
  assert.deepEqual(
    report.checks.map((check) => check.name),
    ["backlog CLI", "sibling backlog repo", "backlog working directory", "wrapper resolution"],
  );
  assert.equal(report.checks.at(-1)?.ok, false);
});
