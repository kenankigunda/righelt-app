import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nightlyFullLanes, prGateLanes, suiteById } from "./catalog.mjs";

const expression = (value) => "${{ " + value + " }}";
const CI_NODE_VERSION = "22.23.4";
const checkoutRef = expression("github.event.pull_request.head.sha || github.sha");
const setup = [
  { name: "Checkout", uses: "actions/checkout@v5", with: { "fetch-depth": 0, ref: checkoutRef } },
  { name: "Setup pnpm", uses: "pnpm/action-setup@v4", with: { version: "9.15.9" } },
  { name: "Setup Node", uses: "actions/setup-node@v5", with: { "node-version": CI_NODE_VERSION, cache: "pnpm" } },
  { name: "Install dependencies", run: "pnpm install --frozen-lockfile" },
];

// Planning and receipt verification import only Node built-ins and repository modules.
const receiptSetup = [setup[0], { name: 'Setup Node', uses: 'actions/setup-node@v5', with: { 'node-version': CI_NODE_VERSION, 'package-manager-cache': false } }];

const artifactName = (lane, attempt) =>
  `suite-${lane.suite}-${lane.project || "default"}-${lane.shard}-of-${lane.shards}-attempt-${attempt}-${expression("github.run_attempt")}`;
const validateStep = (lane, profile, attempt, priorExpression = null) => ({
  name: "Validate suite",
  id: "validate",
  env: {
    SUITE: lane.suite,
    PROJECT: lane.project || "",
    SHARD: String(lane.shard),
    SHARDS: String(lane.shards),
    RIGHELT_EVIDENCE_PROFILE: profile,
    RIGHELT_CI_ATTEMPT: String(attempt),
    ...(attempt === 1 ? { RIGHELT_DEFER_INFRA_RETRY: "1" } : {}),
    ...(priorExpression ? { RIGHELT_PRIOR_RECEIPT_DIGEST: priorExpression } : {}),
  },
  run: "node scripts/testing/ci-run.mjs",
});
const evidenceStep = (lane, attempt) => ({
  name: "Preserve evidence",
  if: "always()",
  uses: "actions/upload-artifact@v6",
  with: { name: artifactName(lane, attempt), path: "test-results/", "if-no-files-found": "error" },
});
const browserAttemptJob = (lane, profile, attempt, needs = null) => ({
  name: `${lane.suite} / ${lane.project || "chromium"} / attempt ${attempt}`,
  ...(needs ? { needs: [needs], if: expression(`needs.${needs}.outputs.retry_eligible == 'true'`) } : {}),
  "runs-on": "ubuntu-24.04",
  "timeout-minutes": 60,
  ...(attempt === 1 ? { outputs: {
    retry_eligible: expression("steps.validate.outputs.retry_eligible"),
    receipt_digest: expression("steps.validate.outputs.receipt_digest"),
  } } : {}),
  steps: [
    ...setup,
    { name: "Install browser", env: { PROJECT: lane.project || "chromium" }, run: "node scripts/testing/install-browsers.mjs" },
    validateStep(lane, profile, attempt, needs ? expression(`needs.${needs}.outputs.receipt_digest`) : null),
    evidenceStep(lane, attempt),
  ],
});
const normalizeId = (lane) => `${lane.suite}-${lane.project || "default"}-${lane.shard}`.replace(/[^a-z0-9-]/g, "-");
const aggregateSteps = (profile, outputName) => [
  ...receiptSetup,
  {
    name: "Select exact-run evidence", id: "artifacts", uses: "actions/github-script@v8",
    with: { script: `const {selectSuiteArtifacts}=await import(process.env.GITHUB_WORKSPACE+'/scripts/testing/select-artifacts.mjs');
const {data:run}=await github.rest.actions.getWorkflowRun({...context.repo,run_id:context.runId});
const artifacts=await github.paginate(github.rest.actions.listWorkflowRunArtifacts,{...context.repo,run_id:context.runId,per_page:100});
const selected=selectSuiteArtifacts(artifacts,{runId:context.runId,headSha:run.head_sha,runAttempt:run.run_attempt});
if(!selected.length)throw new Error('No suite evidence');
core.setOutput('ids',selected.map(a=>a.id).join(','));` },
  },
  {
    name: "Download suite evidence", uses: "actions/download-artifact@v5",
    with: { "artifact-ids": expression("steps.artifacts.outputs.ids"), path: "test-results/full", "merge-multiple": true },
  },
  {
    name: "Verify exact profile receipts",
    env: { RIGHELT_JOB_RESULTS: expression("toJSON(needs)"), RIGHELT_EVIDENCE_PROFILE: profile },
    run: "node scripts/testing/ci-verify.mjs",
  },
  {
    name: "Preserve aggregate inventory", if: "always()", uses: "actions/upload-artifact@v6",
    with: { name: `${outputName}-${expression("github.run_attempt")}`, path: "test-results/full/full.json", "if-no-files-found": "error" },
  },
];

export function workflow() {
  const jobs = {}, lanes = prGateLanes();
  const nodeLanes = lanes.filter((lane) => !suiteById(lane.suite).browser)
    .map((lane, index) => ({ ...lane, project: lane.project || "", artifact: `node-${index}` }));
  jobs.plan = {
    name: "Advisory affected-test plan", "runs-on": "ubuntu-latest",
    "continue-on-error": true,
    steps: [
      ...receiptSetup,
      { name: "Record shadow selection", run: "node scripts/testing/cli.mjs plan --base \"$RIGHELT_TEST_BASE_REVISION\" --out test-results/plan/plan.json" },
      { name: "Preserve shadow plan", uses: "actions/upload-artifact@v6", with: { name: `affected-plan-${expression("github.run_attempt")}`, path: "test-results/plan/plan.json", "if-no-files-found": "error" } },
    ],
  };
  jobs.node = {
    name: `node / ${expression("matrix.suite")}`, "runs-on": "ubuntu-latest", "timeout-minutes": 60,
    strategy: { "fail-fast": false, matrix: { include: nodeLanes } },
    steps: [
      ...setup,
      {
        name: "Validate suite",
        env: {
          SUITE: expression("matrix.suite"), PROJECT: expression("matrix.project"),
          SHARD: expression("matrix.shard"), SHARDS: expression("matrix.shards"),
          RIGHELT_EVIDENCE_PROFILE: "pr-gate", RIGHELT_CI_ATTEMPT: "1",
        },
        run: "node scripts/testing/ci-run.mjs",
      },
      {
        name: "Preserve evidence", if: "always()", uses: "actions/upload-artifact@v6",
        with: { name: `suite-${expression("matrix.artifact")}-attempt-1-${expression("github.run_attempt")}`, path: "test-results/", "if-no-files-found": "error" },
      },
    ],
  };
  const browserNeeds = [];
  for (const lane of lanes.filter((item) => suiteById(item.suite).browser)) {
    const id = normalizeId(lane), retryId = `${id}-retry`;
    jobs[id] = browserAttemptJob(lane, "pr-gate", 1);
    jobs[retryId] = browserAttemptJob(lane, "pr-gate", 2, id);
    browserNeeds.push(id, retryId);
  }
  jobs["pr-validation"] = {
    permissions: { contents: "read", actions: "read" }, name: "PR validation", if: "always()",
    "runs-on": "ubuntu-latest", needs: ["node", ...browserNeeds],
    steps: aggregateSteps("pr-gate", "pr-validation"),
  };
  return {
    name: "CI",
    on: { pull_request: { types: ["opened", "synchronize", "reopened"] }, push: { branches: ["main"] }, workflow_dispatch: {} },
    permissions: { contents: "read" },
    concurrency: { group: `ci-${expression("github.event.pull_request.number || github.ref")}`, "cancel-in-progress": expression("github.event_name == 'pull_request'") },
    env: { FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true", RIGHELT_TEST_BASE_REVISION: expression("github.event.pull_request.base.sha || github.sha") }, jobs,
  };
}

const nightlyGroups = {
  node: (suite) => !suite.browser,
  "browser-integration": (suite) => ["browser-integration", "browser-contract"].includes(suite.id),
  e2e: (suite) => ["e2e", "storage-lifecycle", "guest-smoke"].includes(suite.id),
  "auth-e2e": (suite) => ["auth-e2e", "auth-controls", "auth-smoke"].includes(suite.id),
  responsive: (suite) => suite.id === "responsive",
  tooling: (suite) => ["report-viewer", "tooling-browser"].includes(suite.id),
  performance: (suite) => suite.id === "performance",
};
export function nightlyWorkflow() {
  const jobs = {}, all = nightlyFullLanes();
  for (const [name, filter] of Object.entries(nightlyGroups)) {
    const lanes = all.filter((lane) => filter(suiteById(lane.suite))).map((lane, i) => ({ ...lane, project: lane.project || "", artifact: `${name}-${i}` }));
    const needsBrowser = lanes.some((lane) => suiteById(lane.suite).browser);
    jobs[name] = {
      name: `${name} / ${expression("matrix.suite")} ${expression("matrix.project")} ${expression("matrix.shard")}`,
      "runs-on": needsBrowser ? "ubuntu-24.04" : "ubuntu-latest", "timeout-minutes": 60,
      strategy: { "fail-fast": false, matrix: { include: lanes } },
      steps: [
        ...setup,
        ...(needsBrowser ? [{ name: "Install browser", env: { PROJECT: expression("matrix.project") }, run: "node scripts/testing/install-browsers.mjs" }] : []),
        {
          name: "Validate suite",
          env: {
            SUITE: expression("matrix.suite"), PROJECT: expression("matrix.project"), SHARD: expression("matrix.shard"), SHARDS: expression("matrix.shards"),
            RIGHELT_EVIDENCE_PROFILE: "nightly-full", RIGHELT_CI_ATTEMPT: "1",
          },
          run: "node scripts/testing/ci-run.mjs",
        },
        {
          name: "Preserve evidence", if: "always()", uses: "actions/upload-artifact@v6",
          with: { name: `suite-${expression("matrix.artifact")}-attempt-1-${expression("github.run_attempt")}`, path: "test-results/", "if-no-files-found": "error" },
        },
      ],
    };
  }
  jobs["nightly-validation"] = {
    permissions: { contents: "read", actions: "read" }, name: "Nightly validation", if: "always()",
    "runs-on": "ubuntu-latest", needs: Object.keys(jobs), steps: aggregateSteps("nightly-full", "nightly-validation"),
  };
  return {
    name: "Nightly validation",
    on: { schedule: [{ cron: "0 9 * * *" }], workflow_dispatch: {} },
    permissions: { contents: "read" },
    concurrency: { group: "nightly-validation", "cancel-in-progress": false },
    env: { FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true", RIGHELT_TEST_BASE_REVISION: expression("github.sha") }, jobs,
  };
}

export const workflowText = () => JSON.stringify(workflow(), null, 2) + "\n";
export const nightlyWorkflowText = () => JSON.stringify(nightlyWorkflow(), null, 2) + "\n";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputs = [[".github/workflows/ci.yml", workflowText()], [".github/workflows/nightly-validation.yml", nightlyWorkflowText()]];
  if (process.argv.includes("--check")) {
    for (const [file, text] of outputs)
      if (readFileSync(file, "utf8") !== text) throw Error(`${file} differs from the generated workflow`);
  } else for (const [file, text] of outputs) writeFileSync(file, text);
}
