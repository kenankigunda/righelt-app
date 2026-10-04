ALTER TABLE live_games ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_live_games_deleted_at
  ON live_games(deleted_at, latest_activity_at DESC, created_at DESC);
