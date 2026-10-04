import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRenderGestureGate } from "../shell/render-gesture.js";

const source = readFileSync(new URL("../shell/app.js", import.meta.url), "utf8");
const extract = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `render source boundaries: ${start}`);
  return source.slice(from, to);
};
// Exercise the actual shell decisions, not a second implementation of the guard.
const patchHelper = extract("const shouldPatchMountedFlyouts =", "const syncRenderedMarkupSnapshot =");
const patchDecision = extract("  const shouldPatchFlyoutsOnly =", "  const previousPanelHeights =");
const reviewAction = extract('  if (action === "analysis")', '  if (action === "rematch")');

function harness({ resultMounted = true, activeResult = null } = {}) {
  class Element {}
  const appEl = new Element();
  appEl.querySelector = selector => selector === ".game-result" ? (resultMounted ? new Element() : null) : new Element();
  const context = {
    HTMLElement: Element, appEl, currentRoute: { name: "game", gameId: "g", panel: "board" },
    activeResultGameId: activeResult,
    lastRenderedRouteKey: "g|board", lastRenderedBaseRouteKey: "g", lastRenderedTransitionPhaseKey: "idle",
    getRouteTransitionPhaseKey: () => "idle", getMountedShellPageEl: () => new Element(),
    getBaseRouteRenderKey: () => context.currentRoute.gameId,
    getRouteRenderKey: () => `${context.currentRoute.gameId}|${context.currentRoute.panel}`,
  };
  runInNewContext(`${patchHelper}
    globalThis.decide = () => {
      const hadResultView = Boolean(appEl.querySelector(".game-result"));
      const routeKey = getRouteRenderKey(), baseRouteKey = getBaseRouteRenderKey();
      ${patchDecision}
      return shouldPatchFlyoutsOnly;
    };
    globalThis.review = () => { const action = "analysis", actionGameId = "g"; ${reviewAction} };
  `, context);
  const jobs = new Map(), decisions = [];
  let id = 0;
  const renderContent = () => {
    const patch = context.decide();
    decisions.push(patch);
    // A flyout-only patch keeps main content; a full render mounts the game.
    if (!patch && context.activeResultGameId === null) resultMounted = false;
    context.lastRenderedRouteKey = context.getRouteRenderKey();
  };
  const gate = createRenderGestureGate({ render: renderContent, schedule: fn => { jobs.set(++id, fn); return id; }, cancel: key => jobs.delete(key) });
  context.render = () => { if (!gate.defer({ includeBoard: true })) renderContent(); };
  context.buildGameHash = (_id, _move, state) => state.panel;
  context.getCurrentGameHashState = panel => ({ panel });
  context.navigateTo = panel => { context.currentRoute.panel = panel; context.render(); };
  return { context, gate, decisions, mountedResult: () => resultMounted,
    flush() { for (const fn of jobs.values()) fn(); jobs.clear(); } };
}

test("terminal result review replaces main content when hashchange precedes gesture flush", () => {
  const h = harness({ activeResult: "g" });
  h.gate.begin(); h.gate.end();
  h.context.review(); // actual analysis handler; hashchange is delivered before timer flush
  assert.equal(h.context.currentRoute.panel, "history");
  assert.deepEqual(h.decisions, [], "gesture still retains the clicked control");
  assert.equal(h.mountedResult(), true);
  h.flush();
  assert.deepEqual(h.decisions, [false], "review must render the game, not patch only flyouts");
  assert.equal(h.mountedResult(), false);
  h.gate.destroy();
});

test("ordinary game panel/flyout changes retain patching; an active result never patches game content", () => {
  const game = harness({ resultMounted: false });
  game.context.currentRoute.panel = "history";
  assert.equal(game.context.decide(), true);
  const result = harness({ activeResult: "g" });
  result.context.currentRoute.panel = "history";
  assert.equal(result.context.decide(), false);
});
