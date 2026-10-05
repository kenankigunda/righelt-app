import test from "node:test";
import assert from "node:assert/strict";
import { participantName, participantButton } from "../shell/public-profile.js";

test("public names are escaped and direction isolated with a profile link only for accounts", () => {
  const person = {
    identityId: "private-id",
    profile: { displayName: "<b>שלום</b>", username: "Alice" },
  };
  const html = participantButton(person);
  assert.match(html, /<bdi>&lt;b&gt;שלום&lt;\/b&gt;<\/bdi>/);
  assert.match(html, /<bdi>@Alice<\/bdi>/);
  assert.match(html, /data-action="public-profile"/);
  assert.doesNotMatch(html, /private-id/);
  assert.doesNotMatch(
    participantButton({ identityId: "legacy" }),
    /public-profile/,
  );
  assert.equal(
    participantName({ identityId: "<legacy>" }),
    "<bdi>Guest player</bdi>",
  );
});
