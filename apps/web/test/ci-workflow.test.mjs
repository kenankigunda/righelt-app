import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const workflow = readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");

const jobBlock = (jobId, nextJobId = null) => {
  const start = workflow.indexOf(`${jobId}:`);
  assert.notEqual(start, -1, `Missing job ${jobId}`);
  const end = nextJobId ? workflow.indexOf(`${nextJobId}:`, start + 1) : workflow.length;
  return workflow.slice(start, end === -1 ? workflow.length : end);
};

test("CI grants the permissions required for publishing GitHub test results", () => {
  assert.match(workflow, /permissions:\s+contents: read\s+checks: write/s);
  assert.match(workflow, /env:\s+FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"/s);
});

test("CI uses split job-level checks and Node 22", () => {
  assert.match(workflow, /typecheck:\s+name: Typecheck/s);
  assert.match(workflow, /generated-web-runtime:\s+name: Generated web runtime/s);
  assert.match(workflow, /engine-unit:\s+name: Engine unit/s);
  assert.match(workflow, /web-unit:\s+name: Web unit/s);
  assert.match(workflow, /engine-integration:\s+name: Engine integration/s);
  assert.match(workflow, /api-handler-integration:\s+name: API handler integration/s);
  assert.match(workflow, /api-worker-integration:\s+name: API worker integration/s);
  assert.match(workflow, /web-integration:\s+name: Web integration/s);
  assert.match(workflow, /e2e-smoke:\s+name: E2E smoke/s);
  assert.match(workflow, /e2e-workflows:\s+name: E2E workflows/s);
  assert.match(workflow, /test-results:\s+name: Test results/s);
  assert.match(workflow, /node-version: "22"/);
  assert.match(workflow, /uses: actions\/checkout@v5/);
  assert.match(workflow, /uses: actions\/setup-node@v5/);
  assert.match(workflow, /uses: actions\/upload-artifact@v6/);
  assert.match(workflow, /uses: actions\/download-artifact@v6/);
});

test("CI allows non-E2E checks to run in parallel and only gates workflow E2E behind smoke", () => {
  const engineIntegration = jobBlock("engine-integration", "api-handler-integration");
  assert.doesNotMatch(engineIntegration, /\n\s+needs:\n/);

  const apiHandlerIntegration = jobBlock("api-handler-integration", "api-worker-integration");
  assert.doesNotMatch(apiHandlerIntegration, /\n\s+needs:\n/);

  const apiWorkerIntegration = jobBlock("api-worker-integration", "web-integration");
  assert.doesNotMatch(apiWorkerIntegration, /\n\s+needs:\n/);

  const webIntegration = jobBlock("web-integration", "e2e-smoke");
  assert.doesNotMatch(webIntegration, /\n\s+needs:\n/);

  const smoke = jobBlock("e2e-smoke", "e2e-workflows");
  assert.doesNotMatch(smoke, /\n\s+needs:\n/);

  const workflows = jobBlock("e2e-workflows", "test-results");
  assert.match(workflows, /needs:\n\s+- e2e-smoke/s);

  const results = jobBlock("test-results");
  assert.match(results, /if: \$\{\{ always\(\) \}\}/);
  assert.match(
    results,
    /needs:\n\s+- typecheck\n\s+- generated-web-runtime\n\s+- engine-unit\n\s+- web-unit\n\s+- engine-integration\n\s+- api-handler-integration\n\s+- api-worker-integration\n\s+- web-integration\n\s+- e2e-smoke\n\s+- e2e-workflows/s,
  );
});

test("CI emits JUnit from each lane and publishes a consolidated test-results check", () => {
  assert.match(
    workflow,
    /pnpm test:engine:unit -- --reporter spec --reporter junit --reporter-destination stdout --reporter-destination test-results\/engine-unit\/results\.xml/,
  );
  assert.match(
    workflow,
    /pnpm test:web:unit -- --reporter spec --reporter junit --reporter-destination stdout --reporter-destination test-results\/web-unit\/results\.xml/,
  );
  assert.match(
    workflow,
    /pnpm test:engine:integration -- --reporter spec --reporter junit --reporter-destination stdout --reporter-destination test-results\/engine-integration\/results\.xml/,
  );
  assert.match(
    workflow,
    /pnpm test:api-handler -- --reporter spec --reporter junit --reporter-destination stdout --reporter-destination test-results\/api-handler-integration\/results\.xml/,
  );
  assert.match(
    workflow,
    /pnpm test:api-worker -- --reporter spec --reporter junit --reporter-destination stdout --reporter-destination test-results\/api-worker-integration\/results\.xml/,
  );
  assert.match(
    workflow,
    /pnpm test:web:integration -- --reporter spec --reporter junit --reporter-destination stdout --reporter-destination test-results\/web-integration\/results\.xml/,
  );
  assert.match(workflow, /PLAYWRIGHT_JUNIT_OUTPUT_FILE: test-results\/e2e-smoke\/results\.xml/);
  assert.match(workflow, /PLAYWRIGHT_JUNIT_OUTPUT_FILE: test-results\/e2e-workflows\/results\.xml/);
  assert.match(workflow, /uses: actions\/download-artifact@v6/);
  assert.match(workflow, /pattern: junit-\*/);
  assert.doesNotMatch(workflow, /merge-multiple: true/);
  assert.match(workflow, /uses: mikepenz\/action-junit-report@v6/);
  assert.match(workflow, /check_name: Test results/);
  assert.match(workflow, /report_paths: test-results\/published\/\*\*\/\*\.xml/);
});

test("CI keeps JUnit and Playwright debug artifacts available after lane execution", () => {
  assert.match(workflow, /name: junit-engine-unit/);
  assert.match(workflow, /name: junit-web-unit/);
  assert.match(workflow, /name: junit-engine-integration/);
  assert.match(workflow, /name: junit-api-handler-integration/);
  assert.match(workflow, /name: junit-api-worker-integration/);
  assert.match(workflow, /name: junit-web-integration/);
  assert.match(workflow, /name: junit-e2e-smoke/);
  assert.match(workflow, /name: junit-e2e-workflows/);
  assert.match(workflow, /name: playwright-e2e-smoke-debug/);
  assert.match(workflow, /name: playwright-e2e-workflows-debug/);
});
