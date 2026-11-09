import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFailure,
  detectNonRetryableFailureEvidence,
  EVIDENCE_PROFILES,
  FAILURE_KINDS,
  isRetryableReceipt,
  sealReceipt,
  shouldDeferInfrastructureRetry,
  verifyFull,
} from "../receipts.mjs";
import { laneKey, suiteKind } from "../catalog.mjs";

const lane = { suite: "engine-unit", project: null, shard: 1, shards: 1 };
const catalog = "catalog";
const identity = {
  revision: "revision",
  baseRevision: "base",
  testedTree: "tree",
  sourceFingerprint: "source",
};
const runtime = { node: "22", pnpm: "9.15.9", playwright: "1" };
const dependencies = { lockHash: "lock", installedLockHash: "installed" };

const receipt = (overrides = {}) =>
  sealReceipt({
    version: 2,
    evidenceProfile: EVIDENCE_PROFILES.PR_GATE,
    attempt: 1,
    priorReceiptDigest: null,
    catalog,
    lane: laneKey(lane),
    suite: lane.suite,
    kind: suiteKind(lane.suite),
    stateMode: "controlled",
    ...identity,
    runtime,
    dependencies,
    status: "passed",
    outcome: "passed",
    failureKind: null,
    exitCode: 0,
    signal: null,
    incomplete: false,
    dirtyDuringRun: false,
    inventory: { expected: ["test"], missing: [], unexpected: [] },
    observations: { total: 1, passed: 1, failed: 0, flaky: 0, uncompleted: 0 },
    ...overrides,
  });

const verify = (receipts, overrides = {}) =>
  verifyFull(receipts, identity, {
    lanes: [lane],
    catalog,
    profile: EVIDENCE_PROFILES.PR_GATE,
    allowLegacy: false,
    ...overrides,
  });

test("profile-bound version two evidence passes", () => {
  assert.equal(verify([receipt()]).status, "passed");
});

for (const [name, mutation] of [
  ["wrong profile", { evidenceProfile: EVIDENCE_PROFILES.NIGHTLY_FULL }],
  ["missing profile", { evidenceProfile: null }],
  ["missing base revision", { baseRevision: undefined }],
  ["null base revision", { baseRevision: null }],
  ["stale base revision", { baseRevision: "other" }],
  ["incomplete outcome", { status: "incomplete", outcome: "incomplete", incomplete: true, exitCode: 75, failureKind: FAILURE_KINDS.RESOURCE_PRESSURE }],
])
  test(`gate rejects ${name}`, () => {
    assert.equal(verify([receipt(mutation)]).status, "failed");
  });

test("only typed owned failures are retry eligible", () => {
  const owned = receipt({
    status: "incomplete",
    outcome: "incomplete",
    failureKind: FAILURE_KINDS.OWNED_STACK_EXIT,
    stack: { unexpectedExit: true, label: "api" },
    exitCode: 1,
    incomplete: true,
    observations: { total: 0, passed: 0, failed: 0, flaky: 0, uncompleted: 0 },
  });
  assert.equal(isRetryableReceipt(owned), true);
  const pressure = receipt({
    status: "incomplete",
    outcome: "incomplete",
    failureKind: FAILURE_KINDS.RESOURCE_PRESSURE,
    exitCode: 75,
    incomplete: true,
    observations: { total: 0, passed: 0, failed: 0, flaky: 0, uncompleted: 0 },
  });
  assert.equal(isRetryableReceipt(pressure), true);
  for (const value of [
    receipt({ status: "failed", outcome: "failed", failureKind: FAILURE_KINDS.UNKNOWN, exitCode: 1 }),
    receipt({ status: "failed", outcome: "failed", failureKind: FAILURE_KINDS.ASSERTION, exitCode: 1, observations: { total: 1, passed: 0, failed: 1 } }),
    receipt({ status: "failed", outcome: "failed", failureKind: FAILURE_KINDS.INVENTORY, exitCode: 1, inventory: { expected: ["test"], missing: ["test"], unexpected: [] } }),
  ])
    assert.equal(isRetryableReceipt(value), false);
});

test("linked clean retry passes as infra recovered and preserves both attempts", () => {
  const first = receipt({
    status: "incomplete",
    outcome: "incomplete",
    failureKind: FAILURE_KINDS.OWNED_STACK_EXIT,
    stack: { unexpectedExit: true, label: "api" },
    exitCode: 1,
    incomplete: true,
    observations: { total: 0, passed: 0, failed: 0, flaky: 0, uncompleted: 0 },
  });
  const second = receipt({
    attempt: 2,
    priorReceiptDigest: first.integrity,
    outcome: "infra-recovered",
  });
  const result = verify([first, second]);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.recovered, [laneKey(lane)]);
});

test("an attempt two receipt can never pass without its first attempt", () => {
  assert.equal(
    verify([
      receipt({
        attempt: 2,
        priorReceiptDigest: "missing",
        outcome: "infra-recovered",
      }),
    ]).status,
    "failed",
  );
});

test("CI defers only an enabled first typed infrastructure failure", () => {
  const first = receipt({
    status: "incomplete",
    outcome: "incomplete",
    failureKind: FAILURE_KINDS.OWNED_STACK_EXIT,
    stack: { unexpectedExit: true, label: "api" },
    exitCode: 1,
    incomplete: true,
    observations: { total: 0, passed: 0, failed: 0, flaky: 0, uncompleted: 0 },
  });
  assert.equal(shouldDeferInfrastructureRetry(first, true), true);
  assert.equal(shouldDeferInfrastructureRetry(first, false), false);
  const second = receipt({
    attempt: 2,
    priorReceiptDigest: first.integrity,
    status: "incomplete",
    outcome: "incomplete",
    failureKind: FAILURE_KINDS.OWNED_STACK_EXIT,
    stack: { unexpectedExit: true, label: "api" },
    exitCode: 1,
    incomplete: true,
    observations: { total: 0, passed: 0, failed: 0, flaky: 0, uncompleted: 0 },
  });
  assert.equal(shouldDeferInfrastructureRetry(second, true), false);
});

for (const [name, mutateFirst, mutateSecond] of [
  ["unlinked retry", {}, { priorReceiptDigest: "wrong" }],
  ["foreign first profile", { evidenceProfile: EVIDENCE_PROFILES.NIGHTLY_FULL }, {}],
  ["assertion retry", { failureKind: FAILURE_KINDS.ASSERTION, incomplete: false, status: "failed", outcome: "failed", observations: { total: 1, passed: 0, failed: 1 } }, {}],
  ["ordinary second pass", {}, { outcome: "passed" }],
  ["third or duplicate attempt", {}, { attempt: 3 }],
])
  test(`gate rejects ${name}`, () => {
    const first = receipt({
      status: "incomplete",
      outcome: "incomplete",
      failureKind: FAILURE_KINDS.OWNED_STACK_EXIT,
      stack: { unexpectedExit: true, label: "api" },
      exitCode: 1,
      incomplete: true,
      observations: { total: 0, passed: 0, failed: 0, flaky: 0, uncompleted: 0 },
      ...mutateFirst,
    });
    const second = receipt({
      attempt: 2,
      priorReceiptDigest: first.integrity,
      outcome: "infra-recovered",
      ...mutateSecond,
    });
    assert.equal(verify([first, second]).status, "failed");
  });

test("failure classification is conservative", () => {
  assert.equal(classifyFailure({ result: { code: 75 } }), FAILURE_KINDS.RESOURCE_PRESSURE);
  assert.equal(
    classifyFailure({ result: { code: 1 }, stack: { unexpectedExit: true } }),
    FAILURE_KINDS.OWNED_STACK_EXIT,
  );
  assert.equal(
    classifyFailure({ result: { code: 1 }, observations: { failed: 1 }, stack: { unexpectedExit: true } }),
    FAILURE_KINDS.ASSERTION,
  );
  assert.equal(
    classifyFailure({ result: { code: 1 }, inventory: { missing: ["test"] } }),
    FAILURE_KINDS.INVENTORY,
  );
  assert.equal(
    classifyFailure({
      result: { code: 75 },
      nonRetryableFailureEvidence: ["timeout"],
    }),
    FAILURE_KINDS.ASSERTION,
  );
  assert.equal(classifyFailure({ result: { code: 1 } }), FAILURE_KINDS.UNKNOWN);
});

test("functional failure text is never retryable infrastructure evidence", () => {
  assert.deepEqual(
    detectNonRetryableFailureEvidence(
      "HTTP status 503",
      "request timed out\nReferenceError: missingValue\nflaky",
    ),
    ["http-5xx", "timeout", "reference-error", "playwright-flaky"],
  );
  const candidate = receipt({
    status: "incomplete",
    outcome: "incomplete",
    failureKind: FAILURE_KINDS.OWNED_STACK_EXIT,
    stack: { unexpectedExit: true, label: "api" },
    exitCode: 1,
    incomplete: true,
    nonRetryableFailureEvidence: ["http-5xx"],
    observations: { total: 0, passed: 0, failed: 0, flaky: 0, uncompleted: 0 },
  });
  assert.equal(isRetryableReceipt(candidate), false);
});

test("ordinary server logs still classify every HTTP 5xx as functional evidence", () => {
  assert.deepEqual(
    detectNonRetryableFailureEvidence(
      "GET /api/games 503 Service Unavailable",
      "500 Internal Server Error",
    ),
    ["http-5xx"],
  );
});

