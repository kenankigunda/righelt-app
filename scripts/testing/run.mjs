import { nodeLaneInventory, verifyInventory } from "./inventory.mjs";
import { partitionIdentity, verifyStressSeeds } from "./partition.mjs";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { catalogDigest, laneKey, suiteById, suiteKind } from "./catalog.mjs";
import {
  classifyFailure,
  detectNonRetryableFailureEvidence,
  digest,
  digestBuffer,
  EVIDENCE_PROFILES,
  sourceIdentity,
  sealReceipt,
} from "./receipts.mjs";
export async function runSuite(
  lane,
  {
    cwd = process.cwd(),
    out = "test-results/suites",
    execute,
    filters = [],
    profile = process.env.RIGHELT_EVIDENCE_PROFILE || EVIDENCE_PROFILES.NIGHTLY_FULL,
    attempt = Number(process.env.RIGHELT_CI_ATTEMPT || 1),
    priorReceiptDigest = process.env.RIGHELT_PRIOR_RECEIPT_DIGEST || null,
  } = {},
) {
  if (![1, 2].includes(attempt)) throw Error(`Invalid test attempt: ${attempt}`);
  if (!Object.values(EVIDENCE_PROFILES).includes(profile))
    throw Error(`Invalid evidence profile: ${profile}`);
  if ((attempt === 1) !== (priorReceiptDigest === null))
    throw Error("Only attempt 2 may name a prior receipt digest");
  const suite = suiteById(lane.suite),
    key = laneKey(lane),
    dir = path.resolve(cwd, out, key.replace(/[^\w.-]/g, "-"));
  await mkdir(dir, { recursive: true });
  const before = sourceIdentity(cwd),
    observed = path.join(dir, "observations.json"),
    stack = path.join(dir, "stack.json");
  const args = [suite.script];
  if (lane.project) args.push(`--project=${lane.project}`);
  if (suite.browser && lane.shards > 1) args.push(`--shard=${lane.shard}/${lane.shards}`);
  if (!suite.browser) partitionIdentity(lane);
  if (suite.id === "sync-stress" && process.env.T114_SEED !== undefined)
    throw Error("Seed replay cannot produce gate evidence");
  args.push(...filters);
  const nodeTest =
    !suite.browser && !["typecheck", "generated"].includes(suite.id);
  if (nodeTest)
    args.push(
      "--",
      "--reporter",
      "spec",
      "--reporter",
      path.resolve(cwd, "scripts/testing/node-reporter.mjs"),
      "--reporter-destination",
      "stdout",
      "--reporter-destination",
      path.join(dir, "events.txt"),
    );
  const env = {
    ...process.env,
    RIGHELT_TEST_OBSERVATIONS: observed,
    RIGHELT_TEST_REVISION: before.revision,
    RIGHELT_NODE_SHARD: String(lane.shard),
    RIGHELT_NODE_SHARDS: String(lane.shards),
    RIGHELT_TEST_STACK_STATUS: stack,
    PLAYWRIGHT_OUTPUT_DIR: path.join(dir, "debug"),
    PLAYWRIGHT_JUNIT_OUTPUT_FILE: path.join(dir, "results.xml"),
  };
  // Each CI job is its own host and database. Local full checks run sequentially.
  const startedAt = new Date().toISOString(),
    started = performance.now();
  const log = path.join(dir, "output.log");
  const launch =
    execute ??
    (async () => {
      const { createWriteStream } = await import("node:fs");
      const file = createWriteStream(log);
      return new Promise((resolve) => {
        const child = spawn("pnpm", args, {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        for (const stream of [child.stdout, child.stderr])
          stream.on("data", (c) => {
            file.write(c);
            process.stdout.write(c);
          });
        child.once("error", (e) => {
          file.end(String(e));
          resolve({ code: 1, error: String(e) });
        });
        child.once("close", (code, signal) =>
          file.end(() => resolve({ code: code ?? 1, signal })),
        );
      });
    });
  // Never reuse observations from a prior attempt.
  const { rm } = await import("node:fs/promises");
  await rm(observed, { force: true });
  await rm(stack, { force: true });
  let browserInventory = null;
  const configs = {
    "browser-contract": "playwright.browser-contract.config.mjs",
    "guest-smoke": "playwright.guest-smoke.config.mjs",
    "auth-smoke": "playwright.auth-smoke.config.mjs",
    "storage-lifecycle": "playwright.storage-lifecycle.config.mjs",
    "browser-integration": "playwright.browser.config.mjs",
    e2e: "playwright.config.mjs",
    "auth-e2e": "playwright.auth.config.mjs",
    "auth-controls": "playwright.auth-controls.config.mjs",
    responsive: "playwright.validation.config.mjs",
  };
  if (configs[suite.id] && !execute) {
    const inventoryPath = path.join(dir, "inventory.json");
    const inventoryArgs = [
      "exec",
      "playwright",
      "test",
      "--config",
      configs[suite.id],
      "--list",
      "--reporter",
      path.resolve(cwd, "scripts/testing/browser-reporter.mjs"),
    ];
    if (lane.project) inventoryArgs.push(`--project=${lane.project}`);
    if (lane.shards > 1)
      inventoryArgs.push(`--shard=${lane.shard}/${lane.shards}`);
    execFileSync("pnpm", inventoryArgs, {
      cwd,
      env: { ...env, RIGHELT_TEST_OBSERVATIONS: inventoryPath },
      stdio: "pipe",
    });
    browserInventory = JSON.parse(
      await readFile(inventoryPath, "utf8"),
    ).inventory;
  }
  const result = await launch({ args, env, cwd, log });
  const logBytes = await readFile(log).catch(() => Buffer.from(""));
  const nonRetryableFailureEvidence = detectNonRetryableFailureEvidence(
    result.error,
    logBytes,
  );
  const after = sourceIdentity(cwd);
  let observations = null,
    stackState = null;
  try {
    observations = JSON.parse(await readFile(observed, "utf8"));
  } catch {}
  try {
    stackState = JSON.parse(await readFile(stack, "utf8"));
  } catch {}
  // Portable receipt paths must not retain the producer's absolute checkout root.
  if (observations?.tests) observations.tests = observations.tests.map(test => ({...test,
    file: test.file && path.isAbsolute(test.file) ? path.relative(cwd, test.file) : test.file,
  }));
  const kind = suiteKind(suite.id);
  const expectedFiles = nodeLaneInventory(suite.id, cwd, lane);
  const seedInventory = suite.id === "sync-stress" ? verifyStressSeeds(observations, lane) : null;
  const inventory = expectedFiles
    ? verifyInventory(expectedFiles, observations, cwd)
    : browserInventory
      ? {
          expected: browserInventory,
          missing: browserInventory.filter(
            (id) => !observations?.inventory?.includes(id),
          ),
          unexpected: (observations?.inventory ?? []).filter(
            (id) => !browserInventory.includes(id),
          ),
        }
      : null;
  const incomplete = result.code === 75 || Boolean(stackState?.unexpectedExit);
  const passed =
    result.code === 0 &&
    !incomplete &&
    before.sourceFingerprint === after.sourceFingerprint &&
    (kind !== "tests" || observations?.passed > 0) &&
    !observations?.failed &&
    !observations?.flaky &&
    !observations?.uncompleted &&
    !inventory?.missing.length &&
    !inventory?.unexpected?.length &&
    !seedInventory?.missing.length && !seedInventory?.unexpected.length && !seedInventory?.duplicates.length && !seedInventory?.notPassed.length;
  const dirtyDuringRun = before.sourceFingerprint !== after.sourceFingerprint;
  const failureKind = passed
    ? null
    : classifyFailure({
        result,
        observations,
        inventory,
        stack: stackState,
        nonRetryableFailureEvidence,
        dirtyDuringRun,
      });
  const outcome = passed
    ? attempt === 2
      ? "infra-recovered"
      : "passed"
    : incomplete
      ? "incomplete"
      : "failed";
  const hashFile = async (f) => digest(await readFile(path.join(cwd, f)));
  const runtime = {
    node: process.version,
    pnpm: execFileSync("pnpm", ["--version"], { cwd, encoding: "utf8" }).trim(),
    platform: process.platform,
    arch: process.arch,
    playwright: JSON.parse(
      await readFile(
        path.join(cwd, "node_modules/@playwright/test/package.json"),
        "utf8",
      ),
    ).version,
  };
  const receipt = sealReceipt({
    version: 2,
    evidenceProfile: profile,
    attempt,
    priorReceiptDigest,
    catalog: catalogDigest(),
    lane: key,
    suite: suite.id,
    kind,
    stateMode: ["e2e", "guest-smoke", "auth-smoke", "storage-lifecycle", "auth-e2e", "auth-controls", "responsive"].includes(
      suite.id,
    )
      ? "real-stack"
      : "controlled",
    ...before,
    runtime,
    dependencies: {
      lockHash: await hashFile("pnpm-lock.yaml"),
      installedLockHash: await hashFile("node_modules/.pnpm/lock.yaml"),
    },
    status: passed ? "passed" : incomplete ? "incomplete" : "failed",
    outcome,
    failureKind,
    exitCode: result.code,
    signal: result.signal ?? null,
    incomplete,
    dirtyDuringRun,
    startedAt,
    durationMs: performance.now() - started,
    observations,
    inventory,
    seedInventory,
    stack: stackState,
    nonRetryableFailureEvidence,
    log,
    logHash: digestBuffer(logBytes),
  });
  const file = path.join(dir, `${Date.now()}.receipt.json`);
  await writeFile(file, JSON.stringify(receipt, null, 2));
  return receipt;
}
