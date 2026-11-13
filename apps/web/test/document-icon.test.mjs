import test from "node:test";
import assert from "node:assert/strict";
import { DOCUMENT_ICON, actionAwaitsPlayer, createDocumentIconOwner } from "../shell/document-icon.js";

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

test("document icon owner swaps fixed same-origin assets once per genuine state change", () => {
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
  assert.deepEqual(owner.snapshot(), { attention: false });
});

test("document icon owner fails closed when the fallback icon is unavailable", () => {
  const fixture = iconFixture({ present: false });
  const owner = createDocumentIconOwner({ documentObject: fixture.documentObject });
  assert.equal(owner.sync(true), false);
  assert.deepEqual(owner.snapshot(), { attention: false });
  assert.deepEqual(fixture.writes, []);
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
