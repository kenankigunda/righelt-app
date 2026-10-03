import test from "node:test";
import assert from "node:assert/strict";
import { createBrandController, resolveActionAffiliation, renderWordmark } from "../shell/brand.js";

test("a remounted header receives shared logo state while the user's actions stay blue", () => {
  let tick;
  let mounted = [];
  const doc = { hidden: false, querySelectorAll: () => mounted, addEventListener() {}, removeEventListener() {} };
  const controller = createBrandController({ documentObject: doc, windowObject: {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout: (fn) => { tick = fn; return 1; }, clearTimeout() {},
  } });
  controller.setHome(true);
  const elements = Array.from({ length: 2 }, () => ({ attributes: {}, style: { setProperty() {} }, setAttribute(key, value) { this.attributes[key] = value; } }));
  mounted = elements;
  tick();
  assert.ok(elements.every((el) => el.attributes["data-player"] === "blue"));
  assert.match(renderWordmark(controller.getState()), /data-player="blue" data-cell="1"/);
  tick();
  assert.ok(elements.every((el) => el.attributes["data-player"] === "red"));
  assert.equal(resolveActionAffiliation({ game: { player2: { identityId: "me" } }, identityId: "me" }), "blue");
  controller.setHome(false);
  assert.match(renderWordmark(controller.getState()), /data-player="red" data-cell="0"/);
  controller.destroy();
});
