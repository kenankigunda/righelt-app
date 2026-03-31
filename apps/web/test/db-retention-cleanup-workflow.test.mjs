import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "db-retention-cleanup.yml");
const workflow = readFileSync(workflowPath, "utf8");
const cleanupSqlPath = path.join(repoRoot, "db", "ops", "cleanup-live-data.sql");
const cleanupSql = readFileSync(cleanupSqlPath, "utf8");

test("D1 retention cleanup workflow is manual and requires an explicit retention input", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:\n    inputs:\n      retention_hours:\n[\s\S]*required: true/m);
  assert.doesNotMatch(workflow, /^\s+workflow_run:/m);
  assert.match(workflow, /DB_RETENTION_HOURS: \${{ inputs\.retention_hours }}/);
});

test("D1 retention cleanup workflow validates retention hours before execution", () => {
  assert.match(workflow, /name: Prepare retention cleanup inputs/);
  assert.match(workflow, /name: DB Retention Cleanup/);
  assert.match(workflow, /node scripts\/db-retention-cleanup-github\.mjs/);
  assert.match(workflow, /REPORT_SQL_PATH/);
  assert.match(workflow, /CLEANUP_SQL_PATH/);
});

test("cleanup SQL deletes stale live data by latest activity in dependency-safe order", () => {
  assert.match(cleanupSql, /latest_activity_at < datetime\('now', '-' \|\| \?1 \|\| ' hours'\)/);
  assert.equal(cleanupSql.includes("milestone_actions"), false);

  const eventsIndex = cleanupSql.indexOf("DELETE FROM live_events");
  const participantsIndex = cleanupSql.indexOf("DELETE FROM live_participants");
  const joinRequestsIndex = cleanupSql.indexOf("DELETE FROM live_join_requests");
  const invitesIndex = cleanupSql.indexOf("DELETE FROM live_invites");
  const gamesIndex = cleanupSql.indexOf("DELETE FROM live_games");

  assert.ok(eventsIndex >= 0);
  assert.ok(participantsIndex > eventsIndex);
  assert.ok(joinRequestsIndex > participantsIndex);
  assert.ok(invitesIndex > joinRequestsIndex);
  assert.ok(gamesIndex > invitesIndex);
});
