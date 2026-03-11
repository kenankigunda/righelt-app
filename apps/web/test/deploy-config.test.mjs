import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const webDir = path.resolve(import.meta.dirname, "..");
const wranglerConfigPath = path.join(webDir, "wrangler.toml");
const wranglerConfig = readFileSync(wranglerConfigPath, "utf8");
const gameRoomWorkerConfigPath = path.resolve(webDir, "..", "game-room-worker", "wrangler.toml");
const gameRoomWorkerConfig = readFileSync(gameRoomWorkerConfigPath, "utf8");

test("Pages advanced-mode config points main at _worker.js", () => {
  assert.match(wranglerConfig, /^main = "_worker\.js"$/m);
  assert.equal(existsSync(path.join(webDir, "_worker.js")), true);
});

test("Pages advanced-mode config does not opt into incompatible Pages config-file mode", () => {
  assert.doesNotMatch(wranglerConfig, /^pages_build_output_dir = /m);
});

test("Pages advanced-mode config declares the GAME_ROOMS Durable Object binding", () => {
  assert.match(
    wranglerConfig,
    /\[\[durable_objects\.bindings\]\][\s\S]*^name = "GAME_ROOMS"$[\s\S]*^class_name = "GameRoomDO"$[\s\S]*^script_name = "righelt-game-rooms"$/m,
  );
});

test("game room worker config declares the Durable Object namespace and migration", () => {
  assert.match(
    gameRoomWorkerConfig,
    /\[\[durable_objects\.bindings\]\][\s\S]*^name = "GAME_ROOMS"$[\s\S]*^class_name = "GameRoomDO"$/m,
  );
  assert.match(gameRoomWorkerConfig, /\[\[migrations\]\][\s\S]*^new_sqlite_classes = \["GameRoomDO"\]$/m);
});
