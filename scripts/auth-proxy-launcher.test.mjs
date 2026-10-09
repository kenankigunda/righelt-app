import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const mode of ["empty", "fault", "incomplete"]) test(`real Playwright reporter override cannot bypass ${mode} journal gate`, { timeout: 20000 }, async () => {
  const directory = await mkdtemp(path.join(root, ".auth-receipt-test-"));
  try {
    const setup = `import {randomUUID} from 'node:crypto';
import {createProxyFailureJournal,recordProxyFailure,completeProxyFailureJournal} from ${JSON.stringify(new URL("./auth-proxy-failures.mjs", import.meta.url).href)};
export default async function() {
 const directory=process.env.RIGHELT_AUTH_FAILURE_DIRECTORY,runId=process.env.RIGHELT_AUTH_FAILURE_RUN_ID;
 await createProxyFailureJournal(directory,runId);
 if (${JSON.stringify(mode)}==='fault') await recordProxyFailure({schema:1,runId,requestId:randomUUID(),category:'network_connection_lost',path:'other',method:'POST'},{...process.env,RIGHELT_AUTH_FAILURE_SERVICE:'web'});
 return async()=>{if(${JSON.stringify(mode)}!=='incomplete')await completeProxyFailureJournal(directory,runId,true);};
}`;
    await writeFile(path.join(directory, "setup.mjs"), setup);
    await writeFile(path.join(directory, "proof.spec.mjs"), "import {test,expect} from '@playwright/test'; test('browser assertion passes',()=>expect(1).toBe(1));\n");
    const config = path.join(directory, "config.mjs");
    await writeFile(config, "export default {testDir: ".concat(JSON.stringify(directory), ",globalSetup: './setup.mjs', workers:1};\n"));
    const child = spawn(process.execPath, [path.join(root, "scripts/run-auth-e2e.mjs"), "--config", config, "--reporter=line"], { cwd: root, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.match(output, /1 passed/); assert.equal(code, mode === "empty" ? 0 : 1, output);
    if (mode === "fault") assert.match(output, /1 unresolved transport failure/);
    if (mode === "incomplete") assert.match(output, /accounting is incomplete/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
