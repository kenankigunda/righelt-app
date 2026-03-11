CREATE TABLE live_participants_v2 (
  game_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Player 1', 'Player 2', 'Viewer')),
  joined_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL,
  connected INTEGER NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, identity_id, role)
);

INSERT INTO live_participants_v2 (
  game_id,
  identity_id,
  role,
  joined_at,
  last_heartbeat_at,
  connected,
  session_count
)
SELECT
  game_id,
  identity_id,
  role,
  joined_at,
  last_heartbeat_at,
  connected,
  session_count
FROM live_participants;

DROP TABLE live_participants;

ALTER TABLE live_participants_v2 RENAME TO live_participants;

CREATE INDEX IF NOT EXISTS idx_live_participants_game
  ON live_participants(game_id, role);
