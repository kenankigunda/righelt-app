-- Preserve original decisions and find their latest appended turn finalization.
CREATE INDEX live_decision_finalization_lookup ON live_decision_archive (
  game_id,
  json_extract(payload_json, '$.kind'),
  json_extract(payload_json, '$.targetDecisionId'),
  event_seq DESC,
  event_ordinal DESC
);
