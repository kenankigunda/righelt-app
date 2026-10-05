-- Existing and pre-cutover guest games remain permanently read-only after auth activation.
ALTER TABLE live_games ADD COLUMN ownership_mode TEXT NOT NULL DEFAULT 'legacy_guest'
  CHECK(ownership_mode IN ('legacy_guest', 'account_v1'));
CREATE TRIGGER live_game_ownership_immutable BEFORE UPDATE OF ownership_mode ON live_games
WHEN NEW.ownership_mode != OLD.ownership_mode
BEGIN SELECT RAISE(ABORT, 'game_ownership_immutable'); END;
