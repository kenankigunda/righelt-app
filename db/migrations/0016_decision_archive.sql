-- The bounded live projection is not the historical source of truth.
CREATE TABLE live_decision_archive (
  game_id TEXT NOT NULL REFERENCES live_games(game_id) ON DELETE CASCADE,
  decision_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  event_ordinal INTEGER NOT NULL,
  gameplay_revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (game_id, decision_id)
);
CREATE UNIQUE INDEX live_decision_archive_cursor ON live_decision_archive(game_id, event_seq, event_ordinal);
CREATE TABLE live_position_checkpoints (
  game_id TEXT NOT NULL REFERENCES live_games(game_id) ON DELETE CASCADE,
  gameplay_revision INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  PRIMARY KEY (game_id, gameplay_revision)
);
CREATE TABLE live_decision_notes (
  game_id TEXT NOT NULL REFERENCES live_games(game_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  note_json TEXT NOT NULL,
  PRIMARY KEY (game_id, account_id, decision_id)
);
CREATE TABLE live_decision_attempts (
  game_id TEXT NOT NULL REFERENCES live_games(game_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('computer', 'analysis')),
  payload_json TEXT NOT NULL,
  PRIMARY KEY (game_id, account_id, attempt_id)
);
