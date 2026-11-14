import { createHash } from "node:crypto";
import { verifyStressSeeds } from "./partition.mjs";
import { nodeInventory, verifyInventory } from "./inventory.mjs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, lstatSync, readlinkSync } from "node:fs";
import { catalogDigest, fullLanes, laneKey, suiteKind } from "./catalog.mjs";
export const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const bufferChunkBytes = 16 * 1024;
const typedArrayLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), "length",
).get;

/** Trusted Buffer contract: hash the legacy STANDARD Buffer JSON encoding,
 * ignoring any own, prototype or subclass toJSON override. This is deliberately
 * separate from digest(), which retains arbitrary JSON serialization behavior.
 * Call only for stable, locally read bytes (for example readFile(log)).
 */
export function digestBuffer(value) {
  if (!Buffer.isBuffer(value)) throw new TypeError("digestBuffer requires a Buffer");
  // Use the native length, not a possibly shadowed instance/prototype property.
  const length = typedArrayLength.call(value);
  const hash = createHash("sha256");
  hash.update('{"type":"Buffer","data":[');
  for (let offset = 0; offset < length; offset += bufferChunkBytes) {
    const end = Math.min(offset + bufferChunkBytes, length);
    let chunk = "";
    for (let index = offset; index < end; index++)
      chunk += `${index === 0 ? "" : ","}${value[index]}`;
    hash.update(chunk);
  }
  return hash.update("]}").digest("hex");
}
export function sourceIdentity(
  cwd,
  { base = process.env.RIGHELT_TEST_BASE_REVISION || null } = {},
) {
  const git = (...a) =>
    execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
  const files = [
    ...new Set([
      ...git("ls-files", "-z").split("\0"),
      ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
    ]),
  ]
    .filter(Boolean)
    .sort();
  const hashes = files.map((f) => {
    try {
      return [
        f,
        digest(
          lstatSync(`${cwd}/${f}`).isSymbolicLink()
            ? readlinkSync(`${cwd}/${f}`)
            : readFileSync(`${cwd}/${f}`),
        ),
      ];
    } catch (e) {
      if (e.code === "ENOENT") return [f, "deleted"];
      throw e;
    }
  });
  return {
    revision: git("rev-parse", "HEAD"),
    baseRevision: base ? git("rev-parse", base) : null,
    testedTree: git("rev-parse", "HEAD^{tree}"),
    sourceFingerprint: digest(hashes),
    sourceClean: git("status", "--porcelain") === "",
  };
}
export function sealReceipt(receipt) {
  return { ...receipt, integrity: digest(receipt) };
}
export const EVIDENCE_PROFILES = Object.freeze({
  PR_GATE: "pr-gate",
  NIGHTLY_FULL: "nightly-full",
});
export const FAILURE_KINDS = Object.freeze({
  ASSERTION: "assertion",
  INVENTORY: "inventory",
  OWNED_STACK_EXIT: "owned-stack-exit",
  RESOURCE_PRESSURE: "resource-pressure",
  UNKNOWN: "unknown",
});
const NON_RETRYABLE_FAILURE_PATTERNS = Object.freeze([
  ["http-5xx", /(?:\b(?:HTTP\s*(?:status\s*)?|status(?:\s+code)?\s*[:=]?\s*)5\d\d\b|\b5\d\d\s+(?:Internal\s+Server\s+Error|Bad\s+Gateway|Service\s+Unavailable|Gateway\s+Timeout)\b|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+5\d\d\b)/i],
  ["timeout", /\b(?:time(?:d)?\s*out|timeout)\b/i],
  ["reference-error", /\bReferenceError\b/],
  ["playwright-flaky", /\bflaky\b/i],
]);

export function detectNonRetryableFailureEvidence(...values) {
  const text = values
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value))
    .join("\n");
  return NON_RETRYABLE_FAILURE_PATTERNS.filter(([, pattern]) =>
    pattern.test(text),
  ).map(([kind]) => kind);
}

export function classifyFailure({
  result,
  observations,
  inventory,
  stack,
  nonRetryableFailureEvidence = [],
  dirtyDuringRun = false,
}) {
  if (inventory?.missing?.length || inventory?.unexpected?.length)
    return FAILURE_KINDS.INVENTORY;
  if (
    nonRetryableFailureEvidence.length ||
    observations?.failed ||
    observations?.unexpected ||
    observations?.flaky ||
    observations?.uncompleted
  )
    return FAILURE_KINDS.ASSERTION;
  if (result.code === 75) return FAILURE_KINDS.RESOURCE_PRESSURE;
  if (stack?.unexpectedExit) return FAILURE_KINDS.OWNED_STACK_EXIT;
  if (dirtyDuringRun) return FAILURE_KINDS.UNKNOWN;
  return FAILURE_KINDS.UNKNOWN;
}

const receiptBody = (receipt) => {
  const { integrity, ...body } = receipt;
  return body;
};
export const hasValidIntegrity = (receipt) =>
  Boolean(receipt?.integrity) && receipt.integrity === digest(receiptBody(receipt));

export function isRetryableReceipt(receipt) {
  if (
    receipt?.version !== 2 ||
    !hasValidIntegrity(receipt) ||
    receipt.attempt !== 1 ||
    receipt.priorReceiptDigest !== null ||
    !["failed", "incomplete"].includes(receipt.status) ||
    !["failed", "incomplete"].includes(receipt.outcome) ||
    ![
      FAILURE_KINDS.OWNED_STACK_EXIT,
      FAILURE_KINDS.RESOURCE_PRESSURE,
    ].includes(receipt.failureKind)
  )
    return false;
  if (
    (receipt.failureKind === FAILURE_KINDS.OWNED_STACK_EXIT &&
      !receipt.stack?.unexpectedExit) ||
    (receipt.failureKind === FAILURE_KINDS.RESOURCE_PRESSURE &&
      receipt.exitCode !== 75)
  )
    return false;
  if (
    receipt.observations?.failed ||
    receipt.observations?.unexpected ||
    receipt.observations?.flaky ||
    receipt.observations?.uncompleted ||
    receipt.nonRetryableFailureEvidence?.length ||
    receipt.inventory?.missing?.length ||
    receipt.inventory?.unexpected?.length
  )
    return false;
  return true;
}

export const shouldDeferInfrastructureRetry = (receipt, enabled) =>
  enabled && receipt?.attempt === 1 && isRetryableReceipt(receipt);

function selectLaneReceipt(matches, key, errors) {
  if (matches.length === 1) return matches[0];
  if (matches.length !== 2) {
    errors.push(`${key}: missing or duplicate receipt`);
    return null;
  }
  const [first, second] = [...matches].sort(
    (a, b) => Number(a.attempt ?? 0) - Number(b.attempt ?? 0),
  );
  const sameContext = [
    "evidenceProfile",
    "catalog",
    "lane",
    "suite",
    "kind",
    "stateMode",
    "revision",
    "baseRevision",
    "testedTree",
    "sourceFingerprint",
  ].every((field) => first[field] === second[field]);
  if (
    first.attempt !== 1 ||
    second.attempt !== 2 ||
    !isRetryableReceipt(first) ||
    second.priorReceiptDigest !== first.integrity ||
    second.outcome !== "infra-recovered" ||
    second.failureKind !== null ||
    !sameContext ||
    digest(first.runtime) !== digest(second.runtime) ||
    digest(first.dependencies) !== digest(second.dependencies)
  ) {
    errors.push(`${key}: invalid or unlinked retry evidence`);
    return null;
  }
  return second;
}

export function verifyFull(
  receipts,
  identity,
  {
    lanes = fullLanes(),
    catalog = catalogDigest(),
    profile = null,
    allowLegacy = true,
    cwd = process.cwd(),
  } = {},
) {
  const errors = [];
  const environment = receipts[0]?.runtime,
    dependencies = receipts[0]?.dependencies;
  const toolingFiles = [];
  for (const lane of lanes) {
    const key = laneKey(lane),
      matches = receipts.filter((r) => r.lane === key);
    const selected = selectLaneReceipt(matches, key, errors);
    if (!selected) continue;
    const { integrity, ...r } = selected;
    if (lane.suite === "tooling" && lane.shards > 1) {
      const expected = r.inventory?.expected ?? [];
      const observed = verifyInventory(expected, r.observations, cwd);
      const passed = verifyInventory(expected, {tests:(r.observations?.tests ?? []).filter(test => test.status === "passed")}, cwd);
      if (new Set(expected).size !== expected.length || observed.unexpected.length || passed.missing.length || (r.observations?.tests ?? []).some(test => !["passed", "skipped"].includes(test.status)))
        errors.push(`${key}: tooling partition inventory mismatch`);
      toolingFiles.push(...expected);
    }
    if (lane.suite === "sync-stress" && lane.shards > 1) {
      const seeds = verifyStressSeeds(r.observations, lane);
      if (seeds.missing.length || seeds.unexpected.length || seeds.duplicates.length || seeds.notPassed.length)
        errors.push(`${key}: stress seed inventory mismatch`);
    }
    const isLegacy = r.version === 1;
    if (
      integrity !== digest(r) ||
      (!isLegacy && r.version !== 2) ||
      (isLegacy && !allowLegacy) ||
      r.catalog !== catalog ||
      r.status !== "passed" ||
      (!isLegacy && !["passed", "infra-recovered"].includes(r.outcome)) ||
      (!isLegacy && r.failureKind !== null) ||
      (!isLegacy && ![1, 2].includes(r.attempt)) ||
      (!isLegacy && r.attempt === 2 && matches.length !== 2) ||
      (!isLegacy && r.outcome === "infra-recovered" && r.attempt !== 2) ||
      (!isLegacy && r.outcome === "passed" && r.priorReceiptDigest !== null) ||
      r.exitCode !== 0 ||
      r.incomplete ||
      r.dirtyDuringRun
    )
      errors.push(`${key}: invalid or incomplete result`);
    if (!isLegacy && (!r.evidenceProfile || r.baseRevision === undefined))
      errors.push(`${key}: evidence profile or base revision missing`);
    if (profile && !r.baseRevision)
      errors.push(`${key}: required base revision missing`);
    if (profile && (isLegacy || r.evidenceProfile !== profile))
      errors.push(`${key}: wrong evidence profile`);
    for (const field of [
      "revision",
      "baseRevision",
      "testedTree",
      "sourceFingerprint",
    ]) {
      if (
        (!isLegacy || field !== "baseRevision") &&
        r[field] !== identity[field]
      )
        errors.push(`${key}: stale ${field}`);
    }
    if (
      !r.runtime?.node ||
      !r.runtime?.pnpm ||
      !r.dependencies?.lockHash ||
      !r.dependencies?.installedLockHash
    )
      errors.push(`${key}: environment identity missing`);
    if (
      digest(r.runtime) !== digest(environment) ||
      digest(r.dependencies) !== digest(dependencies)
    )
      errors.push(`${key}: incompatible environment or dependencies`);
    if (
      r.suite !== lane.suite ||
      r.stateMode !==
        (["e2e", "guest-smoke", "auth-smoke", "storage-lifecycle", "auth-e2e", "auth-controls", "responsive"].includes(lane.suite)
          ? "real-stack"
          : "controlled")
    )
      errors.push(`${key}: wrong suite or state mode`);
    if (r.inventory?.missing?.length || r.inventory?.unexpected?.length)
      errors.push(`${key}: test inventory mismatch`);
    if (
      suiteKind(lane.suite) === "tests" &&
      lane.suite !== "performance" &&
      !r.inventory?.expected?.length
    )
      errors.push(`${key}: expected test inventory missing`);
    if (
      r.observations?.failed ||
      r.observations?.unexpected ||
      r.observations?.flaky ||
      r.observations?.uncompleted
    )
      errors.push(`${key}: failed or repeat-pass tests`);
    if (r.kind !== suiteKind(lane.suite))
      errors.push(`${key}: wrong result kind`);
    if (
      suiteKind(lane.suite) === "tests" &&
      (!r.observations?.total || !r.observations?.passed)
    )
      errors.push(`${key}: no completed tests`);
  }
  if (lanes.some(lane => lane.suite === "tooling" && lane.shards > 1)) {
    const expected = nodeInventory("tooling", cwd).map(file => path.relative(cwd, file)).sort();
    if (JSON.stringify([...toolingFiles].sort()) !== JSON.stringify(expected))
      errors.push("tooling: incomplete or overlapping partition coverage");
  }
  const extras = receipts.filter(
    (r) => !lanes.some((l) => laneKey(l) === r.lane),
  );
  if (extras.length)
    errors.push("Unexpected receipts outside the full suite inventory");
  return {
    version: 2,
    status: errors.length ? "failed" : "passed",
    catalog,
    profile,
    identity,
    errors,
    lanes: lanes.map(laneKey),
    recovered: receipts
      .filter((receipt) => receipt.outcome === "infra-recovered")
      .map((receipt) => receipt.lane),
  };
}
export function readReceipts(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((f) => String(f).endsWith(".receipt.json"))
    .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
}
