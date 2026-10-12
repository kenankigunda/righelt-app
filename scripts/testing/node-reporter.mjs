import { writeFileSync } from "node:fs";
import { inspect } from "node:util";
export default async function* reporter(source) {
  const observations = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    tests: [],
  };
  for await (const event of source) {
    if (
      ["test:pass", "test:fail"].includes(event.type) &&
      event.data.details?.type !== "suite"
    ) {
      const status =
        event.type === "test:fail"
          ? "failed"
          : event.data.skip
            ? "skipped"
            : "passed";
      observations.total++;
      observations[status]++;
      observations.tests.push({
        name: event.data.name,
        file: event.data.file,
        status,
        durationMs: event.data.details?.duration_ms,
      });
    }
    if (event.type === 'test:fail') yield `${event.data.file ?? ''}: ${event.data.name}\n${inspect(event.data.details?.error, { depth: 5, colors: false })}\n`;
    else if (event.type === 'test:stdout' || event.type === 'test:stderr') yield event.data.message;
  }
  if (process.env.RIGHELT_TEST_OBSERVATIONS)
    writeFileSync(
      process.env.RIGHELT_TEST_OBSERVATIONS,
      JSON.stringify(observations, null, 2),
    );
}
