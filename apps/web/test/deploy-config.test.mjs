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
  const fetcher = async url => {
    if (url.pathname === "/api/health" && url.origin === origin) return Response.json({ok:true,bindings:{db:true,gameRooms:true}});
    if (url.pathname === "/api/health" && url.origin === privateOrigin) return new Response(null,{status:404,headers:{server:"cloudflare"}});
    if (url.pathname === "/main.js") return new Response(`globalThis.__righeltClientBuild = "${sha}"; // RIGHELT_CLIENT_BUILD`);
    throw Error(`unexpected ${url}`);
  };
  await assert.doesNotReject(boundarySmoke({origin,privateOrigin,expectedCommit:sha,fetcher}));
  await assert.rejects(boundarySmoke({origin,privateOrigin,expectedCommit:"c".repeat(40),fetcher}),/loaded client commit/i);
  await assert.rejects(boundarySmoke({origin,privateOrigin,expectedCommit:"main",fetcher}),/expected deployment commit/i);
});
