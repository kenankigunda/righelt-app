import { writeFileSync } from "node:fs";
export function recordUnexpectedExit(label, code, signal) {
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
