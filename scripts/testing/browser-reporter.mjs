import { writeFileSync } from "node:fs";
export default class BrowserReporter {
  onError() {
    this.globalErrors = (this.globalErrors ?? 0) + 1;
  }
  onBegin(config, suite) {
    this.started = Date.now();
    this.suite = suite;
  }
  onEnd() {
    const tests = this.suite
      .allTests()
      .map((t) => ({
        id: t.id,
        name: t.titlePath().join(" > "),
        file: t.location.file,
        status: t.outcome(),
        expected: t.expectedStatus,
        attempts: t.results.map((r) => ({
          status: r.status,
          durationMs: r.duration,
          errors: r.errors.map((e) => e.message),
        })),
      }));
    const observations = {
      uncompleted: tests.filter(
        (t) =>
          !t.attempts.length ||
          (t.status === "skipped" && t.expected !== "skipped"),
      ).length,
      inventory: tests.map((t) => t.id),
      total: tests.length,
      passed: tests.filter(
        (t) => t.status === "expected" && t.expected !== "skipped",
      ).length,
      failed:
        (this.globalErrors ?? 0) +
        tests.filter((t) => t.status === "unexpected").length,
      skipped: tests.filter((t) => t.status === "skipped").length,
      flaky: tests.filter((t) => t.status === "flaky").length,
      tests,
      elapsedMs: Date.now() - this.started,
    };
    if (process.env.RIGHELT_TEST_OBSERVATIONS)
      writeFileSync(
        process.env.RIGHELT_TEST_OBSERVATIONS,
        JSON.stringify(observations, null, 2),
      );
  }
}
