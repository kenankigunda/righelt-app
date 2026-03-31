DROP INDEX IF EXISTS idx_live_invites_game;
DROP INDEX IF EXISTS idx_live_events_game_seq;
DROP INDEX IF EXISTS idx_live_participants_game;
DROP INDEX IF EXISTS idx_live_join_requests_game;

CREATE TABLE live_invites_v2 (
  token TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  shared_by_role TEXT NOT NULL CHECK (shared_by_role IN ('Viewer', 'Player 1', 'Player 2'))
);

INSERT INTO live_invites_v2 (
  token,
  game_id,
  shared_by_role
)
SELECT
  token,
  game_id,
  shared_by_role
FROM live_invites;

CREATE TABLE live_events_v2 (
  game_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (game_id, event_seq)
);

INSERT INTO live_events_v2 (
  game_id,
  event_seq,
  payload_json
)
SELECT
  game_id,
  event_seq,
  payload_json
FROM live_events;

DROP TABLE live_invites;
ALTER TABLE live_invites_v2 RENAME TO live_invites;

DROP TABLE live_events;
ALTER TABLE live_events_v2 RENAME TO live_events;

DROP TABLE live_participants;
DROP TABLE live_join_requests;

CREATE INDEX IF NOT EXISTS idx_live_invites_game
  ON live_invites(game_id);

CREATE INDEX IF NOT EXISTS idx_live_events_game_seq
  ON live_events(game_id, event_seq);
