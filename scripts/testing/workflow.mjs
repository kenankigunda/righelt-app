import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fullLanes, suiteById } from "./catalog.mjs";
const expression = (value) => "${{ " + value + " }}";
const setup = [
  { name: "Checkout", uses: "actions/checkout@v5", with: { "fetch-depth": 0, ref: expression("github.event.pull_request.head.sha || github.sha") } },
  {
    name: "Setup pnpm",
    uses: "pnpm/action-setup@v4",
    with: { version: "9.15.9" },
  },
  {
    name: "Setup Node",
    uses: "actions/setup-node@v5",
    with: { "node-version": "22", cache: "pnpm" },
  },
  { name: "Install dependencies", run: "pnpm install --frozen-lockfile" },
];
export function workflow() {
  const jobs = {};
  for (const [name, filter] of Object.entries({
    node: (s) => !s.browser,
    "browser-integration": (s) => s.id === "browser-integration",
    e2e: (s) => s.id === "e2e",
    "auth-e2e": (s) => ["auth-e2e", "auth-controls"].includes(s.id),
    responsive: (s) => s.id === "responsive",
    tooling: (s) => ["tooling", "report-viewer"].includes(s.id),
    performance: (s) => s.id === "performance",
  })) {
    const lanes = fullLanes()
      .filter((l) => filter(suiteById(l.suite)))
      .map((l, i) => ({
        ...l,
        project: l.project ?? "",
        artifact: `${name}-${i}`,
      }));
    jobs[name] = {
      name: `${name} / ${expression("matrix.suite")} ${expression("matrix.project")} ${expression("matrix.shard")}`,
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 60,
      strategy: { "fail-fast": false, matrix: { include: lanes } },
      steps: [
        ...setup,
        ...(lanes.some((l) => suiteById(l.suite).browser)
          ? [
              {
                name: "Install browsers",
                env: { PROJECT: expression("matrix.project") },
                run: "node scripts/testing/install-browsers.mjs",
              },
            ]
          : []),
        {
          name: "Record advisory selection",
          run: "pnpm test:plan --base origin/main",
        },
        {
          name: "Validate suite",
          env: {
            SUITE: expression("matrix.suite"),
            PROJECT: expression("matrix.project"),
            SHARD: expression("matrix.shard"),
            SHARDS: expression("matrix.shards"),
          },
          run: "node scripts/testing/ci-run.mjs",
        },
        {
          name: "Preserve evidence",
          if: "always()",
          uses: "actions/upload-artifact@v6",
          with: {
            name: `suite-${expression("matrix.artifact")}-${expression("github.run_attempt")}`,
            path: "test-results/",
            "if-no-files-found": "error",
          },
        },
      ],
    };
  }
  jobs["full-validation"] = {
    permissions: { contents: "read", actions: "read" },
    name: "Full validation",
    if: "always()",
    "runs-on": "ubuntu-latest",
    needs: Object.keys(jobs),
    steps: [
      ...setup,
      {
        name: "Select latest exact-run evidence",
        id: "artifacts",
        uses: "actions/github-script@v8",
        with: {
          script: `const {selectSuiteArtifacts}=await import(process.env.GITHUB_WORKSPACE+'/scripts/testing/select-artifacts.mjs');
const {data:run}=await github.rest.actions.getWorkflowRun({...context.repo,run_id:context.runId});
const artifacts=await github.paginate(github.rest.actions.listWorkflowRunArtifacts,{...context.repo,run_id:context.runId,per_page:100});
const selected=selectSuiteArtifacts(artifacts,{runId:context.runId,headSha:run.head_sha});
if(!selected.length)throw new Error('No suite evidence');
core.setOutput('ids',selected.map(a=>a.id).join(','));`,
        },
      },
      {
        name: "Download suite evidence",
        uses: "actions/download-artifact@v5",
        with: {
          "artifact-ids": expression("steps.artifacts.outputs.ids"),
          path: "test-results/full",
          "merge-multiple": true,
        },
      },
      {
        name: "Require all jobs and exact suite receipts",
        env: { RIGHELT_JOB_RESULTS: expression("toJSON(needs)") },
        run: "node scripts/testing/ci-verify.mjs",
      },
      {
        name: "Preserve full inventory",
        if: "always()",
        uses: "actions/upload-artifact@v6",
        with: {
          name: `full-validation-${expression("github.run_attempt")}`,
          path: "test-results/full/full.json",
          "if-no-files-found": "error",
        },
      },
    ],
  };
  return {
    name: "CI",
    on: {
      pull_request: {
        types: ["opened", "synchronize", "reopened", "ready_for_review"],
      },
      push: { branches: ["main"] },
      workflow_dispatch: {},
    },
    permissions: { contents: "read" },
    concurrency: {
      group: `ci-${expression("github.event.pull_request.number || github.ref")}`,
      "cancel-in-progress": expression("github.event_name == 'pull_request'"),
    },
    env: { FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true" },
    jobs,
  };
}
export const workflowText = () => JSON.stringify(workflow(), null, 2) + "\n";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = ".github/workflows/ci.yml",
    text = workflowText();
  if (process.argv.includes("--check")) {
    if (readFileSync(file, "utf8") !== text)
      throw Error(
        "CI differs from suite catalog; regenerate with node scripts/testing/workflow.mjs",
      );
  } else writeFileSync(file, text);
}
