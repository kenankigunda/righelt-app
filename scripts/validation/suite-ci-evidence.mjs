import { selectSuiteArtifacts } from "../testing/select-artifacts.mjs";
import path from "node:path";
import { sourceIdentity, verifyFull, digest } from "../testing/receipts.mjs";
import { fullLanes, laneKey } from "../testing/catalog.mjs";
import { evidenceKey, fileDigest } from "./reuse.mjs";
import { saveJSON } from "./io.mjs";
const groups = {
  Typecheck: ["typecheck"],
  "Generated runtime": ["generated"],
  Generated: ["generated"],
  Unit: ["engine-unit", "web-unit", "computer-unit"],
  Integration: [
    "engine-integration",
    "api-handler",
    "api-worker",
    "web-integration",
    "sync-stress",
    "sync-runtime",
    "computer-integration",
  ],
  E2E: ["e2e"],
  "Auth E2E": ["auth-e2e", "auth-controls"],
  Auth: ["auth-e2e", "auth-controls"],
  "Browser integration": ["browser-integration"],
  Tooling: ["tooling"],
  Performance: ["performance"],
};
// Credit explicit suite receipts, never infer tests from command text or job names.
export const canonicalCommands = {
  Typecheck: "typecheck",
  "Generated runtime": "check:web-engine-generated",
  Generated: "check:web-engine-generated",
  Unit: "test:unit",
  Integration: "test:integration",
  E2E: "test:e2e",
  "Auth E2E": "test:e2e:auth",
  Auth: "test:e2e:auth",
  "Browser integration": "test:browser:integration",
  Tooling: "test:tooling",
  Performance: "test:performance",
};
export function assertSuiteRequest(name, request) {
  if (
    !canonicalCommands[name] ||
    JSON.stringify(request.argv) !==
      JSON.stringify(["pnpm", canonicalCommands[name]])
  )
    throw Error("Named suite and requested command differ");
}
export async function importCatalogCI({
  repository,
  run,
  cwd,
  outDir,
  expected,
  api,
  call,
  execute,
}) {
  const page = await api(`actions/runs/${run.id}/artifacts?per_page=100`);
  if (page.total_count > 100) throw Error("Unsupported artifact pagination");
  const artifacts = selectSuiteArtifacts(page.artifacts, {
    runId: run.id,
    headSha: run.head_sha,
  });
  if (run.conclusion !== "success" || artifacts.length !== fullLanes().length)
    throw Error("Full current-attempt CI inventory unavailable");
  const suiteReceipts = [],
    evidence = [];
  for (const a of artifacts) {
    if (
      a.workflow_run?.id !== run.id ||
      a.workflow_run?.head_sha !== run.head_sha
    )
      throw Error("Artifact run/head mismatch");
    const archive = path.join(outDir, `suite-${a.id}.zip`);
    await execute(
      [
        "gh",
        "api",
        `repos/${repository}/actions/artifacts/${a.id}/zip`,
        "--allow-escape-sequences",
      ],
      { cwd, log: archive, maxOutputBytes: 1024, logStdoutOnly: true },
    );
    const names = (await call(["unzip", "-Z1", archive]))
      .split("\n")
      .filter((n) => n.endsWith(".receipt.json"));
    if (
      names.length !== 1 ||
      !/^suites\/[\w.-]+\/[\d]+\.receipt\.json$/.test(names[0])
    )
      throw Error("Unexpected receipt archive inventory");
    const r = JSON.parse(await call(["unzip", "-p", archive, names[0]]));
    suiteReceipts.push(r);
    const logName = names[0].replace(/[^/]+$/, "output.log");
    const log = path.join(outDir, `suite-${a.id}.log`);
    await execute(["unzip", "-p", archive, logName], {
      cwd,
      log,
      logStdoutOnly: true,
      maxOutputBytes: 1024,
    });
    const { readFile } = await import("node:fs/promises");
    if (digest(await readFile(log)) !== r.logHash)
      throw Error("Primary suite log differs from receipt");
    evidence.push({
      lane: r.lane,
      checkout: r.revision,
      archive,
      archiveHash: await fileDigest(archive),
      log,
      logHash: await fileDigest(log),
      provenance: {
        testedTree: r.testedTree,
        checkout: r.revision,
        runtime: r.runtime,
        dependencies: r.dependencies,
      },
    });
  }
  const identity = sourceIdentity(cwd),
    verified = verifyFull(suiteReceipts, identity);
  if (verified.status !== "passed") throw Error(verified.errors.join("; "));
  const receipts = {},
    rejected = {};
  for (const [name, request] of Object.entries(expected ?? {})) {
    try {
      assertSuiteRequest(name, request);
      const ids = groups[name];
      if (!ids) throw Error("Unsupported named suite group");
      if (
        !request.runtime ||
        !request.dependencies ||
        suiteReceipts.some(
          (r) =>
            digest(r.runtime) !== digest(request.runtime) ||
            digest(r.dependencies) !== digest(request.dependencies),
        )
      )
        throw Error("Explicit exact runtime/dependency identity mismatch");
      const time = Date.now(),
        receipt = {
          importedAt: new Date(time).toISOString(),
          expiresAt: new Date(time + 86400000).toISOString(),
          status: "passed",
          name,
          source: "github-actions",
          repository,
          runId: run.id,
          runAttempt: run.run_attempt,
          runHead: run.head_sha,
          testedTree: identity.testedTree,
          argv: request.argv,
          evidence: evidence.filter((e) =>
            ids.some((id) => e.lane.startsWith(id + ":")),
          ),
          limitations: [
            "Retained-state and cross-platform evidence are not credited",
          ],
        };
      receipt.integrity = evidenceKey(receipt);
      receipts[name] = receipt;
    } catch (error) {
      rejected[name] = error.message;
    }
  }
  const result = {
    run: { id: run.id, head: run.head_sha, attempt: run.run_attempt },
    receipts,
    rejected,
  };
  await saveJSON(path.join(outDir, "ci-import.json"), result);
  return result;
}
