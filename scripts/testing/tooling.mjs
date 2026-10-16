import { spawnSync } from "node:child_process";
import { nodeInventory } from "./inventory.mjs";
const files = nodeInventory("tooling");
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
