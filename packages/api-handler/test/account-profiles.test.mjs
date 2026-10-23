import test from "node:test";
import assert from "node:assert/strict";
import { validateAccountPatch } from "../../shared-types/src/auth.ts";
import { enrichAccountNames } from "../src/account-profiles.ts";

test("account patch validates exact enums and immutable identity", () => {
  for (const patch of [
    {},
    { username: "changed" },
    { preferences: [] },
    { preferences: { view: ["focused"] } },
    { preferences: { view: {} } },
    { preferences: { view: null } },
    { preferences: { tutorial: ["completed"] } },
    { preferences: { tutorial: "new" } },
    { displayName: "\u202eBad" },
  ])
    assert.equal(validateAccountPatch(patch, "Alice").ok, false);
  assert.deepEqual(
    validateAccountPatch(
      {
        displayName: "",
        preferences: { view: "focused", tutorial: "skipped" },
      },
      "Alice",
    ),
    {
      ok: true,
      value: {
        displayName: "Alice",
        preferences: { view: "focused", tutorial: "skipped" },
      },
    },
  );
});

test("name enrichment uses authoritative ownership and bounded public name queries", async () => {
  const counts = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              return {
                ownership_mode:
                  values[0] === "legacy" ? "legacy_guest" : "account_v1",
              };
            },
            async all() {
              counts.push(values.length);
              if (sql.includes("FROM live_games")) return { results: values.map(id => ({ game_id: id, ownership_mode: id === "legacy" ? "legacy_guest" : "account_v1" })) };
              return {
                results: values.map((id) => ({
                  account_id: id,
                  username: `user_${id}`,
                  display_name: "Current name",
                })),
              };
            },
          };
        },
      };
    },
  };
  const person = {
    identityId: "same-id",
    profile: { username: "forged", displayName: "Forged" },
  };
  const body = {
    game: {
      id: "current",
      player1: person,
      viewers: Array.from({ length: 175 }, (_, i) => ({
        identityId: String(i),
      })),
      pendingJoinRequests: [{ identityId: "requester" }],
    },
    games: [{ id: "legacy", player1: structuredClone(person) }],
  };
  const result = await enrichAccountNames(body, db);
  assert.equal(result.game.player1.profile.displayName, "Current name");
  assert.equal(
    result.game.pendingJoinRequests[0].profile.username,
    "user_requester",
  );
  assert.equal(result.games[0].player1.profile, undefined);
  assert.deepEqual(Object.keys(result.game.player1.profile).sort(), [
    "displayName",
    "username",
  ]);
  assert.ok(counts.every((count) => count <= 80));
  assert.equal(body.game.player1.profile.username, "forged");
});


test("home name enrichment batches shared participants without enriching legacy or missing games", async () => {
  const queries = [];
  const db = { prepare(sql) { return { bind(...ids) {
    const ownership = sql.includes("FROM live_games");
    const rows = () => ownership
      ? ids.filter(id => id !== "missing").map(id => ({ game_id: id, ownership_mode: id === "legacy" ? "legacy_guest" : "account_v1" }))
      : ids.filter(id => id !== "deleted").map(id => ({ account_id: id, username: id, display_name: "Fresh" }));
    return {
      async first() { queries.push({ownership, ids}); return rows()[0] ?? null; },
      async all() { queries.push({ownership, ids}); return {results: rows()}; },
    };
  } }; } };
  const person = id => ({ identityId: id, profile: {displayName: "Forged"} });
  const body = {games: Array.from({length: 81}, (_, i) => ({id: `g${i}`, player1: person("shared"), player2: person(`p${i}`), viewers: [person("deleted")]}))};
  body.games.push({id: "g0", player1: person("shared")}, {id: "legacy", player1: person("shared")}, {id: "missing", player1: person("shared")});
  const original = structuredClone(body);
  const result = await enrichAccountNames(body, db);
  for (const game of result.games.slice(0,82)) assert.equal(game.player1.profile.displayName, "Fresh");
  assert.equal(result.games[0].viewers[0].profile, undefined);
  for (const game of result.games.slice(82)) assert.equal(game.player1.profile, undefined);
  assert.deepEqual(body, original);
  assert.equal(queries.length, 4, "two bounded ownership chunks and two unique profile chunks");
  assert.ok(queries.every(q => q.ids.length <= 80));
  assert.equal(queries.filter(q => !q.ownership).flatMap(q => q.ids).filter(id => id === "shared").length, 1);
});


test("name enrichment skips empty bodies and propagates database failures", async () => {
  const failure = new Error("database_unavailable");
  const db = {prepare() { throw failure; }};
  assert.deepEqual(await enrichAccountNames({ok: true}, db), {ok: true});
  await assert.rejects(enrichAccountNames({game: {id: "game"}}, db), error => error === failure);
});
