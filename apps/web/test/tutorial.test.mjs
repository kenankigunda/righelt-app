import test from "node:test";
import assert from "node:assert/strict";
import { createTutorialController } from "../shell/tutorial.js";
import { createTestStore } from "./support.mjs";

test("tutorial progresses step-by-step and resets", () => {
  const tutorial = createTutorialController({ steps: ["A", "B", "C"] });
  assert.equal(tutorial.current().step, "A");
  tutorial.next();
  assert.equal(tutorial.current().step, "B");
  tutorial.next();
  tutorial.next();
  assert.equal(tutorial.current().step, "C");
  tutorial.reset();
  assert.equal(tutorial.current().step, "A");
});

test("tutorial completion persists in shell store", async () => {
  const { store } = createTestStore();
  assert.equal(store.getTutorialCompleted(), false);
  store.markTutorialCompleted();
  assert.equal(store.getTutorialCompleted(), true);
});
