import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  fullLanes,
  laneKey,
  catalogDigest,
  SUITES,
  suiteKind,
} from "../catalog.mjs";
import { digest, sealReceipt, verifyFull } from "../receipts.mjs";
import { planForFiles, affectedPlan } from "../plan.mjs";
const identity = { revision: "a", testedTree: "b", sourceFingerprint: "c" };
const make = () =>
  fullLanes().map((l) =>
    sealReceipt({
      version: 1,
      catalog: catalogDigest(),
      lane: laneKey(l),
      suite: l.suite,
      stateMode: ["e2e", "auth-e2e", "auth-controls", "responsive"].includes(
        l.suite,
      )
        ? "real-stack"
        : "controlled",
      kind: suiteKind(l.suite),
      ...identity,
      status: "passed",
      exitCode: 0,
      incomplete: false,
      dirtyDuringRun: false,
      runtime: { node: "22", pnpm: "9.15.9" },
      dependencies: { lockHash: "d", installedLockHash: "e" },
      inventory: { expected: ["test"], missing: [] },
      observations: { total: 1, passed: 1 },
    }),
  );
test("complete exact suite receipts pass", () =>
  assert.equal(verifyFull(make(), identity).status, "passed"));
for (const mutation of [
  "missing",
  "duplicate",
  "stale",
  "interrupted",
  "empty",
  "flaky",
  "environment",
  "dependencies",
  "wrong-mode",
  "wrong-kind",
  "uncompleted",
  "tamper",
])
  test(`gate rejects ${mutation} evidence`, () => {
    const receipts = make();
    let r = { ...receipts[2] };
    if (mutation === "missing") receipts.pop();
    else if (mutation === "duplicate") receipts.push(receipts[0]);
    else {
      delete r.integrity;
      if (mutation === "stale") r.sourceFingerprint = "old";
      if (mutation === "interrupted") r.incomplete = true;
      if (mutation === "empty") r.observations = { total: 0, passed: 0 };
      if (mutation === "flaky")
        r.observations = { total: 1, passed: 1, flaky: 1 };
      if (mutation === "environment")
        r.runtime = { node: "23", pnpm: "9.15.9" };
      if (mutation === "dependencies")
        r.dependencies = { lockHash: "new", installedLockHash: "new" };
      if (mutation === "wrong-kind") r.kind = "check";
      if (mutation === "uncompleted")
        r.observations = { total: 2, passed: 1, uncompleted: 1 };
      if (mutation === "wrong-mode") r.stateMode = "mocked";
      receipts[2] = sealReceipt(r);
      if (mutation === "tamper") receipts[2].exitCode = 1;
    }
    assert.equal(verifyFull(receipts, identity).status, "failed");
  });
test("unknown paths and shared configuration select full inventory", () => {
  for (const file of [
    "unknown.file",
    "pnpm-lock.yaml",
    "scripts/testing/plan.mjs",
  ])
    assert.deepEqual(
      planForFiles([file]).suites,
      SUITES.map((s) => s.id),
    );
  assert.equal(planForFiles(["docs/UX_PRINCIPLES.md"]).advisory, true);
});
test("indirect imports expand selection; ambiguous dynamic import falls back to full", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "righelt-plan-"));
  try {
    const git = (...a) => execFileSync("git", a, { cwd: dir });
    git("init", "-q");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    mkdirSync(`${dir}/apps/web`, { recursive: true });
    mkdirSync(`${dir}/packages/shared-types`, { recursive: true });
    writeFileSync(`${dir}/packages/shared-types/a.mjs`, "export const a=1;");
    writeFileSync(
      `${dir}/apps/web/b.mjs`,
      "export {a} from '../../packages/shared-types/a.mjs';",
    );
    git("add", ".");
    git("commit", "-qm", "base");
    writeFileSync(`${dir}/packages/shared-types/a.mjs`, "export const a=2;");
    const plan = affectedPlan(dir, "HEAD");
    assert.ok(plan.files.includes("apps/web/b.mjs"));
    assert.ok(plan.suites.includes("browser-integration"));
    writeFileSync(`${dir}/apps/web/b.mjs`, "export const b=import(variable);");
    assert.deepEqual(
      affectedPlan(dir, "HEAD").suites,
      SUITES.map((s) => s.id),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("first fixture cause survives cascading exits including exit zero", async () => {
  const { recordUnexpectedExit } = await import("../stack-status.mjs");
  const dir = mkdtempSync(path.join(os.tmpdir(), "righelt-exit-"));
  const prior = process.env.RIGHELT_TEST_STACK_STATUS;
  try {
    process.env.RIGHELT_TEST_STACK_STATUS = path.join(dir, "stack.json");
    recordUnexpectedExit("api", 0, null);
    recordUnexpectedExit("web", 1, null);
    const { readFileSync } = await import("node:fs");
    assert.equal(
      JSON.parse(readFileSync(process.env.RIGHELT_TEST_STACK_STATUS)).label,
      "api",
    );
  } finally {
    if (prior === undefined) delete process.env.RIGHELT_TEST_STACK_STATUS;
    else process.env.RIGHELT_TEST_STACK_STATUS = prior;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CI reuse binds the named suite to its canonical command", async () => {
  const { assertSuiteRequest } = await import(
    "../../validation/suite-ci-evidence.mjs"
  );
  assertSuiteRequest("Unit", { argv: ["pnpm", "test:unit"] });
  assert.throws(() =>
    assertSuiteRequest("Unit", { argv: ["pnpm", "some-other-check"] }),
  );
});

test("partial rerun retains untouched lanes but rejects foreign or ambiguous artifacts", async () => {
  const { selectSuiteArtifacts } = await import("../select-artifacts.mjs");
  const artifact = (name, time) => ({
    name,
    created_at: time,
    workflow_run: { id: 7, head_sha: "head" },
  });
  const old = artifact("suite-node-0-1", "2026-10-10T00:00:00Z"),
    newer = artifact("suite-node-0-2", "2026-10-11T00:00:00Z"),
    untouched = artifact("suite-node-1-1", "2026-10-10T00:00:00Z");
  assert.deepEqual(
    selectSuiteArtifacts([old, newer, untouched], {
      runId: 7,
      headSha: "head",
    }),
    [newer, untouched],
  );
  assert.throws(() =>
    selectSuiteArtifacts([old], { runId: 8, headSha: "head" }),
  );
  assert.throws(() =>
    selectSuiteArtifacts([old, { ...old }], { runId: 7, headSha: "head" }),
  );
});

test("component browser fixture includes the production CSS inventory in order", async () => {
  const { readFileSync } = await import("node:fs");
  const styles = (text) =>
    [...text.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(
      (m) => m[1].replace(/^\.\//, "/apps/web/"),
    );
  const production = styles(
    readFileSync(
      new URL("../../../apps/web/index.html", import.meta.url),
      "utf8",
    ),
  );
  const fixture = styles(
    readFileSync(
      new URL(
        "../../../browser-integration/support/account.html",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(fixture, production);
});
