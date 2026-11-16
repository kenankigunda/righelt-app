import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { stampClientBuild, readEmbeddedClientBuild } from "../../../scripts/client-build-identity.mjs";
import { boundarySmoke } from "../../../scripts/deploy-boundary-smoke.mjs";

const webDir = path.resolve(import.meta.dirname, "..");
const wranglerConfigPath = path.join(webDir, "wrangler.toml");
const wranglerConfig = readFileSync(wranglerConfigPath, "utf8");
const apiDir = path.resolve(webDir, "..", "api");
const apiWranglerConfigPath = path.join(apiDir, "wrangler.toml");
const apiWranglerConfig = readFileSync(apiWranglerConfigPath, "utf8");

test("Pages config opts into config-file mode and keeps a proxy function entrypoint", () => {
  assert.match(wranglerConfig, /^pages_build_output_dir = "\."$/m);
  assert.equal(existsSync(path.join(webDir, "functions", "api", "[[path]].js")), true);
});

test("Pages config no longer declares a combined worker main entrypoint", () => {
  assert.doesNotMatch(wranglerConfig, /^main = /m);
  assert.equal(existsSync(path.join(webDir, "_worker.js")), false);
});

test("Pages config binds API_SERVICE to righelt-api", () => {
  assert.match(wranglerConfig, /\[\[services\]\][\s\S]*^binding = "API_SERVICE"$[\s\S]*^service = "righelt-api"$/m);
  assert.doesNotMatch(wranglerConfig, /\[\[d1_databases\]\]/m);
  assert.doesNotMatch(wranglerConfig, /\[\[durable_objects\.bindings\]\]/m);
});

test("API worker config owns DB and GameRoomDO bindings", () => {
  assert.match(apiWranglerConfig, /^name = "righelt-api"$/m);
  assert.match(apiWranglerConfig, /^\[observability\]$/m);
  assert.match(apiWranglerConfig, /\[observability\.logs\][\s\S]*^enabled = true$[\s\S]*^invocation_logs = true$/m);
  assert.match(apiWranglerConfig, /\[observability\.traces\][\s\S]*^enabled = false$/m);
  assert.match(apiWranglerConfig, /\[\[d1_databases\]\][\s\S]*^binding = "DB"$/m);
  assert.match(
    apiWranglerConfig,
    /\[\[durable_objects\.bindings\]\][\s\S]*^name = "GAME_ROOMS"$[\s\S]*^class_name = "GameRoomDO"$/m,
  );
  assert.match(apiWranglerConfig, /\[\[migrations\]\][\s\S]*^new_sqlite_classes = \["GameRoomDO"\]$/m);
});

test("deployment builds production browser assets before publishing Pages", () => {
  const source = readFileSync(new URL("../../../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const build = source.indexOf("run: pnpm build:web-engine");
  assert.ok(build >= 0);
  assert.ok(build < source.indexOf("wrangler pages deploy"));
});

test("automatic deployment accepts only successful push CI runs on main", () => {
  const source = readFileSync(new URL("../../../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(source, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(source, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(source, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.doesNotMatch(source, /workflows: \["Nightly validation"\]/);
});

test("client build stamping accepts one exact commit and fails closed otherwise", () => {
  const source = 'globalThis.__righeltClientBuild = "unavailable"; // RIGHELT_CLIENT_BUILD';
  const sha = "a".repeat(40);
  const stamped = stampClientBuild(source, sha);
  assert.equal(readEmbeddedClientBuild(stamped), sha);
  for (const invalid of ["", "main", "A".repeat(40)]) assert.throws(() => stampClientBuild(source, invalid));
  assert.throws(() => stampClientBuild("export {};", sha));
});

test("deployment smoke verifies the exact loaded main artifact commit", async () => {
  const sha = "b".repeat(40), privateOrigin = "https://private.example", origin = "https://public.example";
  const waits = [];
  let now = 0;
  const timing = {
    now: () => now,
    wait: async delay => {
      waits.push(delay);
      now += delay;
    },
    within: operation => operation,
  };
  const observed = ["a".repeat(40), "a".repeat(40), sha];
  const clientOptions = [];
  const fetcher = async (url, options) => {
    if (url.pathname === "/api/health" && url.origin === origin) return Response.json({ok:true,bindings:{db:true,gameRooms:true}});
    if (url.pathname === "/api/health" && url.origin === privateOrigin) return new Response(null,{status:404,headers:{server:"cloudflare"}});
    if (url.pathname === "/main.js") {
      clientOptions.push(options);
      const build = observed.shift();
      return new Response(`globalThis.__righeltClientBuild = "${build}"; // RIGHELT_CLIENT_BUILD`);
    }
    throw Error(`unexpected ${url}`);
  };
  await assert.doesNotReject(boundarySmoke({origin,privateOrigin,expectedCommit:sha,fetcher,timing}));
  assert.deepEqual(waits, [500, 1000]);
  assert.equal(clientOptions.length, 3);
  assert.ok(clientOptions.every(options => options.cache === "no-store"));
  await assert.rejects(boundarySmoke({origin,privateOrigin,expectedCommit:"main",fetcher,timing}),/expected deployment commit/i);
});

test("deployment smoke fails after a finite exact-client propagation window", async () => {
  const expectedCommit = "b".repeat(40), observedCommit = "a".repeat(40);
  const privateOrigin = "https://private.example", origin = "https://public.example";
  let now = 0, clientReads = 0;
  const waits = [];
  const timing = {
    now: () => now,
    wait: async delay => {
      waits.push(delay);
      now += delay;
    },
    within: operation => operation,
  };
  const fetcher = async url => {
    if (url.pathname === "/api/health" && url.origin === origin) return Response.json({ok:true,bindings:{db:true,gameRooms:true}});
    if (url.pathname === "/api/health" && url.origin === privateOrigin) return new Response(null,{status:404,headers:{server:"cloudflare"}});
    if (url.pathname === "/main.js") {
      clientReads += 1;
      return new Response(`globalThis.__righeltClientBuild = "${observedCommit}"; // RIGHELT_CLIENT_BUILD`);
    }
    throw Error(`unexpected ${url}`);
  };
  await assert.rejects(
    boundarySmoke({origin,privateOrigin,expectedCommit,fetcher,timing}),
    /propagation deadline/i,
  );
  assert.equal(now, 30_000);
  assert.ok(clientReads > 2);
  assert.equal(waits.at(-1), 500);
});

test("deployment smoke never retries malformed or failed client reads", async () => {
  const expectedCommit = "b".repeat(40), oldCommit = "a".repeat(40);
  const privateOrigin = "https://private.example", origin = "https://public.example";
  let now = 0, clientReads = 0;
  const waits = [];
  const timing = {
    now: () => now,
    wait: async delay => {
      waits.push(delay);
      now += delay;
    },
    within: operation => operation,
  };
  const fetcher = async url => {
    if (url.pathname === "/api/health" && url.origin === origin) return Response.json({ok:true,bindings:{db:true,gameRooms:true}});
    if (url.pathname === "/api/health" && url.origin === privateOrigin) return new Response(null,{status:404,headers:{server:"cloudflare"}});
    if (url.pathname === "/main.js") {
      clientReads += 1;
      if (clientReads === 1)
        return new Response(`globalThis.__righeltClientBuild = "${oldCommit}"; // RIGHELT_CLIENT_BUILD`);
      return new Response("export {};");
    }
    throw Error(`unexpected ${url}`);
  };
  await assert.rejects(
    boundarySmoke({origin,privateOrigin,expectedCommit,fetcher,timing}),
    /missing or malformed/i,
  );
  assert.equal(clientReads, 2);
  assert.deepEqual(waits, [500]);
});

test("deployment smoke aborts a client read at its bounded deadline", async () => {
  const expectedCommit = "b".repeat(40);
  const privateOrigin = "https://private.example", origin = "https://public.example";
  let now = 0, aborted = false;
  const timing = {
    now: () => now,
    wait: async delay => { now += delay; },
    within: async (operation, timeout, onTimeout) => {
      void operation.catch(() => {});
      now += timeout;
      onTimeout();
      throw Error("Client artifact verification timed out");
    },
  };
  const fetcher = async (url, options) => {
    if (url.pathname === "/api/health" && url.origin === origin) return Response.json({ok:true,bindings:{db:true,gameRooms:true}});
    if (url.pathname === "/api/health" && url.origin === privateOrigin) return new Response(null,{status:404,headers:{server:"cloudflare"}});
    if (url.pathname === "/main.js") {
      options.signal.addEventListener("abort", () => { aborted = true; });
      return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason)));
    }
    throw Error(`unexpected ${url}`);
  };
  await assert.rejects(
    boundarySmoke({origin,privateOrigin,expectedCommit,fetcher,timing}),
    /timed out/i,
  );
  assert.equal(now, 15_000);
  assert.equal(aborted, true);
});

test("deployment smoke rejects an exact client that arrives after the deadline", async () => {
  const expectedCommit = "b".repeat(40);
  const privateOrigin = "https://private.example", origin = "https://public.example";
  let now = 0;
  const timing = {
    now: () => now,
    wait: async delay => { now += delay; },
    within: async operation => {
      const result = await operation;
      now = 30_001;
      return result;
    },
  };
  const fetcher = async url => {
    if (url.pathname === "/api/health" && url.origin === origin) return Response.json({ok:true,bindings:{db:true,gameRooms:true}});
    if (url.pathname === "/api/health" && url.origin === privateOrigin) return new Response(null,{status:404,headers:{server:"cloudflare"}});
    if (url.pathname === "/main.js")
      return new Response(`globalThis.__righeltClientBuild = "${expectedCommit}"; // RIGHELT_CLIENT_BUILD`);
    throw Error(`unexpected ${url}`);
  };
  await assert.rejects(
    boundarySmoke({origin,privateOrigin,expectedCommit,fetcher,timing}),
    /propagation deadline/i,
  );
});
