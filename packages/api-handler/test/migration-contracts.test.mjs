import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(import.meta.dirname, "../../../db/migrations/0004_live_participants_multi_role.sql");
const migrationSql = readFileSync(migrationPath, "utf8");

test("live participants migration allows one identity to occupy multiple roles", () => {
  assert.match(migrationSql, /PRIMARY KEY \(game_id, identity_id, role\)/);
  assert.match(migrationSql, /ALTER TABLE live_participants_v2 RENAME TO live_participants/);
});
