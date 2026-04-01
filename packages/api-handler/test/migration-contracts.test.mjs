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
const liveGameHomeSummariesMigrationPath = path.resolve(import.meta.dirname, "../../../db/migrations/0007_live_game_home_page_summaries.sql");
const liveGameHomeSummariesMigrationSql = readFileSync(liveGameHomeSummariesMigrationPath, "utf8");

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

test("home-page summary migration adds persisted section filter columns and backfills them from state_json", () => {
  assert.match(liveGameHomeSummariesMigrationSql, /ALTER TABLE live_games ADD COLUMN player1_identity_id TEXT;/);
  assert.match(liveGameHomeSummariesMigrationSql, /ALTER TABLE live_games ADD COLUMN player2_identity_id TEXT;/);
  assert.match(liveGameHomeSummariesMigrationSql, /ALTER TABLE live_games ADD COLUMN has_smoke_player INTEGER NOT NULL DEFAULT 0;/);
  assert.match(liveGameHomeSummariesMigrationSql, /player1_identity_id = json_extract\(state_json, '\$\.player1\.identityId'\)/);
  assert.match(liveGameHomeSummariesMigrationSql, /player2_identity_id = json_extract\(state_json, '\$\.player2\.identityId'\)/);
  assert.match(liveGameHomeSummariesMigrationSql, /FROM json_each\(COALESCE\(json_extract\(state_json, '\$\.viewers'\), '\[\]'\)\)/);
  assert.match(liveGameHomeSummariesMigrationSql, /FROM json_each\(COALESCE\(json_extract\(state_json, '\$\.pendingJoinRequests'\), '\[\]'\)\)/);
  assert.match(liveGameHomeSummariesMigrationSql, /CREATE INDEX IF NOT EXISTS idx_live_games_home_my/);
  assert.match(liveGameHomeSummariesMigrationSql, /CREATE INDEX IF NOT EXISTS idx_live_games_home_smoke/);
});
