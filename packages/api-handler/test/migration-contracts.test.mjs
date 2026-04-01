import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(import.meta.dirname, "../../../db/migrations/0004_live_participants_multi_role.sql");
const migrationSql = readFileSync(migrationPath, "utf8");
const runtimeOnlyMigrationPath = path.resolve(import.meta.dirname, "../../../db/migrations/0005_runtime_only_live_schema.sql");
const runtimeOnlyMigrationSql = readFileSync(runtimeOnlyMigrationPath, "utf8");
const dropMilestoneActionsMigrationPath = path.resolve(import.meta.dirname, "../../../db/migrations/0006_drop_milestone_actions.sql");
const dropMilestoneActionsMigrationSql = readFileSync(dropMilestoneActionsMigrationPath, "utf8");
const purgeLiveRuntimeDataMigrationPath = path.resolve(import.meta.dirname, "../../../db/migrations/0007_purge_live_runtime_data.sql");
const purgeLiveRuntimeDataMigrationSql = readFileSync(purgeLiveRuntimeDataMigrationPath, "utf8");
const purgeLiveDataPath = path.resolve(import.meta.dirname, "../../../db/ops/purge-live-data.sql");
const purgeLiveDataSql = readFileSync(purgeLiveDataPath, "utf8");

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

test("follow-up cleanup migration drops the legacy milestone actions table", () => {
  assert.match(dropMilestoneActionsMigrationSql, /DROP TABLE IF EXISTS milestone_actions;/);
});

test("live runtime purge migration clears events, invites, and games in dependency-safe order", () => {
  const eventsIndex = purgeLiveRuntimeDataMigrationSql.indexOf("DELETE FROM live_events");
  const invitesIndex = purgeLiveRuntimeDataMigrationSql.indexOf("DELETE FROM live_invites");
  const gamesIndex = purgeLiveRuntimeDataMigrationSql.indexOf("DELETE FROM live_games");

  assert.ok(eventsIndex >= 0);
  assert.ok(invitesIndex > eventsIndex);
  assert.ok(gamesIndex > invitesIndex);
});

test("live data purge SQL clears events, invites, and games in dependency-safe order", () => {
  const eventsIndex = purgeLiveDataSql.indexOf("DELETE FROM live_events");
  const invitesIndex = purgeLiveDataSql.indexOf("DELETE FROM live_invites");
  const gamesIndex = purgeLiveDataSql.indexOf("DELETE FROM live_games");

  assert.ok(eventsIndex >= 0);
  assert.ok(invitesIndex > eventsIndex);
  assert.ok(gamesIndex > invitesIndex);
});
