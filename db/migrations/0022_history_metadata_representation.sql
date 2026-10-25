-- Reader deployment precedes activation. Existing writers continue using format 1.
-- No table references game_payloads; rebuild only its representation constraint.
CREATE TABLE game_payloads_next (
  game_id TEXT PRIMARY KEY REFERENCES live_games(game_id) ON DELETE CASCADE,
  format_version INTEGER NOT NULL CHECK(format_version IN (1,2)),
  state_blob BLOB NOT NULL,
  state_sha256 TEXT NOT NULL CHECK(length(state_sha256)=64)
);
INSERT INTO game_payloads_next SELECT game_id,format_version,state_blob,state_sha256 FROM game_payloads;
DROP TABLE game_payloads;
ALTER TABLE game_payloads_next RENAME TO game_payloads;
CREATE TRIGGER game_payloads_insert_guard BEFORE INSERT ON game_payloads
WHEN NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=NEW.game_id)
BEGIN SELECT RAISE(ABORT,'missing_game_revision'); END;
CREATE TRIGGER game_payloads_insert_cutover BEFORE INSERT ON game_payloads WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id) AND NOT EXISTS(SELECT 1 FROM storage_lifecycle_permits WHERE game_id=NEW.game_id) BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;

CREATE TRIGGER game_payloads_update_cutover BEFORE UPDATE ON game_payloads WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id) AND NOT EXISTS(SELECT 1 FROM storage_lifecycle_permits WHERE game_id=NEW.game_id) BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;

CREATE TRIGGER game_payloads_delete_cutover BEFORE DELETE ON game_payloads WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=OLD.game_id) AND NOT EXISTS(SELECT 1 FROM storage_lifecycle_permits WHERE game_id=OLD.game_id) BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
