import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { importCatalogCI } from "../../validation/suite-ci-evidence.mjs";
import { fullLanes, laneKey, catalogDigest, suiteKind } from "../catalog.mjs";
import { sourceIdentity, sealReceipt, digest } from "../receipts.mjs";
test("explicit CI artifact credit verifies full inventory, primary logs and canonical commands", async () => {
  const cwd = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "righelt-ci-")),
  );
  try {
    const git = (...args) => execFileSync("git", args, { cwd });
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    await writeFile(path.join(cwd, "source"), "current");
    git("add", ".");
    git("commit", "-qm", "base");
    const identity = sourceIdentity(cwd),
      runtime = { node: "22", pnpm: "9.15.9" },
      dependencies = { lockHash: "a", installedLockHash: "b" },
      raw = Buffer.from("primary log\n");
    const receipts = fullLanes().map((l) =>
      sealReceipt({
        version: 1,
        catalog: catalogDigest(),
        lane: laneKey(l),
        suite: l.suite,
        kind: suiteKind(l.suite),
        stateMode: ["e2e", "auth-e2e", "auth-controls", "responsive"].includes(
          l.suite,
        )
          ? "real-stack"
          : "controlled",
        ...identity,
        runtime,
        dependencies,
        status: "passed",
        exitCode: 0,
        incomplete: false,
        dirtyDuringRun: false,
        inventory: { expected: ["test"], missing: [] },
        observations: { total: 1, passed: 1 },
        logHash: digest(raw),
      }),
    );
    const run = {
      id: 1,
      head_sha: identity.revision,
      run_attempt: 2,
      conclusion: "success",
    };
    const artifacts = receipts.map((r, id) => ({
      id,
      name: `suite-lane-${id}-2`,
      expired: false,
      created_at: new Date(1000 + id).toISOString(),
      workflow_run: { id: 1, head_sha: run.head_sha },
    }));
    const getId = (argv) => Number(/suite-(\d+)\.zip/.exec(argv.join(" "))[1]);
    const api = async () => ({ total_count: artifacts.length, artifacts });
    const call = async (argv) =>
      argv[1] === "-Z1"
        ? "suites/lane/1.receipt.json"
        : JSON.stringify(receipts[getId(argv)]);
    let corrupt = false;
    const execute = async (argv, { log }) => {
      await writeFile(
        log,
        argv[0] === "unzip"
          ? corrupt
            ? Buffer.from("changed")
            : raw
          : Buffer.from("immutable archive"),
      );
      return { output: "", code: 0 };
    };
    const outDir = path.join(cwd, "out");
    await mkdir(outDir);
    // Keep evidence outside the source fingerprint; sourceIdentity is captured before writes.
    const external = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "righelt-ci-artifacts-")),
    );
    try {
      const expected = {
        Unit: { argv: ["pnpm", "test:unit"], runtime, dependencies },
      };
      const options = {
        repository: "owner/repo",
        run,
        cwd,
        outDir: external,
        expected,
        api,
        call,
        execute,
      };
      // Remove untracked output directory before verifying the exact candidate.
      await rm(outDir, { recursive: true });
      const good = await importCatalogCI(options);
      assert.ok(good.receipts.Unit);
      assert.equal(good.receipts.Unit.evidence.length, 2);
      const wrong = await importCatalogCI({
        ...options,
        expected: { Unit: { ...expected.Unit, argv: ["pnpm", "other"] } },
      });
      assert.ok(wrong.rejected.Unit);
      assert.equal(wrong.receipts.Unit, undefined);
      corrupt = true;
      await assert.rejects(importCatalogCI(options), /Primary suite log/);
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
