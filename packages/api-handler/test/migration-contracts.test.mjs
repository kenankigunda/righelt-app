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
const removeOfflineLocalMigrationPath = path.resolve(import.meta.dirname, "../../../db/migrations/0007_remove_offline_local.sql");
const removeOfflineLocalMigrationSql = readFileSync(removeOfflineLocalMigrationPath, "utf8");
const homePaginationMetadataMigrationPath = path.resolve(
  import.meta.dirname,
  "../../../db/migrations/0008_home_page_pagination_metadata.sql",
);
const homePaginationMetadataMigrationSql = readFileSync(homePaginationMetadataMigrationPath, "utf8");

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

test("offline cleanup migration removes offline-local storage", () => {
  assert.match(removeOfflineLocalMigrationSql, /DROP INDEX IF EXISTS idx_live_games_online_visibility;/);
  assert.match(removeOfflineLocalMigrationSql, /DROP INDEX IF EXISTS idx_live_games_home_my;/);
  assert.match(removeOfflineLocalMigrationSql, /DROP INDEX IF EXISTS idx_live_games_home_smoke;/);
  assert.match(removeOfflineLocalMigrationSql, /ALTER TABLE live_games\s+DROP COLUMN offline_local;/s);
});

test("home pagination metadata migration backfills indexed section columns", () => {
  assert.match(homePaginationMetadataMigrationSql, /CREATE TABLE live_games_v2/);
  assert.match(homePaginationMetadataMigrationSql, /INSERT INTO live_games_v2/);
  assert.match(homePaginationMetadataMigrationSql, /DROP TABLE live_games;/);
  assert.match(homePaginationMetadataMigrationSql, /ALTER TABLE live_games_v2 RENAME TO live_games;/);
  assert.match(homePaginationMetadataMigrationSql, /json_extract\(state_json, '\$\.player1\.identityId'\)/);
  assert.match(homePaginationMetadataMigrationSql, /json_extract\(state_json, '\$\.player2\.identityId'\)/);
  assert.match(homePaginationMetadataMigrationSql, /json_each\(state_json, '\$\.viewers'\)/);
  assert.match(homePaginationMetadataMigrationSql, /json_each\(state_json, '\$\.pendingJoinRequests'\)/);
  assert.match(homePaginationMetadataMigrationSql, /CREATE INDEX IF NOT EXISTS idx_live_games_latest_activity/);
  assert.match(homePaginationMetadataMigrationSql, /idx_live_games_player1_latest_activity/);
  assert.match(homePaginationMetadataMigrationSql, /idx_live_games_player2_latest_activity/);
  assert.match(homePaginationMetadataMigrationSql, /idx_live_games_smoke_latest_activity/);
});
