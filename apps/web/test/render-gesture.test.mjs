import test from "node:test";
import assert from "node:assert/strict";
import { createRenderGestureGate, preserveBoardFocus } from "../shell/render-gesture.js";

test("background renders keep a pressed control until activation, cancellation or drag end", () => {
  const jobs = new Map(),
    renders = [];
  let id = 0;
  const gate = createRenderGestureGate({
    render: (options) => renders.push(options),
    schedule: (fn) => {
      jobs.set(++id, fn);
      return id;
    },
    cancel: (id) => jobs.delete(id),
  });
  assert.equal(gate.defer({ includeBoard: false }), false);
  gate.begin();
  assert.equal(gate.defer({ includeBoard: true }), true);
  assert.equal(gate.defer({ includeBoard: false, animatePanels: false }), true);
  gate.end();
  assert.equal(
    renders.length,
    0,
    "release does not render before click handlers run",
  );
  assert.equal(gate.defer({ includeBoard: false, animatePanels: false }), true);
  for (const fn of jobs.values()) fn();
  jobs.clear();
  assert.deepEqual(renders, [{ includeBoard: true, animatePanels: false }]);
  assert.equal(gate.defer({}), false);
  gate.begin();
  gate.defer({ includeBoard: false });
  gate.end();
  gate.begin();
  assert.equal(jobs.size, 0, "new gesture cancels old delayed flush");
  gate.end();
  for (const fn of jobs.values()) fn();
  jobs.clear();
  assert.equal(renders.length, 2);
  gate.destroy();
});


test("board renders preserve the keyboard coordinate without overriding new focus or navigation", () => {
  for (const mode of ["replace", "connected", "dialog", "other-game", "disabled"]) {
    const body = {}, modal = {}, calls = [];
    const cell = { matches: () => true, dataset: { row: "2", col: "3" }, isConnected: true };
    const replacement = { dataset: { row: "2", col: "3" }, disabled: mode === "disabled", focus: options => calls.push(options) };
    const document = { activeElement: cell, body, querySelectorAll: () => [replacement] };
    let gameId = "original";
    const result = preserveBoardFocus({ document, getGameId: () => gameId }, () => {
      cell.isConnected = mode === "connected";
      document.activeElement = mode === "dialog" ? modal : mode === "connected" ? cell : body;
      if (mode === "other-game") gameId = "different";
      return 42;
    });
    assert.equal(result, 42);
    assert.deepEqual(calls, mode === "replace" ? [{ preventScroll: true }] : [], mode);
  }
});
