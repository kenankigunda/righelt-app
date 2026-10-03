import test from "node:test";
import assert from "node:assert/strict";
import { createRenderGestureGate } from "../shell/render-gesture.js";

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
