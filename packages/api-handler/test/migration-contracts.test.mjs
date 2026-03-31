import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(import.meta.dirname, "../../../db/migrations/0004_live_participants_multi_role.sql");
const migrationSql = readFileSync(migrationPath, "utf8");
const runtimeOnlyMigrationPath = path.resolve(import.meta.dirname, "../../../db/migrations/0005_runtime_only_live_schema.sql");
const runtimeOnlyMigrationSql = readFileSync(runtimeOnlyMigrationPath, "utf8");

test("live participants migration allows one identity to occupy multiple roles", () => {
  assert.match(migrationSql, /PRIMARY KEY \(game_id, identity_id, role\)/);
  assert.match(migrationSql, /ALTER TABLE live_participants_v2 RENAME TO live_participants/);
});

test("runtime-only live schema migration preserves retained rows and drops dead tables", () => {
  assert.match(runtimeOnlyMigrationSql, /CREATE TABLE live_invites_v2/);
  assert.match(runtimeOnlyMigrationSql, /SELECT\s+token,\s+game_id,\s+shared_by_role\s+FROM live_invites/s);
  assert.match(runtimeOnlyMigrationSql, /CREATE TABLE live_events_v2/);
  assert.match(runtimeOnlyMigrationSql, /SELECT\s+game_id,\s+event_seq,\s+payload_json\s+FROM live_events/s);
  assert.match(runtimeOnlyMigrationSql, /DROP TABLE live_participants/);
  assert.match(runtimeOnlyMigrationSql, /DROP TABLE live_join_requests/);
  assert.doesNotMatch(runtimeOnlyMigrationSql, /created_at TEXT NOT NULL/);
  assert.doesNotMatch(runtimeOnlyMigrationSql, /actor_identity_id/);
  assert.doesNotMatch(runtimeOnlyMigrationSql, /event_type/);
});
