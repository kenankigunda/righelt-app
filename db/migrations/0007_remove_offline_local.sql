DROP INDEX IF EXISTS idx_live_games_online_visibility;
DROP INDEX IF EXISTS idx_live_games_home_my;
DROP INDEX IF EXISTS idx_live_games_home_smoke;

ALTER TABLE live_games
  DROP COLUMN offline_local;
