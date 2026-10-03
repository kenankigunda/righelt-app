-- Only complete persisted outcome evidence can establish terminal receipts.
-- Legacy move/event IDs alone become tombstones; they never establish success.
INSERT OR IGNORE INTO live_command_receipts
(game_id, client_command_id, actor_identity_id, fingerprint, outcome, reason, event_seq, gameplay_revision, result_json)
SELECT e.game_id,
 json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.clientCommandId'),
 json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.identityId'),
 json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.fingerprint'),
 json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.outcome'),
 json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.reason'),
 json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.eventSeq'),
 json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.gameplayRevision'), NULL
FROM live_events e JOIN live_games g ON g.game_id = e.game_id
WHERE json_valid(e.payload_json)
 AND json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.gameId') = e.game_id
 AND json_type(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.clientCommandId') = 'text'
 AND length(json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.clientCommandId')) BETWEEN 4 AND 128
 AND json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.clientCommandId') LIKE 'v2:%'
 AND json_type(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.identityId') = 'text'
 AND length(json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.identityId')) > 0
 AND length(json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.fingerprint')) = 64
 AND json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.fingerprint') NOT GLOB '*[^a-f0-9]*'
 AND json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.outcome') IN ('accepted', 'rejected')
 AND json_type(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.eventSeq') = 'integer'
 AND json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.eventSeq') = e.event_seq
 AND e.event_seq > 0 AND e.event_seq <= g.event_seq
 AND json_type(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.gameplayRevision') = 'integer'
 AND json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.gameplayRevision') BETWEEN 0 AND g.gameplay_revision
 AND json_type(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.reason') IN ('null', 'text')
 AND (json_type(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.reason') = 'null'
   OR length(json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.reason')) > 0)
 AND (json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.outcome') != 'accepted'
   OR json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.gameplayRevision') > 0)
 AND (json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.outcome') = 'accepted'
   OR length(json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.reason')) > 0);

INSERT OR IGNORE INTO live_legacy_command_tombstones (game_id, client_command_id, evidence_json)
SELECT g.game_id, json_extract(CASE WHEN m.type = 'object' THEN m.value ELSE '{}' END, '$.clientCommandId'), json_object('source', 'retained_move')
FROM live_games g, json_each(CASE WHEN json_valid(g.state_json) THEN g.state_json ELSE '{}' END, '$.moves') m
WHERE json_type(CASE WHEN m.type = 'object' THEN m.value ELSE '{}' END, '$.clientCommandId') = 'text' AND length(json_extract(CASE WHEN m.type = 'object' THEN m.value ELSE '{}' END, '$.clientCommandId')) > 0
 AND NOT EXISTS (SELECT 1 FROM live_command_receipts r WHERE r.game_id = g.game_id AND r.client_command_id = json_extract(CASE WHEN m.type = 'object' THEN m.value ELSE '{}' END, '$.clientCommandId'));

INSERT OR IGNORE INTO live_legacy_command_tombstones (game_id, client_command_id, evidence_json)
SELECT e.game_id, json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.clientCommandId'), json_object('source', 'event', 'eventSeq', e.event_seq)
FROM live_events e JOIN live_games g ON g.game_id = e.game_id
WHERE json_type(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.clientCommandId') = 'text' AND length(json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.clientCommandId')) > 0
 AND NOT EXISTS (SELECT 1 FROM live_command_receipts r WHERE r.game_id = e.game_id AND r.client_command_id = json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.clientCommandId'));

INSERT OR IGNORE INTO live_legacy_command_tombstones (game_id, client_command_id, evidence_json)
SELECT e.game_id, json_extract(CASE WHEN m.type = 'object' THEN m.value ELSE '{}' END, '$.clientCommandId'), json_object('source', 'event_move', 'eventSeq', e.event_seq)
FROM live_events e JOIN live_games g ON g.game_id = e.game_id, json_each(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.game.moves') m
WHERE json_type(CASE WHEN m.type = 'object' THEN m.value ELSE '{}' END, '$.clientCommandId') = 'text' AND length(json_extract(CASE WHEN m.type = 'object' THEN m.value ELSE '{}' END, '$.clientCommandId')) > 0
 AND NOT EXISTS (SELECT 1 FROM live_command_receipts r WHERE r.game_id = e.game_id AND r.client_command_id = json_extract(CASE WHEN m.type = 'object' THEN m.value ELSE '{}' END, '$.clientCommandId'));

-- Incomplete outcome metadata still proves that an ID was observed, never its outcome.
INSERT OR IGNORE INTO live_legacy_command_tombstones (game_id, client_command_id, evidence_json)
SELECT e.game_id, json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.clientCommandId'), json_object('source', 'incomplete_outcome', 'eventSeq', e.event_seq)
FROM live_events e JOIN live_games g ON g.game_id = e.game_id
WHERE json_type(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.clientCommandId') = 'text'
 AND length(json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.clientCommandId')) > 0
 AND NOT EXISTS (SELECT 1 FROM live_command_receipts r WHERE r.game_id = e.game_id AND r.client_command_id = json_extract(CASE WHEN json_valid(e.payload_json) THEN e.payload_json ELSE '{}' END, '$.commandOutcome.clientCommandId'));
