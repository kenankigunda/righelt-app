import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderWordmark, resolveActionAffiliation, createBrandController } from "../shell/brand.js";

test("action affiliation follows ownership and pending side, never turn or logo", () => {
  const game = { player1: { identityId: "a" }, player2: { identityId: "b" } };
  for (const sideToMove of ["P1", "P2"]) {
    assert.equal(resolveActionAffiliation({ game: { ...game, sideToMove }, identityId: "b" }), "blue");
    assert.equal(resolveActionAffiliation({ game, identityId: "a" }), "red");
    assert.equal(resolveActionAffiliation({ game, identityId: "viewer" }), "red");
    assert.equal(resolveActionAffiliation({ game, identityId: "b", pendingSide: "p1" }), "red");
  }
  const self = { player1: { identityId: "a" }, player2: { identityId: "a" } };
  assert.equal(resolveActionAffiliation({ game: self, identityId: "a", selfPlaySide: "p2" }), "blue");
  assert.equal(resolveActionAffiliation({ game: self, identityId: "a" }), "red");
  assert.equal(resolveActionAffiliation(), "red");
});

test("wordmark uses explicit geometry, one accessible name and a round motif piece", () => {
  const svg = renderWordmark();
  assert.equal((svg.match(/aria-label="Righelt"/g) ?? []).length, 1);
  assert.match(svg, /class="brand-r" fill-rule="evenodd"/);
  assert.match(svg, /class="brand-t-cap" d="M459 43L473.5 29L488 43V55H459Z"/);
  assert.match(svg, /class="brand-t-stem" d="M459 72H488/);
  assert.equal((svg.match(/data-brand-cell=/g) ?? []).length, 3);
  assert.match(svg, /<circle class="brand-piece"/);
  assert.doesNotMatch(svg, /<text/);
  assert.match(renderWordmark({ player: "blue", cell: 2 }), /data-player="blue" data-cell="2"/);
});

test("home brand motion pauses when hidden, resets for reduced motion and stays still in game", () => {
  let scheduled, duration, visibility, mediaChange;
  const attributes = new Map();
  const element = { setAttribute: (key, value) => attributes.set(key, value), style: { setProperty() {} } };
  const media = { matches: false, addEventListener: (_, fn) => { mediaChange = fn; }, removeEventListener() {} };
  const doc = { hidden: false, querySelectorAll: () => [element], addEventListener: (_, fn) => { visibility = fn; }, removeEventListener() {} };
  const controller = createBrandController({ documentObject: doc, windowObject: {
    matchMedia: () => media,
    setTimeout: (fn, ms) => { scheduled = fn; duration = ms; return 1; },
    clearTimeout: () => { scheduled = null; },
  } });
  controller.setHome(true);
  assert.equal(duration, 9360);
  const firstTick = scheduled;
  controller.setHome(true);
  assert.equal(scheduled, firstTick, "ordinary home render must not postpone the loop");
  scheduled();
  assert.deepEqual(controller.getState(), { player: "blue", cell: 1 });
  assert.equal(attributes.get("data-player"), "blue");
  doc.hidden = true; visibility();
  assert.equal(scheduled, null);
  doc.hidden = false; visibility();
  assert.equal(typeof scheduled, "function");
  media.matches = true; mediaChange();
  assert.deepEqual(controller.getState(), { player: "red", cell: 0 });
  assert.equal(scheduled, null);
  media.matches = false; mediaChange();
  controller.setHome(false);
  assert.equal(scheduled, null);
  controller.destroy();
});

test("foundation text, primary, hover and disabled pairs meet normal-text contrast", () => {
  const css = readFileSync(new URL("../design-tokens.css", import.meta.url), "utf8");
  const value = (key) => css.match(new RegExp(`--${key}: (#[a-f0-9]+);`))[1];
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((x) => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  for (const foreground of ["text-primary", "text-secondary"]) {
    for (const background of ["surface-foundation", "surface-raised"]) assert.ok(contrast(value(foreground), value(background)) >= 4.5);
  }
  for (const side of ["red", "blue"]) for (const state of ["", "-hover", "-pressed"]) assert.ok(contrast("#ffffff", value(`player-${side}${state}`)) >= 4.5);
  assert.ok(contrast(value("text-primary"), "#d7d2c6") >= 4.5);
});
