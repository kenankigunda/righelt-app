import { LIVE_GAMES_TABLE } from "./shell-live-db";
import { primaryAuthDatabase, type AuthDatabase } from "./auth-db";

/** Read current public names at output time; never persist names into game authority. */
export async function enrichAccountNames(
  body: Record<string, unknown>,
  database: AuthDatabase,
): Promise<Record<string, unknown>> {
  const result = structuredClone(body);
  const games = [
    result.game,
    ...(Array.isArray(result.games) ? result.games : []),
  ].filter((game): game is Record<string, unknown> =>
    Boolean(
      game &&
        typeof game === "object" &&
        typeof (game as { id?: unknown }).id === "string",
    ),
  );
  const db = primaryAuthDatabase(database);
  const entries = games.map(game => {
    const people = [
      game.player1,
      game.player2,
      ...(Array.isArray(game.viewers) ? game.viewers : []),
      ...(Array.isArray(game.pendingJoinRequests)
        ? game.pendingJoinRequests
        : []),
    ].filter((person): person is Record<string, unknown> =>
      Boolean(
        person &&
          typeof person === "object" &&
          typeof (person as { identityId?: unknown }).identityId === "string",
      ),
    );
    for (const person of people) delete person.profile;
    return {game, people};
  });
  // Read authoritative ownership once per unique game, not once per card.
  const ownership = new Map<string, string>();
  const gameIds = [...new Set(games.map(game => game.id as string))];
  for (let offset = 0; offset < gameIds.length; offset += 80) {
    const chunk = gameIds.slice(offset, offset + 80);
    const rows = await db.prepare(
      `SELECT game_id,ownership_mode FROM ${LIVE_GAMES_TABLE} WHERE game_id IN (${chunk.map(() => "?").join(",")})`,
    ).bind(...chunk).all<{game_id: string; ownership_mode: string}>();
    for (const row of rows.results ?? []) ownership.set(row.game_id, row.ownership_mode);
  }
  const accountEntries = entries.filter(({game}) => ownership.get(game.id as string) === "account_v1");
  const ids = [...new Set(accountEntries.flatMap(({people}) => people.map(person => person.identityId as string)))];
  const names = new Map<string, { username: string; display_name: string }>();
  // D1 binds at most 100 parameters per statement. Deduplicate across cards.
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80);
    const profiles = await db.prepare(
      `SELECT account_id,username,display_name FROM accounts WHERE account_id IN (${chunk.map(() => "?").join(",")})`,
    ).bind(...chunk).all<{account_id: string; username: string; display_name: string}>();
    for (const profile of profiles.results ?? []) names.set(profile.account_id, profile);
  }
  for (const {people} of accountEntries) {
    for (const person of people) {
      const profile = names.get(person.identityId as string);
      if (profile) person.profile = {username: profile.username, displayName: profile.display_name};
    }
  }
  return result;
}
