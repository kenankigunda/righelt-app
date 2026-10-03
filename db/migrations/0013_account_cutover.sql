-- Activation is deliberately separate from migration installation.
CREATE TABLE account_cutover (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  activated_at INTEGER CHECK(activated_at IS NULL OR (typeof(activated_at)='integer' AND activated_at>=0)),
  maintenance INTEGER NOT NULL DEFAULT 0 CHECK(maintenance IN (0,1)),
  canary_account_id TEXT REFERENCES accounts(account_id)
);
INSERT INTO account_cutover(singleton) VALUES(1);
CREATE TRIGGER account_cutover_no_delete BEFORE DELETE ON account_cutover
BEGIN SELECT RAISE(ABORT,'account_cutover_immutable'); END;
CREATE TRIGGER account_cutover_monotonic BEFORE UPDATE ON account_cutover
WHEN (OLD.activated_at IS NOT NULL AND NEW.activated_at IS NOT OLD.activated_at)
 OR (OLD.canary_account_id IS NOT NULL AND NEW.canary_account_id IS NOT OLD.canary_account_id)
 OR (NEW.activated_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts WHERE account_id=NEW.canary_account_id AND recovery_acknowledged=1))
BEGIN SELECT RAISE(ABORT,'account_cutover_immutable'); END;
-- These permits exist only inside the atomic game batch, never across requests.
CREATE TABLE account_game_write_permits (
  permit_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL UNIQUE,
  actor_id TEXT,
  valid INTEGER NOT NULL CHECK(valid=1)
);
CREATE TRIGGER account_game_insert_cutover BEFORE INSERT ON live_games
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND (
 NEW.ownership_mode!='account_v1' OR NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id) OR
 ((SELECT maintenance FROM account_cutover WHERE singleton=1)=1 AND NOT COALESCE((
 NEW.has_smoke_identity=1 AND NEW.player1_identity_id=(SELECT canary_account_id FROM account_cutover WHERE singleton=1) AND
 NEW.player2_identity_id=NEW.player1_identity_id AND
 EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id AND actor_id=NEW.player1_identity_id)),0))
)
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER account_game_update_cutover BEFORE UPDATE ON live_games
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND (
 OLD.ownership_mode!='account_v1' OR NEW.ownership_mode!='account_v1' OR NEW.game_id!=OLD.game_id OR NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id) OR
 ((SELECT maintenance FROM account_cutover WHERE singleton=1)=1 AND NOT COALESCE((
 OLD.has_smoke_identity=1 AND NEW.has_smoke_identity=1 AND NEW.player1_identity_id=(SELECT canary_account_id FROM account_cutover WHERE singleton=1) AND
 NEW.player2_identity_id=NEW.player1_identity_id AND
 EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id AND actor_id=NEW.player1_identity_id)),0))
)
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER account_game_delete_cutover BEFORE DELETE ON live_games
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1)
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER live_invites_insert_cutover BEFORE INSERT ON live_invites
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND
 (NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=NEW.game_id AND ownership_mode='account_v1') OR
 NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id))
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER live_invites_update_cutover BEFORE UPDATE ON live_invites
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND
 (NEW.game_id!=OLD.game_id OR NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=NEW.game_id AND ownership_mode='account_v1') OR
 NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id))
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER live_invites_delete_cutover BEFORE DELETE ON live_invites
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND
 (NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=OLD.game_id AND ownership_mode='account_v1') OR
 NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=OLD.game_id))
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER live_events_insert_cutover BEFORE INSERT ON live_events
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND
 (NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=NEW.game_id AND ownership_mode='account_v1') OR
 NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id))
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER live_events_update_cutover BEFORE UPDATE ON live_events
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND
 (NEW.game_id!=OLD.game_id OR NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=NEW.game_id AND ownership_mode='account_v1') OR
 NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id))
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER live_events_delete_cutover BEFORE DELETE ON live_events
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND
 (NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=OLD.game_id AND ownership_mode='account_v1') OR
 NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=OLD.game_id))
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER live_command_receipts_insert_cutover BEFORE INSERT ON live_command_receipts
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND
 (NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=NEW.game_id AND ownership_mode='account_v1') OR
 NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id))
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER live_command_receipts_update_cutover BEFORE UPDATE ON live_command_receipts
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND
 (NEW.game_id!=OLD.game_id OR NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=NEW.game_id AND ownership_mode='account_v1') OR
 NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id))
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER live_command_receipts_delete_cutover BEFORE DELETE ON live_command_receipts
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND
 (NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=OLD.game_id AND ownership_mode='account_v1') OR
 NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=OLD.game_id))
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER live_legacy_command_tombstones_insert_cutover BEFORE INSERT ON live_legacy_command_tombstones
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND
 (NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=NEW.game_id AND ownership_mode='account_v1') OR
 NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id))
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER live_legacy_command_tombstones_update_cutover BEFORE UPDATE ON live_legacy_command_tombstones
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND
 (NEW.game_id!=OLD.game_id OR NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=NEW.game_id AND ownership_mode='account_v1') OR
 NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id))
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
CREATE TRIGGER live_legacy_command_tombstones_delete_cutover BEFORE DELETE ON live_legacy_command_tombstones
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND
 (NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=OLD.game_id AND ownership_mode='account_v1') OR
 NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=OLD.game_id))
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
