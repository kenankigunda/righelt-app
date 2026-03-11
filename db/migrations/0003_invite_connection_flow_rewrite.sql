ALTER TABLE shell_live_games ADD COLUMN event_seq INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS shell_live_events (
  game_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_identity_id TEXT,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (game_id, event_seq)
);

CREATE TABLE IF NOT EXISTS shell_live_participants (
  game_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Player 1', 'Player 2', 'Viewer')),
  joined_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL,
  connected INTEGER NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, identity_id)
);

CREATE TABLE IF NOT EXISTS shell_live_join_requests (
  game_id TEXT NOT NULL,
  requester_identity_id TEXT NOT NULL,
  requested_seat TEXT NOT NULL CHECK (requested_seat IN ('Player 1', 'Player 2')),
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  PRIMARY KEY (game_id, requester_identity_id)
);

CREATE INDEX IF NOT EXISTS idx_shell_live_events_game_seq
  ON shell_live_events(game_id, event_seq);

CREATE INDEX IF NOT EXISTS idx_shell_live_participants_game
  ON shell_live_participants(game_id, role);

CREATE INDEX IF NOT EXISTS idx_shell_live_join_requests_game
  ON shell_live_join_requests(game_id, status);
