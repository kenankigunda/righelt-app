import test from "node:test";
import assert from "node:assert/strict";
import { DOCUMENT_ICON, actionAwaitsPlayer, createDocumentIconOwner, documentIconHref, gameDocumentIconSvg, gameDocumentStartedAt } from "../shell/document-icon.js";

const iconFixture = ({ present = true, href = DOCUMENT_ICON.base } = {}) => {
  const attributes = new Map([["href", href]]);
  const writes = [];
  const link = {
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute(name, value) { writes.push([name, value]); attributes.set(name, value); },
  };
  const documentObject = { querySelector: (selector) => present && selector === "#righelt-favicon" ? link : null };
  return { documentObject, link, writes };
};

test("document icon owner swaps Home assets once per genuine state change", () => {
  const fixture = iconFixture();
  const owner = createDocumentIconOwner({ documentObject: fixture.documentObject });
  assert.equal(owner.sync(false), true);
  assert.deepEqual(fixture.writes, []);
  assert.equal(owner.sync(false), false);
  assert.equal(owner.sync(true), true);
  assert.equal(fixture.link.getAttribute("href"), DOCUMENT_ICON.attention);
  assert.deepEqual(fixture.writes, [["href", DOCUMENT_ICON.attention]]);
  assert.equal(owner.sync(true), false);
  assert.equal(owner.sync(false), true);
  assert.equal(fixture.link.getAttribute("href"), DOCUMENT_ICON.base);
  assert.deepEqual(fixture.writes, [["href", DOCUMENT_ICON.attention], ["href", DOCUMENT_ICON.base]]);
  assert.deepEqual(owner.snapshot(), { attention: false, kind: "home" });
});

test("the selected overlap Home icon has a fresh cache key", () => {
  assert.equal(new URL(DOCUMENT_ICON.base, "https://righelt.pages.dev/").origin, "https://righelt.pages.dev");
  assert.equal(new URL(DOCUMENT_ICON.base, "https://righelt.pages.dev/").pathname, "/favicon-overlap.svg");
  assert.notEqual(DOCUMENT_ICON.base, "./favicon.svg");
  assert.notEqual(DOCUMENT_ICON.base, "./favicon-marble.svg");
});

test("document icon owner fails closed when the fallback icon is unavailable", () => {
  const fixture = iconFixture({ present: false });
  const owner = createDocumentIconOwner({ documentObject: fixture.documentObject });
  assert.equal(owner.sync(true), false);
  assert.deepEqual(owner.snapshot(), { attention: false, kind: "home" });
  assert.deepEqual(fixture.writes, []);
});

test("Home and unresolved game routes never claim a game start date", () => {
  assert.equal(gameDocumentStartedAt(undefined, null), null);
  assert.equal(gameDocumentStartedAt("game-a", null), null);
  assert.equal(gameDocumentStartedAt("game-a", { id: "game-b", createdAt: "2026-11-13T12:00:00Z" }), null);
  assert.equal(gameDocumentStartedAt("game-a", { id: "game-a" }), null);
  assert.equal(
    gameDocumentStartedAt("game-a", { id: "game-a", createdAt: "2026-11-13T12:00:00Z" }),
    "2026-11-13T12:00:00Z",
  );
});

test("game icons reuse the immutable localized date identity and preserve the selected attention gap", () => {
  const startedAt = "2026-11-13T23:30:00.000Z";
  const base = gameDocumentIconSvg(startedAt, { locale: "en-US", timeZone: "America/Los_Angeles" });
  const attention = gameDocumentIconSvg(startedAt, { attention: true, locale: "en-US", timeZone: "America/Los_Angeles" });
  assert.match(base, />Nov<\/text>/);
  assert.match(base, />13<\/text>/);
  assert.match(base, /Righelt game started November 13, 2026 at 3:30 PM/);
  assert.doesNotMatch(base, /attention-gap|#d47a16/);
  assert.match(attention, /<circle cx="51" cy="13" r="9" fill="black"\/>/);
  assert.match(attention, /<circle cx="51" cy="13" r="6" fill="#d47a16"\/>/);
  assert.notEqual(documentIconHref({ startedAt }), documentIconHref({ startedAt, attention: true }));
});

test("game route identity retires to Home during loading, unavailable, or non-game routes", () => {
  const fixture = iconFixture();
  const owner = createDocumentIconOwner({ documentObject: fixture.documentObject });
  const startedAt = "2026-11-13T23:30:00.000Z";
  assert.equal(owner.sync({ startedAt }), true);
  assert.equal(owner.snapshot().kind, "game");
  assert.match(decodeURIComponent(fixture.link.getAttribute("href")), />Nov<\/text>/);
  assert.equal(owner.sync({ startedAt, attention: true }), true);
  assert.equal(owner.snapshot().attention, true);
  assert.equal(owner.sync({ startedAt: null, attention: false }), true);
  assert.equal(fixture.link.getAttribute("href"), DOCUMENT_ICON.base);
  assert.deepEqual(owner.snapshot(), { attention: false, kind: "home" });
});

test("invalid game creation instants fail closed to the selected Home identity", () => {
  assert.equal(gameDocumentIconSvg("not-a-date"), null);
  assert.equal(documentIconHref({ startedAt: "not-a-date" }), DOCUMENT_ICON.base);
  assert.equal(documentIconHref({ startedAt: "not-a-date", attention: true }), DOCUMENT_ICON.attention);
});

test("action attention requires the current human-controlled authoritative action gate", () => {
  const available = { currentGame: true, canControl: true, ownsActor: true, computerTurn: false };
  assert.equal(actionAwaitsPlayer(available), true);
  for (const [name, change] of [
    ["home or another game", { currentGame: false }],
    ["viewer or opponent authority", { ownsActor: false }],
    ["history, terminal, account, socket, or recovery fence", { canControl: false }],
    ["computer-controlled turn", { computerTurn: true }],
  ]) {
    assert.equal(actionAwaitsPlayer({ ...available, ...change }), false, `${name} must retain its authority fence`);
  }
  assert.equal(actionAwaitsPlayer(), false);
});
