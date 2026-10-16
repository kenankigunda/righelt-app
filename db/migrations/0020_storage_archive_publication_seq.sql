-- Archive publication changes presence metadata and advances the sync cursor
-- atomically, so an ambiguous response cannot hide an already committed update.
DROP TRIGGER account_game_update_cutover;
CREATE TRIGGER account_game_update_cutover BEFORE UPDATE ON live_games
WHEN NOT EXISTS(SELECT 1 FROM storage_lifecycle_permits p WHERE p.game_id=OLD.game_id AND p.event_seq=OLD.event_seq AND (((p.operation='restore' AND NEW.event_seq=OLD.event_seq) OR (p.operation='archive' AND NEW.event_seq=OLD.event_seq+1)) OR (p.operation='view' AND NEW.event_seq=OLD.event_seq+1 AND OLD.ownership_mode='account_v1')) AND NEW.game_id=OLD.game_id AND NEW.ownership_mode=OLD.ownership_mode AND NEW.gameplay_revision=OLD.gameplay_revision AND NEW.created_at=OLD.created_at AND NEW.updated_at=OLD.updated_at AND NEW.latest_activity_at=OLD.latest_activity_at AND NEW.player1_identity_id IS OLD.player1_identity_id AND NEW.player2_identity_id IS OLD.player2_identity_id AND NEW.has_smoke_identity=OLD.has_smoke_identity AND NEW.retention_activity_at IS OLD.retention_activity_at AND NEW.outcome_status=OLD.outcome_status AND NEW.next_actor_identity_id IS OLD.next_actor_identity_id AND NEW.move_count=OLD.move_count) AND ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND (
 OLD.ownership_mode!='account_v1' OR NEW.ownership_mode!='account_v1' OR NEW.game_id!=OLD.game_id OR NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id) OR
 ((SELECT maintenance FROM account_cutover WHERE singleton=1)=1 AND NOT COALESCE((
 OLD.has_smoke_identity=1 AND NEW.has_smoke_identity=1 AND NEW.player1_identity_id=(SELECT canary_account_id FROM account_cutover WHERE singleton=1) AND
 NEW.player2_identity_id=NEW.player1_identity_id AND
 EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id AND actor_id=NEW.player1_identity_id)),0))
)
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
