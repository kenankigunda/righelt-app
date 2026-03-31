import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const validateRetentionHours = (value, sourceLabel = "retention hours") => {
  if (!value) {
    throw new Error(`Missing required ${sourceLabel}`);
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${sourceLabel} must be a positive integer`);
  }
  return value;
};

export const buildStaleCondition = (retentionHours) =>
  `latest_activity_at < datetime('now', '-${retentionHours} hours')`;

export const buildReportSql = (retentionHours) => {
  const staleCondition = buildStaleCondition(retentionHours);
  return `SELECT 'live_games' AS table_name, COUNT(*) AS stale_row_count
FROM live_games
WHERE ${staleCondition}
UNION ALL
SELECT 'live_events' AS table_name, COUNT(*) AS stale_row_count
FROM live_events
WHERE game_id IN (
  SELECT game_id
  FROM live_games
  WHERE ${staleCondition}
)
UNION ALL
SELECT 'live_participants' AS table_name, COUNT(*) AS stale_row_count
FROM live_participants
WHERE game_id IN (
  SELECT game_id
  FROM live_games
  WHERE ${staleCondition}
)
UNION ALL
SELECT 'live_join_requests' AS table_name, COUNT(*) AS stale_row_count
FROM live_join_requests
WHERE game_id IN (
  SELECT game_id
  FROM live_games
  WHERE ${staleCondition}
)
UNION ALL
SELECT 'live_invites' AS table_name, COUNT(*) AS stale_row_count
FROM live_invites
WHERE game_id IN (
  SELECT game_id
  FROM live_games
  WHERE ${staleCondition}
);`;
};

export const buildCleanupSql = (cleanupSqlTemplate, retentionHours) =>
  cleanupSqlTemplate.replace(/\?1/g, retentionHours);

export const createCleanupSqlFiles = ({
  repoRoot,
  retentionHours,
  tempDir,
}) => {
  const cleanupSqlTemplate = readFileSync(path.join(repoRoot, "db", "ops", "cleanup-live-data.sql"), "utf8");
  const workingDir = tempDir || mkdtempSync(path.join(os.tmpdir(), "righelt-db-retention-"));
  const reportSqlPath = path.join(workingDir, "db-retention-report.sql");
  const cleanupSqlPath = path.join(workingDir, "db-retention-cleanup.sql");

  writeFileSync(reportSqlPath, buildReportSql(retentionHours));
  writeFileSync(cleanupSqlPath, buildCleanupSql(cleanupSqlTemplate, retentionHours));

  return {
    reportSqlPath,
    cleanupSqlPath,
    workingDir,
  };
};
