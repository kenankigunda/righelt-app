import {readFile} from 'node:fs/promises';
import {validateStorageEvidence,validateStorageJobExecution} from '../testing/storage-evidence.mjs';
import {expectedCILayout} from '../testing/ci-layouts.mjs';
import {listRunArtifacts,listRunJobs} from '../testing/artifact-inventory.mjs';
import { cachedArtifact, artifactCacheKey } from "./ci-artifact-cache.mjs";
import { selectSuiteArtifacts } from "../testing/select-artifacts.mjs";
import path from "node:path";
import {createReadStream} from "node:fs";
import {createHash} from "node:crypto";
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
// Existing v1 seals hash JSON.stringify(Buffer), not raw log bytes. Preserve that
// wire contract without materializing the log; each decimal-byte chunk is bounded.
// fileDigest remains the independent raw primary-file hash stored in evidence.
export async function sealedLogDigest(log) {
  const hash = createHash("sha256").update('{"type":"Buffer","data":[');
  let first = true;
  for await (const chunk of createReadStream(log, {highWaterMark:64 * 1024})) {
    const values = Array.from(chunk).join(",");
    if (values) { hash.update((first ? "" : ",") + values); first = false; }
  }
  return hash.update("]}").digest("hex");
}
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
  artifactCache,
  expectedLayout = 'guest-2-v1',
}) {
  const profile = await expectedCILayout(cwd, expectedLayout);
  const inventory = await listRunArtifacts(api, run.id);
  const artifacts = selectSuiteArtifacts(inventory, {
    runId: run.id,
    headSha: run.head_sha,
    runAttempt: run.run_attempt,
  });
  if (run.conclusion !== "success" || artifacts.length !== profile.lanes.length)
    throw Error("Full current-attempt CI inventory unavailable");
  // Validate all fresh selected metadata before downloading any cached archive.
  if (artifactCache !== undefined)
    for (const artifact of artifacts) artifactCacheKey({repository,run,artifact});
  let storageJobs;
  const storageExecutions=[];
  const suiteReceipts = [],
    evidence = [];
  for (const a of artifacts) {
    if (
      a.workflow_run?.id !== run.id ||
      a.workflow_run?.head_sha !== run.head_sha
    )
      throw Error("Artifact run/head mismatch");
    const download = async archive => execute(
      ["gh", "api", `repos/${repository}/actions/artifacts/${a.id}/zip`, "--allow-escape-sequences"],
      {cwd, log:archive, maxOutputBytes:1024, logStdoutOnly:true},
    );
    const inspect = async (archive, verify = async () => {}, executeArchive, trustedArchiveHash) => {
    const archiveCall=async argv=>executeArchive?(await executeArchive(argv,{cwd})).output:call(argv);
    const archiveExecute=(argv,options)=>executeArchive?executeArchive(argv,options):execute(argv,options);
    await verify();
    // Inspect the complete archive on every hit. Nothing from it is executed,
    // and only the sole receipt and its primary log are streamed out by name.
    const members = (await archiveCall(["unzip", "-Z1", archive])).split("\n").filter(Boolean);
    await verify();
    const names = members.filter(n => n.endsWith(".receipt.json"));
    if (names.length !== 1 || !/^suites\/[\w.-]+\/[\d]+\.receipt\.json$/.test(names[0]))
      throw Error("Unexpected receipt archive inventory");
    if (artifactCache !== undefined && (new Set(members).size !== members.length ||
        members.some(n => n.startsWith("/") || /^[A-Za-z]:/.test(n) || /[\x00-\x1f]/.test(n) || n.includes("\\") || n.split("/").some(p => p === ".." || p === ".")) ||
        !members.includes(names[0].replace(/[^/]+$/, "output.log"))))
      throw Error("Unsafe or incomplete suite archive inventory");
    const r = JSON.parse(await archiveCall(["unzip", "-p", archive, names[0]]));
    await verify();
    suiteReceipts.push(r);
    const lane=profile.lanes.find(l=>laneKey(l)===r.lane);
    if(lane?.suite==='e2e'&&lane.shard===1) {
      const base=`storage-lifecycle/${lane.project}/`,proofName=base+'proof.json';
      if(profile.storageEvidence||members.includes(proofName)) {
        for(const name of[proofName,base+'results.xml',base+'observations.json'])
          if(members.filter(n=>n===name).length!==1)throw Error('Mandatory storage archive evidence missing or duplicate');
        const retained=[];
        for(const [suffix,name]of[['json',proofName],['xml',base+'results.xml'],['observations.json',base+'observations.json']]) {
          const file=path.join(outDir,`storage-${a.id}.${suffix}`);
          await archiveExecute(['unzip','-p',archive,name],{cwd,log:file,logStdoutOnly:true,maxOutputBytes:1024});
          await verify();retained.push(await readFile(file));
        }
        const proof=JSON.parse(retained[0]);
        validateStorageEvidence(proof,retained[1],retained[2],{
          runId:run.id,head:run.head_sha,attempt:Number(a.name.split('-').at(-1)),project:lane.project,identity:sourceIdentity(cwd),
        });
        if(!storageJobs)storageJobs=await listRunJobs(api,run.id);
        storageExecutions.push({project:lane.project,artifactId:a.id,...validateStorageJobExecution(proof,storageJobs)});
      }
    }
    const logName = names[0].replace(/[^/]+$/, "output.log");
    const log = path.join(outDir, `suite-${a.id}.log`);
    await archiveExecute(["unzip", "-p", archive, logName], {
      cwd,
      log,
      logStdoutOnly: true,
      maxOutputBytes: 1024,
    });
    await verify();
    const logHash = await fileDigest(log);
    if (await sealedLogDigest(log) !== r.logHash)
      throw Error("Primary suite log differs from receipt");
    evidence.push({
      lane: r.lane,
      checkout: r.revision,
      archive,
      archiveHash: trustedArchiveHash ?? await fileDigest(archive),
      log,
      logHash,
      provenance: {
        testedTree: r.testedTree,
        checkout: r.revision,
        runtime: r.runtime,
        dependencies: r.dependencies,
      },
    });
    await verify();
    };
    if (artifactCache === undefined) {
      const archive = path.join(outDir, `suite-${a.id}.zip`);
      await download(archive);
      await inspect(archive);
    } else await cachedArtifact({root:artifactCache,repository,run,artifact:a,download,consumptionDir:outDir},
      ({archive,verify,executeArchive,archiveHash}) => inspect(archive,verify,executeArchive,archiveHash));
  }
  const identity = sourceIdentity(cwd),
    verified = verifyFull(suiteReceipts, identity, {lanes:profile.lanes,catalog:profile.catalog});
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
    expectedLayout: profile.id,
    storageExecutions,
    storageContract: profile.storageEvidence ? 'mandatory-source-bound-junit-and-execution-proof' : 'historical-job-status-contract; no new storage JUnit credit without retained proof',
    receipts,
    rejected,
  };
  await saveJSON(path.join(outDir, "ci-import.json"), result);
  return result;
}
