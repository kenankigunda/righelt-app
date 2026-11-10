import { runSuite } from "./run.mjs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import {
  isRetryableReceipt,
  shouldDeferInfrastructureRetry,
} from "./receipts.mjs";
const lane = {
  suite: process.env.SUITE,
  project: process.env.PROJECT || null,
  shard: Number(process.env.SHARD),
  shards: Number(process.env.SHARDS),
};
const receipt = await runSuite(lane, { out: "test-results/suites" });
const retryEligible = isRetryableReceipt(receipt);
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/ci-attempt.json",
  JSON.stringify(
    {
      lane: receipt.lane,
      attempt: receipt.attempt,
      receiptDigest: receipt.integrity,
      retryEligible,
      outcome: receipt.outcome,
      failureKind: receipt.failureKind,
    },
    null,
    2,
  ),
);
if (process.env.GITHUB_OUTPUT)
  await appendFile(
    process.env.GITHUB_OUTPUT,
    [
      `retry_eligible=${retryEligible}`,
      `receipt_digest=${receipt.integrity}`,
      `outcome=${receipt.outcome}`,
      `failure_kind=${receipt.failureKind ?? ""}`,
      "",
    ].join("\n"),
  );
const deferredRetry = shouldDeferInfrastructureRetry(
  receipt,
  process.env.RIGHELT_DEFER_INFRA_RETRY === "1",
);
if (receipt.status !== "passed" && !deferredRetry) process.exitCode = 1;
