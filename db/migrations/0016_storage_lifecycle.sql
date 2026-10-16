-- Additive storage readers deploy before compact writers or archive activation.
CREATE TABLE game_payloads (
  game_id TEXT PRIMARY KEY REFERENCES live_games(game_id) ON DELETE CASCADE,
  format_version INTEGER NOT NULL CHECK(format_version=1),
  state_blob BLOB NOT NULL,
  state_sha256 TEXT NOT NULL CHECK(length(state_sha256)=64)
);
CREATE TABLE game_archives (
  game_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('archiving','archived','restoring')),
  generation TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  gameplay_revision INTEGER NOT NULL,
  manifest_key TEXT NOT NULL,
  manifest_sha256 TEXT,
  cursor TEXT NOT NULL DEFAULT '',
  next_chunk INTEGER NOT NULL DEFAULT 0,
  archive_bytes INTEGER NOT NULL DEFAULT 0,
  activity_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error TEXT
);
CREATE TABLE game_restore_receipts (
  game_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('receipt','tombstone')),
  payload_json TEXT NOT NULL,
  PRIMARY KEY(game_id,command_id,kind)
);
CREATE TABLE storage_lifecycle_permits (
  game_id TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK(operation IN ('archive','restore','view')),
  event_seq INTEGER NOT NULL,
  valid INTEGER NOT NULL CHECK(valid=1)
);
CREATE TABLE storage_budget (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  period TEXT NOT NULL,
  class_a INTEGER NOT NULL DEFAULT 0,
  class_b INTEGER NOT NULL DEFAULT 0,
  archive_bytes INTEGER NOT NULL DEFAULT 0,
  d1_bytes INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT,
  healthy INTEGER NOT NULL DEFAULT 0 CHECK(healthy IN (0,1))
);
INSERT INTO storage_budget(singleton,period) VALUES(1,strftime('%Y-%m','now'));
ALTER TABLE live_games ADD COLUMN retention_activity_at TEXT;
ALTER TABLE live_games ADD COLUMN outcome_status TEXT NOT NULL DEFAULT 'ongoing';
ALTER TABLE live_games ADD COLUMN next_actor_identity_id TEXT;
ALTER TABLE live_games ADD COLUMN move_count INTEGER NOT NULL DEFAULT 0;
-- During backfill, the original authority trigger still protects every existing
-- column. Only the newly added derived columns may change without a game permit.
DROP TRIGGER live_games_revision_guard;
CREATE TRIGGER live_games_revision_guard BEFORE UPDATE OF event_seq,gameplay_revision,commit_base_event_seq ON live_games
WHEN NEW.commit_base_event_seq IS NOT NULL AND (
  NEW.commit_base_event_seq != OLD.event_seq OR NEW.event_seq <= OLD.event_seq OR
  NEW.gameplay_revision < OLD.gameplay_revision
)
BEGIN
  SELECT RAISE(ABORT, 'stale_game_revision');
END;
DROP TRIGGER account_game_update_cutover;
CREATE TRIGGER account_game_update_cutover BEFORE UPDATE OF game_id,created_at,updated_at,latest_activity_at,state_json,event_seq,player1_identity_id,player2_identity_id,has_smoke_identity,gameplay_revision,commit_base_event_seq,ownership_mode ON live_games
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND (
 OLD.ownership_mode!='account_v1' OR NEW.ownership_mode!='account_v1' OR NEW.game_id!=OLD.game_id OR NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id) OR
 ((SELECT maintenance FROM account_cutover WHERE singleton=1)=1 AND NOT COALESCE((
 OLD.has_smoke_identity=1 AND NEW.has_smoke_identity=1 AND NEW.player1_identity_id=(SELECT canary_account_id FROM account_cutover WHERE singleton=1) AND
 NEW.player2_identity_id=NEW.player1_identity_id AND
 EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id AND actor_id=NEW.player1_identity_id)),0))
)
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
UPDATE live_games SET retention_activity_at=MAX(created_at,updated_at,latest_activity_at),
  outcome_status=COALESCE(json_extract(CASE WHEN json_valid(state_json) THEN state_json ELSE '{}' END,'$.board.state.outcome.status'),'ongoing'),
  move_count=COALESCE(json_array_length(CASE WHEN json_valid(state_json) THEN state_json ELSE '{}' END,'$.moves'),0),
  next_actor_identity_id=CASE WHEN
    (json_extract(CASE WHEN json_valid(state_json) THEN state_json ELSE '{}' END,'$.turns[#-1].playerSeat')='Player 2') !=
    (COALESCE(json_extract(CASE WHEN json_valid(state_json) THEN state_json ELSE '{}' END,'$.board.state.continuation.type'),'')='push' AND COALESCE(json_extract(CASE WHEN json_valid(state_json) THEN state_json ELSE '{}' END,'$.board.state.continuation.phase'),'')='retreat')
    THEN player2_identity_id ELSE player1_identity_id END;
DROP TRIGGER account_game_update_cutover;
CREATE TRIGGER account_game_update_cutover BEFORE UPDATE ON live_games
WHEN ((SELECT activated_at FROM account_cutover WHERE singleton=1) IS NOT NULL OR (SELECT maintenance FROM account_cutover WHERE singleton=1)=1) AND (
 OLD.ownership_mode!='account_v1' OR NEW.ownership_mode!='account_v1' OR NEW.game_id!=OLD.game_id OR NOT EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id) OR
 ((SELECT maintenance FROM account_cutover WHERE singleton=1)=1 AND NOT COALESCE((
 OLD.has_smoke_identity=1 AND NEW.has_smoke_identity=1 AND NEW.player1_identity_id=(SELECT canary_account_id FROM account_cutover WHERE singleton=1) AND
 NEW.player2_identity_id=NEW.player1_identity_id AND
 EXISTS(SELECT 1 FROM account_game_write_permits WHERE game_id=NEW.game_id AND actor_id=NEW.player1_identity_id)),0))
)
BEGIN SELECT RAISE(ABORT,'account_cutover_write_denied'); END;
DROP TRIGGER live_games_revision_guard;
CREATE TRIGGER live_games_revision_guard BEFORE UPDATE ON live_games
WHEN NEW.commit_base_event_seq IS NOT NULL AND (
  NEW.commit_base_event_seq != OLD.event_seq OR NEW.event_seq <= OLD.event_seq OR
  NEW.gameplay_revision < OLD.gameplay_revision
)
BEGIN
  SELECT RAISE(ABORT, 'stale_game_revision');
END;
CREATE INDEX live_games_retention ON live_games(retention_activity_at,game_id);
CREATE INDEX game_archives_status ON game_archives(status,updated_at,game_id);
CREATE TABLE storage_growth_guards (
  guard_id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK(valid=1)
);
CREATE TRIGGER storage_growth_denied BEFORE INSERT ON storage_growth_guards
WHEN NEW.valid!=1
BEGIN SELECT RAISE(ABORT,'storage_capacity'); END;
-- Existing cutover protections stay intact. Only a transaction-scoped lifecycle
-- permit can move stored representations, never authorize gameplay.
CREATE TRIGGER game_payloads_insert_guard BEFORE INSERT ON game_payloads
WHEN NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=NEW.game_id)
BEGIN SELECT RAISE(ABORT,'missing_game_revision'); END;

CREATE TABLE storage_objects (
  object_key TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL CHECK(bytes>=0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE storage_archive_chunks (
  game_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('state','receipt','tombstone')),
  first_id TEXT,
  last_id TEXT,
  row_count INTEGER NOT NULL,
  PRIMARY KEY(game_id,chunk_index)
);
CREATE TABLE game_archive_views (
  game_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  history_index INTEGER,
  PRIMARY KEY(game_id,identity_id)
);
CREATE TRIGGER live_game_lifecycle_lock BEFORE UPDATE ON live_games
WHEN EXISTS(SELECT 1 FROM game_archives WHERE game_id=OLD.game_id)
 AND NOT EXISTS(SELECT 1 FROM storage_lifecycle_permits WHERE game_id=OLD.game_id AND event_seq=OLD.event_seq)
BEGIN SELECT RAISE(ABORT,'storage_transition_pending'); END;
