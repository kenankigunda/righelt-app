-- Milestone 1 validation table (used by /api/test-action)
CREATE TABLE IF NOT EXISTS milestone_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
