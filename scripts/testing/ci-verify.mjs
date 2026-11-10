import { nightlyFullLanes, prGateLanes } from "./catalog.mjs";
import { appendFile, writeFile } from "node:fs/promises";
import { readReceipts, sourceIdentity, verifyFull } from "./receipts.mjs";
import { isolationFailureLabel } from "./storage-lane-isolation.mjs";
const out = "test-results/full";
const profile = process.env.RIGHELT_EVIDENCE_PROFILE || null;
const lanes = profile === "pr-gate" ? prGateLanes() :
  profile === "nightly-full" ? nightlyFullLanes() : null;
if (!lanes) throw Error("A known evidence profile is required");
const receipts = readReceipts(out);
const identity = sourceIdentity(process.cwd());
const result = verifyFull(receipts, identity, {
  profile,
  lanes,
  allowLegacy: false,
});
const jobs = JSON.parse(process.env.RIGHELT_JOB_RESULTS ?? "{}");
const invalidJobs = Object.entries(jobs).filter(([name, job]) =>
  job.result !== "success" &&
  !(profile === "pr-gate" && name.endsWith("-retry") && job.result === "skipped")
);
if (!Object.keys(jobs).length || invalidJobs.length)
  result.errors.push(
    "A required CI lane failed, was cancelled, skipped or is missing",
  );
result.status = result.errors.length ? "failed" : "passed";
await writeFile(`${out}/full.json`, JSON.stringify(result, null, 2));

const ownerFor = (suite = "") => {
  if (/^(engine|computer)/.test(suite)) return "game engine";
  if (/^(api|sync|auth)/.test(suite)) return "backend and authentication";
  if (/^(tooling|report|performance|generated|typecheck)/.test(suite))
    return "developer infrastructure";
  return "web and test infrastructure";
};
const failedReceipts = receipts.filter((receipt) =>
  receipt.status !== "passed" ||
  receipt.outcome === "failed" ||
  receipt.outcome === "incomplete"
);
const failedTests = failedReceipts.flatMap((receipt) =>
  (receipt.observations?.tests ?? [])
    .filter((test) => ["failed", "unexpected", "flaky"].includes(test.status))
    .map((test) => ({ lane: receipt.lane, name: test.name, file: test.file })),
);
const summary = [
  `# ${profile === "nightly-full" ? "Nightly validation" : "PR validation"}`,
  "",
  `- Status: **${result.status}**`,
  `- Evidence profile: \`${profile}\``,
  `- Revision: \`${identity.revision}\``,
  `- Base revision: \`${identity.baseRevision}\``,
  `- Aggregate artifact: \`${profile === "nightly-full" ? "nightly-validation" : "pr-validation"}-${process.env.GITHUB_RUN_ATTEMPT ?? "local"}\``,
  "- Per-lane receipts and logs are retained in the corresponding `suite-*` artifacts.",
  ...(result.recovered.length
    ? [`- Infrastructure recovered: ${result.recovered.map((lane) => `\`${lane}\``).join(", ")}`]
    : []),
  "",
];
if (failedReceipts.length) {
  summary.push("## Classified failures", "");
  for (const receipt of failedReceipts)
    summary.push(
      `- \`${receipt.lane}\`: **${isolationFailureLabel(receipt) ?? receipt.failureKind ?? "unknown"}**; suggested owner: ${ownerFor(receipt.suite)}`,
    );
  summary.push("");
}
if (failedTests.length) {
  summary.push("## Failing tests", "");
  for (const test of failedTests)
    summary.push(`- \`${test.lane}\`: ${test.name}${test.file ? ` (\`${test.file}\`)` : ""}`);
  summary.push("");
}
if (result.errors.length) {
  summary.push("## Evidence errors", "", ...result.errors.map((error) => `- ${error}`), "");
}
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
console.log(result);
if (result.status !== "passed") process.exitCode = 1;
