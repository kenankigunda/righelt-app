import { recordUnexpectedExit } from './testing/stack-status.mjs';
import { cliPath, supervise } from './resources/supervisor.mjs';
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { e2eControlPort } from "./e2e-control.mjs";
import { randomUUID } from "node:crypto";
import { storageFixtureSource } from "./storage-e2e-fixture.mjs";
import os from "node:os";
import path from "node:path";

import { buildLocalApiOrigin, resolveLocalApiPort } from "../apps/web/local-dev-ports.js";

export const DEFAULT_E2E_WEB_PORT = "9888";
export const DEFAULT_E2E_READY_TIMEOUT_MS = 120_000;
const DEFAULT_DB_NAME = process.env.CLOUDFLARE_D1_DB_NAME || "DB";

const repoRoot = process.cwd();
const webPort = process.env.RIGHELT_E2E_WEB_PORT || DEFAULT_E2E_WEB_PORT;
const apiPort = String(resolveLocalApiPort(webPort));
const apiOrigin = buildLocalApiOrigin(webPort);
const apiHealthUrl = `${apiOrigin}/api/health`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const autoPersistRoot = process.env.RIGHELT_E2E_PERSIST_ROOT || "";
const managedChildren = new Set();
let tempRoot = "";
let shuttingDown = false;
const intentionalStops = new Set();
let controlServer;
let restartActive = false;
const stopChild = async child => {
 intentionalStops.add(child);
 const signal = value => { try { child.kill(value); } catch {} };
 const stopped = new Promise(resolve=>child.once("exit",resolve));
 signal("SIGTERM");
 // Give the supervisor its five-second grace period and cleanup verification.
 const timer=setTimeout(()=>signal("SIGKILL"),9000);
 await Promise.race([stopped,new Promise(resolve=>setTimeout(resolve,10000))]);
 clearTimeout(timer);
 signal("SIGKILL");
};

export const createE2ePersistRoot = async () => {
  if (autoPersistRoot) {
    await mkdir(autoPersistRoot, { recursive: true });
    return autoPersistRoot;
  }
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "righelt-e2e-"));
  return tempRoot;
};

const waitForHttp = async (url, label, timeoutMs = DEFAULT_E2E_READY_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the stack is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${label} at ${url}`);
};

const spawnLogged = (label, command, args, options) => {
  const child = spawn(process.execPath, [cliPath, "run", "--kind", "preview", "--", command, ...args], {
    ...options,
    // Playwright signals the stack's process group at teardown. Keep service
    // supervisors outside it so the stack records shutdown before stopping them.
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  managedChildren.add(child);
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });
  child.on("exit", (code, signal) => {
    managedChildren.delete(child);
    if (shuttingDown || intentionalStops.has(child)) {
      return;
    }
    {
      recordUnexpectedExit(label, code, signal);
      console.error(`[e2e-stack] ${label} exited with code ${code}${signal ? ` (signal ${signal})` : ""}`);
      shutdown(code || 1);
    }
  });
  return child;
};

const runBlocking = (label, command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${code}`));
    });
    child.on("error", reject);
  });

const shutdown = async (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  controlServer?.close();
  await Promise.allSettled([...managedChildren].map(stopChild));

  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
  process.exit(exitCode);
};

const run = async () => {
  const persistRoot = await createE2ePersistRoot();
  let apiPersistPath = path.join(persistRoot, "api-state");
  const storageProfile=process.env.RIGHELT_E2E_STORAGE_ARCHIVES==="1";
  let generation=process.env.RIGHELT_E2E_STORAGE_GENERATION||(storageProfile?"e2e-storage-v1":"");
  const fixtureSecret=randomUUID();
  let apiConfig="wrangler.toml";
  if(storageProfile){
    const entry=path.join(persistRoot,"storage-worker.mjs");
    await writeFile(entry,storageFixtureSource(path.join(repoRoot,"apps/api/index.js")));
    let config=await readFile(path.join(repoRoot,"apps/api/wrangler.toml"),"utf8");
    config=config.replace('main = "index.js"',`main = ${JSON.stringify(entry)}`)
      .replace('migrations_dir = "../../db/migrations"',`migrations_dir = ${JSON.stringify(path.join(repoRoot,"db/migrations"))}`)
      .replace('STORAGE_ARCHIVES_ENABLED = "false"','STORAGE_ARCHIVES_ENABLED = "true"')
      .replace('[vars]',`[vars]\nSTORAGE_FIXTURE_SECRET = ${JSON.stringify(fixtureSecret)}`);
    config+='\n[[r2_buckets]]\nbinding = "ARCHIVES"\nbucket_name = "local-storage-e2e"\n';
    apiConfig=path.join(persistRoot,"storage-api.toml");await writeFile(apiConfig,config);
  }
  await mkdir(apiPersistPath, { recursive: true });

  process.on("SIGINT", () => {
    void shutdown(0);
  });
  process.on("SIGTERM", () => {
    void shutdown(0);
  });

  const migrate=async()=>{await runBlocking(
    "local D1 migrations",
    "pnpm",
    [
      "--dir",
      "apps/api",
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      DEFAULT_DB_NAME,
      "--config",
      apiConfig,
      "--local",
      "--persist-to",
      apiPersistPath,
    ],
    { cwd: repoRoot },
  );
  if(storageProfile)await runBlocking("local archive budget","pnpm",["--dir","apps/api","exec","wrangler","d1","execute","DB","--config",apiConfig,"--local","--persist-to",apiPersistPath,"--command","UPDATE storage_budget SET healthy=1,observed_at=datetime('now') WHERE singleton=1"],{cwd:repoRoot});
  };
  await migrate();

  const startApi = () => spawnLogged(
    "api",
    "pnpm",
    [
      "--dir",
      "apps/api",
      "exec",
      "wrangler",
      "dev",
      "--config",
      apiConfig,
      "--port",
      apiPort,
      "--var",`STORAGE_GENERATION:${generation}`,
      "--persist-to",
      apiPersistPath,
    ],
    { cwd: repoRoot },
  );
  let apiChild = startApi();
  // Test-runner-only loopback control: not served by Pages or the application Worker.
  controlServer = createServer(async (request, response) => {
    // Cross-origin websites cannot invoke local runner controls.
    if(request.headers.origin){response.writeHead(403).end();return;}
    if(storageProfile && request.method==="POST" && request.url==="/storage"){
      try{let body="";for await(const chunk of request){body+=chunk;if(body.length>2048)throw Error("too_large");}
        const result=await fetch(`${apiOrigin}/__storage_fixture`,{method:"POST",headers:{"content-type":"application/json","x-fixture-secret":fixtureSecret},body});
        response.writeHead(result.status,{"content-type":"application/json"}).end(await result.text());
      }catch{response.writeHead(500).end();}return;
    }
    const reset=storageProfile && request.url==="/reset-storage";
    if (request.method !== "POST" || (!reset && request.url !== "/restart")) { response.writeHead(404).end(); return; }
    if (restartActive) { response.writeHead(409).end(); return; }
    restartActive=true;
    try {
      await stopChild(apiChild);
      const deadline=Date.now()+5000;
      let down=false;
      while(Date.now()<deadline) {
        try { await fetch(apiHealthUrl,{signal:AbortSignal.timeout(500)}); } catch { down=true; break; }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if (!down || shuttingDown) throw new Error("API did not stop or stack is shutting down");
      if(reset){generation=`e2e-storage-${randomUUID()}`;apiPersistPath=path.join(persistRoot,generation);await mkdir(apiPersistPath,{recursive:true});await migrate();}
      apiChild = startApi();
      await waitForHttp(apiHealthUrl, "restarted local API");
      response.writeHead(200).end("restarted");
    } catch (error) { response.writeHead(500).end(String(error)); } finally { restartActive=false; }
  }).listen(e2eControlPort(webPort), "127.0.0.1");
  await waitForHttp(apiHealthUrl, "local API");

  spawnLogged("pages", "pnpm", ["exec", "wrangler", "pages", "dev", ".", "--port", webPort], {
    cwd: path.join(repoRoot, "apps", "web"),
  });
  await waitForHttp(webOrigin, "local Pages app");

  console.log(`[e2e-stack] ready at ${webOrigin} with API ${apiOrigin}`);
};

if (!process.env.RIGHELT_RESOURCE_RUN) {
  process.exitCode = (await supervise([process.execPath, ...process.argv.slice(1)], { kind: 'preview' })).code;
} else await run().catch(async (error) => {
  console.error("[e2e-stack] failed to start", error);
  await shutdown(1);
});
