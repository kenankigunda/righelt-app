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
