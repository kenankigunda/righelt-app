import path from "node:path";

export const STRESS_SEED_COUNT = 100;
export function partitionIdentity({ shard = 1, shards = 1 } = {}) {
  if (![1, 4].includes(shards) || !Number.isInteger(shard) || shard < 1 || shard > shards)
    throw Error("Expected partition 1/1 or 1..4/4");
  return { shard, shards };
}
export function stressSeeds(lane = {}, replay) {
  const { shard, shards } = partitionIdentity(lane);
  if (replay !== undefined) {
    if (shards !== 1 || !/^([1-9]\d?|100)$/.test(String(replay)))
      throw Error("Seed replay requires one valid unpartitioned seed");
    return [Number(replay)];
  }
  return Array.from({ length: STRESS_SEED_COUNT }, (_, i) => i + 1)
    .filter(seed => (seed - 1) % shards === shard - 1);
}
export const stressTestName = seed => `S-01 fixed seed ${seed}: 300 command/storage/network/restart/socket events`;
// Fixed coarse weights from retained CI timings. New files join automatically.
// They affect assignment only, never whether a file is required.
const seconds = {
  "scripts/validation/test/streamlined.test.mjs": 82,
  "scripts/resources/test/supervisor.test.mjs": 55,
  "scripts/validation/test/plan-execution.test.mjs": 39,
  "scripts/validation/test/ci-credit-orchestration.test.mjs": 38,
  "scripts/testing/test/ci-import.test.mjs": 30,
  "scripts/validation/test/account-orchestration.test.mjs": 27,
  "scripts/validation/test/orchestration.test.mjs": 25,
  "scripts/resources/test/auth-stack.test.mjs": 23,
  "scripts/testing/test/miniflare-loopback-keepalive.test.mjs": 8,
  "scripts/testing/test/mobile-receipt-poll.test.mjs": 7,
};
export function toolingFiles(files, lane = {}, cwd = process.cwd()) {
  const { shard, shards } = partitionIdentity(lane);
  const weight = file => seconds[path.relative(cwd, file).split(path.sep).join("/")] ?? 1;
  const ordered = [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  if (new Set(ordered).size !== ordered.length) throw Error("Duplicate tooling file");
  const bins = Array.from({ length: shards }, () => ({ cost: 0, files: [] }));
  for (const file of ordered) {
    const bin = bins.reduce((best, next) => next.cost < best.cost ? next : best);
    bin.files.push(file); bin.cost += weight(file);
  }
  // Quick regressions precede expensive orchestration without dropping any file.
  return bins[shard - 1].files.sort((a, b) => weight(a) - weight(b) || a.localeCompare(b));
}
export function verifyStressSeeds(observations, lane) {
  const expected = stressSeeds(lane).map(stressTestName);
  const actual = (observations?.tests ?? []).map(test => test.name);
  return {
    expected,
    missing: expected.filter(name => !actual.includes(name)),
    unexpected: actual.filter(name => !expected.includes(name)),
    duplicates: actual.filter((name, index) => actual.indexOf(name) !== index),
    notPassed: (observations?.tests ?? []).filter(test => test.status !== "passed").map(test => test.name),
  };
}
