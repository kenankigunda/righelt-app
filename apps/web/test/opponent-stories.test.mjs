import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { OPPONENT_STORIES, shouldShowOpponentIntroduction, cancelAbandonedOpponentTutorial, createStoryCarousel, createOpponentStartCoordinator, createOpponentStoryDialog } from "../shell/opponent-stories.js";

test("all nine approved production scenes have dimensions and intact fixed stories", () => {
  const manifest = JSON.parse(readFileSync(new URL("../assets/opponents/manifest.json", import.meta.url)));
  for (const story of Object.values(OPPONENT_STORIES)) {
    assert.equal(story.scenes.length, 3);
    assert.ok(story.story.length > 160);
    for (const [id] of story.scenes) {
      const asset = manifest.find(item => item.id === id);
      assert.equal(asset.width, 960); assert.equal(asset.height, 640);
      assert.ok(existsSync(new URL(`..${asset.src}`, import.meta.url)));
    }
  }
});

test("carousel preserves remaining time while hidden and manual choice pauses", () => {
  let time = 0, task, delay;
  const carousel = createStoryCarousel({ now: () => time, setTimer: (fn, ms) => { task = fn; delay = ms; return 1; }, clearTimer: () => { task = null; } });
  assert.equal(delay, 6000);
  time = 2000; carousel.visibility(true); assert.equal(task, null);
  time = 9000; carousel.visibility(false); assert.equal(delay, 4000);
  task(); assert.equal(carousel.state().index, 1);
  carousel.select(2); assert.equal(carousel.state().paused, true); assert.equal(task, null);
  carousel.toggle(); assert.equal(delay, 6000);
  carousel.destroy(); assert.equal(task, null);
});

test("reduced motion never automatically advances even when resume is requested", () => {
  let timers = 0;
  const carousel = createStoryCarousel({ reducedMotion: true, setTimer: () => { timers++; } });
  carousel.toggle(); carousel.visibility(false); carousel.select(1);
  assert.equal(carousel.state().index, 1); assert.equal(timers, 0);
});

test("accepted ready start persists introduction then tutorial before exactly one creation", async () => {
  const calls = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const account = { canPlay: true, generation: 1, tutorial: "new" };
  const coordinator = createOpponentStartCoordinator({ getAccount: () => account, getReadiness: () => ({ state: "ready" }),
    markIntroduced: async bit => { calls.push(["seen", bit]); },
    runTutorial: async () => { calls.push(["tutorial"]); await gate; },
    createGame: async intent => { calls.push(["create", intent.side]); },
  });
  const pending = coordinator.accept({ opponent: "tau", side: "p2" });
  assert.equal((await coordinator.accept({ opponent: "tau", side: "p2" })).state, "busy");
  await Promise.resolve(); assert.deepEqual(calls, [["seen", 2], ["tutorial"]]);
  release(); assert.equal((await pending).state, "started");
  assert.deepEqual(calls, [["seen", 2], ["tutorial"], ["create", "p2"]]);
});

test("unavailable, failed persistence and account changes never create a game", async () => {
  for (const scenario of ["unavailable", "save-failed", "account-changed", "cancelled", "readiness-lost"]) {
    let ready = scenario !== "unavailable", creates = 0;
    const account = { canPlay: true, generation: 1, tutorial: "new" };
    const coordinator = createOpponentStartCoordinator({ getAccount: () => account, getReadiness: () => ({ state: ready ? "ready" : "unavailable" }),
      markIntroduced: async () => { if (scenario === "save-failed") throw Error("save failed"); },
      runTutorial: async () => { if (scenario === "account-changed") account.generation++; if (scenario === "cancelled") coordinator.cancel(); if (scenario === "readiness-lost") ready = false; },
      createGame: async () => { creates++; },
    });
    assert.notEqual((await coordinator.accept({ opponent: "babs", side: "p1" })).state, "started");
    assert.equal(creates, 0, scenario);
  }
});


test("late Play or Retry responses cannot change a newly opened opponent story", async () => {
  for (const action of ["play", "retry"]) {
    let release, click;
    const nodes = new Map();
    const node = selector => { if (!nodes.has(selector)) nodes.set(selector, { textContent: "", disabled: false, hidden: false }); return nodes.get(selector); };
    const element = { open: false, dataset: {}, querySelector: node, querySelectorAll: () => [], addEventListener: (_type, callback) => { click = callback; } };
    const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const createModal = ({ onClose }) => ({ element,
      open() { element.open = true; }, close(reason) { element.open = false; onClose(reason); }, destroy() { element.open = false; onClose(); },
    });
    const pending = () => new Promise(resolve => { release = resolve; });
    const dialog = createOpponentStoryDialog({ createModal, document, getReadiness: () => ({ state: "ready", message: "Ready" }), onPlay: pending, onRetry: pending });
    dialog.open("babs");
    const task = click({ target: { closest: selector => selector === `[data-story-${action}]` ? {} : null } });
    dialog.close(); dialog.open("tau");
    release({ state: "started", message: "Stale Babs failure" }); await task;
    assert.equal(dialog.isOpen(), true);
    assert.equal(element.dataset.opponent, "tau");
    assert.equal(node("[data-story-readiness]").textContent, "Ready");
    dialog.destroy();
  }
});


test("only introduced and ready opponents bypass introduction", () => {
  assert.equal(shouldShowOpponentIntroduction("tau", 2, { state: "ready" }), false);
  assert.equal(shouldShowOpponentIntroduction("tau", 1, { state: "ready" }), true);
  for (const state of ["loading", "error", "unavailable"]) assert.equal(shouldShowOpponentIntroduction("tau", 7, { state }), true);
});

test("leaving opponent tutorial cancels its creation and permits a fresh attempt", async () => {
  let handoff, creates = 0, tutorial = "new";
  const coordinator = createOpponentStartCoordinator({
    getAccount: () => ({ canPlay: true, generation: 1, tutorial }), getReadiness: () => ({ state: "ready" }),
    markIntroduced: async () => {}, runTutorial: () => new Promise((resolve, reject) => { handoff = { resolve, reject }; }),
    createGame: async () => { creates++; },
  });
  const first = coordinator.accept({ opponent: "babs", side: "p1" }); await Promise.resolve();
  assert.equal(cancelAbandonedOpponentTutorial({ name: "home" }, { name: "tutorial" }, handoff, () => coordinator.cancel()), false);
  assert.equal(cancelAbandonedOpponentTutorial({ name: "tutorial" }, { name: "home" }, handoff, () => coordinator.cancel()), true);
  assert.notEqual((await first).state, "started"); assert.equal(creates, 0);
  tutorial = "skipped";
  assert.equal((await coordinator.accept({ opponent: "babs", side: "p2" })).state, "started"); assert.equal(creates, 1);
});
