DROP INDEX IF EXISTS idx_live_games_latest_activity;
DROP INDEX IF EXISTS idx_live_games_home_my;
DROP INDEX IF EXISTS idx_live_games_home_smoke;
DROP INDEX IF EXISTS idx_live_games_player1_latest_activity;
DROP INDEX IF EXISTS idx_live_games_player2_latest_activity;
DROP INDEX IF EXISTS idx_live_games_smoke_latest_activity;

CREATE TABLE live_games_v2 (
  game_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  latest_activity_at TEXT NOT NULL,
  state_json TEXT NOT NULL,
  event_seq INTEGER NOT NULL DEFAULT 0,
  player1_identity_id TEXT,
  player2_identity_id TEXT,
  has_smoke_identity INTEGER NOT NULL DEFAULT 0
);

INSERT INTO live_games_v2 (
  game_id,
  created_at,
  updated_at,
  latest_activity_at,
  state_json,
  event_seq,
  player1_identity_id,
  player2_identity_id,
  has_smoke_identity
)
SELECT
  game_id,
  created_at,
  updated_at,
  latest_activity_at,
  state_json,
  event_seq,
  json_extract(state_json, '$.player1.identityId'),
  json_extract(state_json, '$.player2.identityId'),
  CASE
    WHEN json_extract(state_json, '$.player1.identityId') = 'smoke-player' THEN 1
    WHEN json_extract(state_json, '$.player2.identityId') = 'smoke-player' THEN 1
    WHEN EXISTS (
      SELECT 1
      FROM json_each(state_json, '$.viewers')
      WHERE json_extract(json_each.value, '$.identityId') = 'smoke-player'
    ) THEN 1
    WHEN EXISTS (
      SELECT 1
      FROM json_each(state_json, '$.pendingJoinRequests')
      WHERE json_extract(json_each.value, '$.identityId') = 'smoke-player'
    ) THEN 1
    ELSE 0
  END
FROM live_games;

DROP TABLE live_games;
ALTER TABLE live_games_v2 RENAME TO live_games;

CREATE INDEX IF NOT EXISTS idx_live_games_latest_activity
  ON live_games(latest_activity_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_games_player1_latest_activity
  ON live_games(player1_identity_id, latest_activity_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_games_player2_latest_activity
  ON live_games(player2_identity_id, latest_activity_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_games_smoke_latest_activity
  ON live_games(has_smoke_identity, latest_activity_at DESC, created_at DESC);
