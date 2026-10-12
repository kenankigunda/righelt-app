import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, lstatSync, readlinkSync } from "node:fs";
import { catalogDigest, fullLanes, laneKey, suiteKind } from "./catalog.mjs";
export const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function sourceIdentity(cwd) {
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
    testedTree: git("rev-parse", "HEAD^{tree}"),
    sourceFingerprint: digest(hashes),
    sourceClean: git("status", "--porcelain") === "",
  };
}
export function sealReceipt(receipt) {
  return { ...receipt, integrity: digest(receipt) };
}
export function verifyFull(
  receipts,
  identity,
  { lanes = fullLanes(), catalog = catalogDigest() } = {},
) {
  const errors = [];
  const environment = receipts[0]?.runtime,
    dependencies = receipts[0]?.dependencies;
  for (const lane of lanes) {
    const key = laneKey(lane),
      matches = receipts.filter((r) => r.lane === key);
    if (matches.length !== 1) {
      errors.push(`${key}: missing or duplicate receipt`);
      continue;
    }
    const { integrity, ...r } = matches[0];
    if (
      integrity !== digest(r) ||
      r.version !== 1 ||
      r.catalog !== catalog ||
      r.status !== "passed" ||
      r.exitCode !== 0 ||
      r.incomplete ||
      r.dirtyDuringRun
    )
      errors.push(`${key}: invalid or incomplete result`);
    for (const field of ["revision", "testedTree", "sourceFingerprint"])
      if (r[field] !== identity[field]) errors.push(`${key}: stale ${field}`);
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
        (["e2e", "auth-e2e", "auth-controls", "responsive"].includes(lane.suite)
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
  const extras = receipts.filter(
    (r) => !lanes.some((l) => laneKey(l) === r.lane),
  );
  if (extras.length)
    errors.push("Unexpected receipts outside the full suite inventory");
  return {
    version: 1,
    status: errors.length ? "failed" : "passed",
    catalog,
    identity,
    errors,
    lanes: lanes.map(laneKey),
  };
}
export function readReceipts(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((f) => String(f).endsWith(".receipt.json"))
    .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
}
