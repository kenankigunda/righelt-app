DELETE FROM live_events
WHERE game_id IN (
  SELECT game_id
  FROM live_games
  WHERE __STALE_CONDITION__
);

DELETE FROM live_invites
WHERE game_id IN (
  SELECT game_id
  FROM live_games
  WHERE __STALE_CONDITION__
);

DELETE FROM live_games
WHERE __STALE_CONDITION__;
