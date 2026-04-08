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
  { slug: "product-manager", skill: "ticket-product-manager", claude: "product-manager" },
  { slug: "ux-designer", skill: "ticket-ux-designer", claude: "ux-designer" },
  { slug: "architect", skill: "ticket-architect", claude: "architect" },
  { slug: "eng", skill: "ticket-eng", claude: "eng" },
  { slug: "tester", skill: "ticket-tester", claude: "tester" },
];

test("ticket workflow doc points both Claude and Codex at the shared canon", () => {
  assert.match(workflowDoc, /docs\/ai\/ticket-workflow\/README\.md/);
  assert.match(workflowDoc, /docs\/ai\/ticket-workflow\/lead\.md/);
  assert.match(workflowDoc, /docs\/ai\/ticket-workflow\/product-manager\.md/);
  assert.match(workflowDoc, /docs\/ai\/ticket-workflow\/ux-designer\.md/);
  assert.match(workflowDoc, /docs\/ai\/UX_VALIDATION_WORKFLOW\.md/);
  assert.match(workflowDoc, /skills\/ticket-lead\/SKILL\.md/);
  assert.match(workflowDoc, /node scripts\/check-ticket-workflow-setup\.mjs/);
  assert.match(workflowDoc, /scripts\/backlog\.sh/);
  assert.match(workflowDoc, /scripts\/backlog-git\.sh/);
  assert.match(workflowDoc, /backlog\/docs\/TEST_PLAN_TEMPLATE\.md/);
});

test("AGENTS backlog guidance makes Codex workflow setup explicit", () => {
  assert.match(agentsDoc, /Codex implementations should use the shared canon in `docs\/ai\/ticket-workflow\/`/);
  assert.match(agentsDoc, /node scripts\/check-ticket-workflow-setup\.mjs/);
  assert.match(agentsDoc, /`\.\/scripts\/backlog\.sh` CLI wrapper \| Always preferred/);
  assert.match(agentsDoc, /`Tkpm \[t-###\]`/);
  assert.match(agentsDoc, /`Tkuxd \[t-###\]`/);
  assert.doesNotMatch(agentsDoc, /`Tkpo \[t-###\]`/);
});

test("ticket workflow stages and routing reflect PM, UXD, and Architect planning", () => {
  assert.match(workflowDoc, /`To Do` → `Spec` → `Visual Design` → `Eng Planning` → `Ready for execution`/);
  assert.match(workflowDoc, /\| `feature` \| PM \| UXD \| Architect \|/);
  assert.match(workflowDoc, /\| `bug` \| PM \| UXD \| Architect \|/);
  assert.match(workflowDoc, /\| `improvement` \| \*\*Skipped\*\* \| \*\*Skipped\*\* \| Architect \|/);
  assert.doesNotMatch(workflowDoc, /product-owner/);
});

test("tester workflow documents automation-first UX validation expectations", () => {
  const testerCanon = readFileSync(path.join(repoRoot, "docs", "ai", "ticket-workflow", "tester.md"), "utf8");
  const uxValidationDoc = readFileSync(path.join(repoRoot, "docs", "ai", "UX_VALIDATION_WORKFLOW.md"), "utf8");
  const testerSkill = readFileSync(path.join(repoRoot, "skills", "ticket-tester", "SKILL.md"), "utf8");

  assert.match(testerCanon, /UX Proof Matrix/);
  assert.match(testerCanon, /UX Principle Coverage/);
  assert.match(testerCanon, /docs\/ai\/UX_VALIDATION_WORKFLOW\.md/);
  assert.match(testerSkill, /UX Proof Matrix/);
  assert.match(uxValidationDoc, /semantic proof/i);
  assert.match(uxValidationDoc, /geometry proof/i);
  assert.match(uxValidationDoc, /visual proof/i);
  assert.match(uxValidationDoc, /stability and responsiveness proof/i);
  assert.match(uxValidationDoc, /behavioral proof/i);
});

test("UX canon and UX designer guidance use the new UX principles doc and text-first clarification", () => {
  const uxdCanon = readFileSync(path.join(repoRoot, "docs", "ai", "ticket-workflow", "ux-designer.md"), "utf8");
  const uxdSkill = readFileSync(path.join(repoRoot, "skills", "ticket-ux-designer", "SKILL.md"), "utf8");
  const uxPrinciplesDoc = readFileSync(path.join(repoRoot, "docs", "UX_PRINCIPLES.md"), "utf8");

  assert.match(uxdCanon, /docs\/UX_PRINCIPLES\.md/);
  assert.match(uxdSkill, /Do not request new mocks for ticket planning\./);
  assert.match(uxdCanon, /text-first clarification/i);
  assert.match(uxdCanon, /current product as a fallback/i);
  assert.match(uxPrinciplesDoc, /Do not ask the human to create new mocks for ticket planning\./);
  assert.match(uxPrinciplesDoc, /screenshot of the current product as a fallback/i);
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
