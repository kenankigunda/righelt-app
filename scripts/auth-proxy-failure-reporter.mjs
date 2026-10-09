import { checkProxyFailureJournal } from "./auth-proxy-failures.mjs";

export default class AccountProxyFailureReporter {
  constructor(options) { this.options = options; }
  async onEnd(result) {
    try {
      const { count, passed } = await checkProxyFailureJournal(this.options.directory, this.options.runId);
      if (passed) return { status: result.status };
      console.error(`[auth-e2e] ${count} unresolved request transport failure(s); validation failed.`);
    } catch {
      // Playwright catches reporter exceptions without failing the test run.
      console.error("[auth-e2e] Missing or invalid request failure accounting; validation failed.");
    }
    return { status: result.status === "passed" ? "failed" : result.status };
  }
}
