DELETE FROM live_events
WHERE game_id IN (
  SELECT game_id
  FROM live_games
  WHERE ?1 = '0' OR latest_activity_at < datetime('now', '-' || ?1 || ' hours')
);

DELETE FROM live_invites
WHERE game_id IN (
  SELECT game_id
  FROM live_games
  WHERE ?1 = '0' OR latest_activity_at < datetime('now', '-' || ?1 || ' hours')
);

DELETE FROM live_games
WHERE ?1 = '0' OR latest_activity_at < datetime('now', '-' || ?1 || ' hours');
