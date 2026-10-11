import { writeFile } from "node:fs/promises";
import { readReceipts, sourceIdentity, verifyFull } from "./receipts.mjs";
const out = "test-results/full";
const result = verifyFull(readReceipts(out), sourceIdentity(process.cwd()));
const jobs = JSON.parse(process.env.RIGHELT_JOB_RESULTS ?? "{}");
if (
  Object.keys(jobs).length !== 7 ||
  Object.values(jobs).some((j) => j.result !== "success")
)
  result.errors.push(
    "A required CI lane failed, was cancelled, skipped or is missing",
  );
result.status = result.errors.length ? "failed" : "passed";
await writeFile(`${out}/full.json`, JSON.stringify(result, null, 2));
console.log(result);
if (result.status !== "passed") process.exitCode = 1;
