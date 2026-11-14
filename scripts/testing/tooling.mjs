import { spawnSync } from "node:child_process";
import { nodeLaneInventory } from "./inventory.mjs";
// Fail fast before the slower tooling inventory. The same policy also has regression tests.
const policy = spawnSync(process.execPath, [new URL('./check-source-inspection.mjs', import.meta.url).pathname], {stdio:'inherit'});
if (policy.status !== 0) process.exit(policy.status ?? 1);
const files = nodeLaneInventory(process.env.RIGHELT_TOOLING_SUITE || "tooling", process.cwd(), {shard: Number(process.env.RIGHELT_NODE_SHARD || 1), shards: Number(process.env.RIGHELT_NODE_SHARDS || 1)});
const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    // Native proxy regression temporarily patches the pinned dependency. Other
    // source guards must observe its restored bytes, never that in-flight patch.
    "--test-concurrency=1",
    ...(process.env.RIGHELT_TEST_OBSERVATIONS
      ? [
          "--test-reporter",
          new URL("./node-reporter.mjs", import.meta.url).pathname,
        ]
      : []),
    ...files,
  ],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
