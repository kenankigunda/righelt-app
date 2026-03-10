CREATE TABLE IF NOT EXISTS shell_live_games (
  game_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  latest_activity_at TEXT NOT NULL,
  offline_local INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shell_live_invites (
  token TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  shared_by_role TEXT NOT NULL CHECK (shared_by_role IN ('Viewer', 'Player 1', 'Player 2')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shell_live_games_latest_activity
  ON shell_live_games(latest_activity_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shell_live_games_online_visibility
  ON shell_live_games(offline_local, latest_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_shell_live_invites_game
  ON shell_live_invites(game_id);
