DROP INDEX IF EXISTS idx_live_games_online_visibility;

ALTER TABLE live_games
  DROP COLUMN offline_local;
