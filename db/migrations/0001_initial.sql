-- Legacy milestone validation table. Removed from the runtime schema by 0005.
CREATE TABLE IF NOT EXISTS milestone_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
