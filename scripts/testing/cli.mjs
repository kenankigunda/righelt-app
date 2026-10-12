import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { SUITES, fullLanes, laneKey } from "./catalog.mjs";
import { affectedPlan } from "./plan.mjs";
import { runSuite } from "./run.mjs";
import { sourceIdentity, verifyFull, readReceipts } from "./receipts.mjs";
const [mode, ...args] = process.argv.slice(2),
  flags = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--")) throw Error(`Unexpected argument ${args[i]}`);
  flags[args[i].slice(2)] =
    args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
}
try {
  const cwd = process.cwd(),
    out = String(flags.out ?? `test-results/suites/${Date.now()}`);
  if (mode === "plan" || mode === "affected") {
    const plan = affectedPlan(cwd, flags.base ?? "origin/main");
    console.log(JSON.stringify(plan, null, 2));
    if (mode === "affected") {
      await mkdir(out, { recursive: true });
      await writeFile(
        path.join(out, "plan.json"),
        JSON.stringify(plan, null, 2),
      );
      for (const id of plan.suites) {
        const r = await runSuite(
          { suite: id, project: null, shard: 1, shards: 1 },
          { cwd, out },
        );
        if (r.status !== "passed") {
          process.exitCode = 1;
          break;
        }
      }
      console.log(
        "Focused evidence is advisory. Full validation remains required before merge.",
      );
    }
  } else if (mode === "suite") {
    const r = await runSuite(
      {
        suite: String(flags.suite),
        project: flags.project ?? null,
        shard: Number(flags.shard ?? 1),
        shards: Number(flags.shards ?? 1),
      },
      { cwd, out },
    );
    console.log(`${r.lane}: ${r.status}`);
    if (r.status !== "passed") process.exitCode = 1;
  } else if (mode === "full") {
    const identity = sourceIdentity(cwd),
      receipts = [];
    for (const lane of fullLanes()) {
      const r = await runSuite(lane, { cwd, out });
      receipts.push(r);
      if (r.status !== "passed") break;
    }
    const result = verifyFull(receipts, identity);
    await mkdir(out, { recursive: true });
    await writeFile(
      path.join(out, "full.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "passed") process.exitCode = 1;
  } else if (mode === "verify") {
    const result = verifyFull(readReceipts(out), sourceIdentity(cwd));
    await writeFile(
      path.join(out, "full.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "passed") process.exitCode = 1;
  } else throw Error("Use plan, affected, suite, full or verify");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
