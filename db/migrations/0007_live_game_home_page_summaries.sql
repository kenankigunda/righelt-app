ALTER TABLE live_games ADD COLUMN player1_identity_id TEXT;
ALTER TABLE live_games ADD COLUMN player2_identity_id TEXT;
ALTER TABLE live_games ADD COLUMN has_smoke_player INTEGER NOT NULL DEFAULT 0;

UPDATE live_games
SET
  player1_identity_id = json_extract(state_json, '$.player1.identityId'),
  player2_identity_id = json_extract(state_json, '$.player2.identityId'),
  has_smoke_player = CASE
    WHEN json_extract(state_json, '$.player1.identityId') = 'smoke-player' THEN 1
    WHEN json_extract(state_json, '$.player2.identityId') = 'smoke-player' THEN 1
    WHEN EXISTS (
      SELECT 1
      FROM json_each(COALESCE(json_extract(state_json, '$.viewers'), '[]'))
      WHERE json_extract(json_each.value, '$.identityId') = 'smoke-player'
    ) THEN 1
    WHEN EXISTS (
      SELECT 1
      FROM json_each(COALESCE(json_extract(state_json, '$.pendingJoinRequests'), '[]'))
      WHERE json_extract(json_each.value, '$.identityId') = 'smoke-player'
    ) THEN 1
    ELSE 0
  END;

CREATE INDEX IF NOT EXISTS idx_live_games_home_my
  ON live_games(offline_local, player1_identity_id, player2_identity_id, latest_activity_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_games_home_smoke
  ON live_games(offline_local, has_smoke_player, latest_activity_at DESC, created_at DESC);
