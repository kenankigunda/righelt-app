import { writeFileSync } from "node:fs";
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
    yield "";
  }
  if (process.env.RIGHELT_TEST_OBSERVATIONS)
    writeFileSync(
      process.env.RIGHELT_TEST_OBSERVATIONS,
      JSON.stringify(observations, null, 2),
    );
}
