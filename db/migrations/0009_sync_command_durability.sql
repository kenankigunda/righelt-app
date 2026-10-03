-- Additive migration: deploy before hardened writers. Legacy writers leave the base NULL.
ALTER TABLE live_games ADD COLUMN gameplay_revision INTEGER NOT NULL DEFAULT 0 CHECK (gameplay_revision >= 0);
ALTER TABLE live_games ADD COLUMN commit_base_event_seq INTEGER;
CREATE TRIGGER live_games_insert_guard BEFORE INSERT ON live_games
WHEN NEW.commit_base_event_seq IS NOT NULL AND NEW.commit_base_event_seq != 0
  AND NOT EXISTS (SELECT 1 FROM live_games WHERE game_id = NEW.game_id)
BEGIN
  SELECT RAISE(ABORT, 'missing_game_revision');
END;
CREATE TRIGGER live_games_revision_guard BEFORE UPDATE ON live_games
WHEN NEW.commit_base_event_seq IS NOT NULL AND (
  NEW.commit_base_event_seq != OLD.event_seq OR NEW.event_seq <= OLD.event_seq OR
  NEW.gameplay_revision < OLD.gameplay_revision
)
BEGIN
  SELECT RAISE(ABORT, 'stale_game_revision');
END;
CREATE TABLE live_command_receipts (
  game_id TEXT NOT NULL,
  client_command_id TEXT NOT NULL,
  actor_identity_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
  reason TEXT,
  event_seq INTEGER NOT NULL CHECK (event_seq >= 0),
  gameplay_revision INTEGER NOT NULL CHECK (gameplay_revision >= 0),
  result_json TEXT,
  PRIMARY KEY (game_id, client_command_id),
  FOREIGN KEY (game_id) REFERENCES live_games(game_id) ON DELETE CASCADE
);
CREATE TABLE live_legacy_command_tombstones (
  game_id TEXT NOT NULL,
  client_command_id TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  PRIMARY KEY (game_id, client_command_id),
  FOREIGN KEY (game_id) REFERENCES live_games(game_id) ON DELETE CASCADE
);
