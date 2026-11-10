import { spawnSync } from "node:child_process";
import { nodeInventory } from "./inventory.mjs";
// Fail fast before the slower tooling inventory. The same policy also has regression tests.
const policy = spawnSync(process.execPath, [new URL('./check-source-inspection.mjs', import.meta.url).pathname], {stdio:'inherit'});
if (policy.status !== 0) process.exit(policy.status ?? 1);
const files = nodeInventory(process.env.RIGHELT_TOOLING_SUITE || "tooling");
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
