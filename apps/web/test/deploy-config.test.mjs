import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

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
