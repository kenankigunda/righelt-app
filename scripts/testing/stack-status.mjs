import { readFileSync, writeFileSync } from "node:fs";
import { recordPath } from "../resources/registry.mjs";
export function recordUnexpectedExit(label, code, signal) {
  // A guardian tears down nested services before signalling their stack owner.
  // Only its persisted stopping state establishes that this exit was requested.
  if (process.env.RIGHELT_RESOURCE_RUN) {
    try {
      const guardian = JSON.parse(readFileSync(recordPath(process.env.RIGHELT_RESOURCE_RUN), "utf8"));
      if (guardian.status === "stopping") return;
    } catch { /* Missing lifecycle evidence must fail closed. */ }
  }
  const state = {
    unexpectedExit: true,
    label,
    code,
    signal: signal ?? null,
    time: new Date().toISOString(),
  };
  console.error(`[test-stack] Unexpected exit: ${JSON.stringify(state)}`);
  if (process.env.RIGHELT_TEST_STACK_STATUS) {
    try {
      writeFileSync(
        process.env.RIGHELT_TEST_STACK_STATUS,
        JSON.stringify(state, null, 2),
        { flag: "wx" },
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}
