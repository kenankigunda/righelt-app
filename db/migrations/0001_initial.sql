-- Milestone 1 validation table (used by /api/test-action)
CREATE TABLE IF NOT EXISTS milestone_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Core starter tables from architecture reference
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('STANDARD', 'PLAYGROUND')),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  latest_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  playground_controller_device_id TEXT,
  side_to_move TEXT NOT NULL DEFAULT 'P1',
  winner TEXT
);

CREATE TABLE IF NOT EXISTS participants (
  game_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('PLAYER', 'VIEWER')),
  seat TEXT CHECK (seat IN ('P1', 'P2')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  left_at TEXT,
  last_active_at TEXT,
  invite_source TEXT,
  is_connected INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (game_id, device_id)
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  created_by_device_id TEXT NOT NULL,
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('PLAYER', 'VIEWER')),
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS join_requests (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  requester_device_id TEXT NOT NULL,
  requested_seat TEXT NOT NULL CHECK (requested_seat IN ('P1', 'P2')),
  source TEXT NOT NULL CHECK (source IN ('player_invite', 'viewer_invite', 'home_list', 'direct')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  approver_device_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS game_events (
  game_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_device_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_id, event_seq)
);

CREATE TABLE IF NOT EXISTS game_snapshots (
  game_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  board_state_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_id, event_seq)
);

CREATE TABLE IF NOT EXISTS viewer_metrics (
  game_id TEXT PRIMARY KEY,
  active_viewers INTEGER NOT NULL DEFAULT 0,
  peak_viewers INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tutorial_state (
  device_id TEXT PRIMARY KEY,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_games_latest_activity ON games(latest_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_events_game_seq ON game_events(game_id, event_seq);
CREATE INDEX IF NOT EXISTS idx_participants_game_device ON participants(game_id, device_id);

