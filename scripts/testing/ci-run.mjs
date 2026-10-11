import { runSuite } from "./run.mjs";
const lane = {
  suite: process.env.SUITE,
  project: process.env.PROJECT || null,
  shard: Number(process.env.SHARD),
  shards: Number(process.env.SHARDS),
};
const receipt = await runSuite(lane, { out: "test-results/suites" });
if (receipt.status !== "passed") process.exitCode = 1;
