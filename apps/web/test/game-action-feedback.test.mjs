import test from "node:test";
import assert from "node:assert/strict";

import { createGameActionFeedback } from "../shell/game-action-feedback.js";

const clock = () => {
  let time = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(fn, delay) { const token = ++id; timers.set(token, { at: time + delay, fn }); return token; },
    clearTimer(token) { timers.delete(token); },
    tick(ms) {
      const target = time + ms;
      while (true) {
        const next = [...timers.entries()].sort((left, right) => left[1].at - right[1].at)[0];
        if (!next || next[1].at > target) break;
        timers.delete(next[0]); time = next[1].at; next[1].fn();
      }
      time = target;
    },
  };
};

test("visible effects clear CTA feedback without flashing a board confirmation state", () => {
  const c = clock();
  const feedback = createGameActionFeedback({ now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  const token = feedback.begin({ key: "copy:g:p1", gameId: "g", affectsBoard: false, generation: 1 });
  assert.equal(feedback.isCtaPending("copy:g:p1"), true);
  feedback.markVisible(token);
  assert.equal(feedback.isCtaPending("copy:g:p1"), false);
  assert.equal(feedback.isBoardPending("g"), false);
});

test("board confirmation is quiet until five seconds and overdue at fifteen", () => {
  const c = clock();
  const feedback = createGameActionFeedback({ now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  const token = feedback.begin({ key: "undo:g", gameId: "g", affectsBoard: true, generation: 1 });
  feedback.markVisible(token, { awaitingConfirmation: true });
  assert.equal(feedback.isCtaPending("undo:g"), false);
  assert.equal(feedback.isBoardPending("g"), false);
  c.tick(4_999);
  assert.equal(feedback.isBoardPending("g"), false);
  c.tick(1);
  assert.equal(feedback.isBoardPending("g"), true);
  assert.equal(feedback.isOverdue("g"), false);
  c.tick(9_999);
  assert.equal(feedback.isOverdue("g"), false);
  c.tick(1);
  assert.equal(feedback.isBoardPending("g"), true);
  assert.equal(feedback.isOverdue("g"), true);
  feedback.finish(token);
  assert.equal(feedback.isBoardPending("g"), false);
  assert.equal(feedback.isOverdue("g"), false);
});

test("tokens prevent an older completion from clearing a newer operation with the same key", () => {
  const c = clock();
  const feedback = createGameActionFeedback({ now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  const first = feedback.begin({ key: "load", gameId: "g", affectsBoard: true, generation: 1 });
  const second = feedback.begin({ key: "load", gameId: "g", affectsBoard: true, generation: 1 });
  feedback.finish(first);
  assert.equal(feedback.isCtaPending("load"), true);
  assert.equal(feedback.isBoardPending("g"), true);
  feedback.finish(second);
  assert.equal(feedback.isCtaPending("load"), false);
});

test("duplicate operation ids reuse one token and one lifecycle", () => {
  const c = clock();
  const feedback = createGameActionFeedback({ now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  const first = feedback.begin({ id: "stable-operation", key: "join", gameId: "g", generation: 1 });
  const duplicate = feedback.begin({ id: "stable-operation", key: "join", gameId: "g", generation: 1 });
  assert.equal(duplicate, first);
  assert.equal(feedback.snapshot().operations.length, 1);
  feedback.finish(duplicate);
  assert.equal(feedback.isCtaPending("join"), false);
});

test("confirmation can clear cleanly during quiet and confirming phases", () => {
  for (const elapsed of [4_999, 5_000]) {
    const c = clock();
    const feedback = createGameActionFeedback({ now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
    const token = feedback.begin({ gameId: "g", affectsBoard: true, generation: 1 });
    feedback.markVisible(token, { awaitingConfirmation: true });
    c.tick(elapsed);
    feedback.finish(token);
    c.tick(20_000);
    assert.equal(feedback.isBoardPending("g"), false);
    assert.equal(feedback.isOverdue("g"), false);
  }
});

test("retirement clears only stale generation and route-owned work", () => {
  const c = clock();
  const feedback = createGameActionFeedback({ now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  feedback.begin({ key: "old", gameId: "old-game", generation: 1 });
  feedback.begin({ key: "current", gameId: "current-game", generation: 2 });
  feedback.retire({ generation: 2, gameId: "current-game" });
  assert.equal(feedback.isCtaPending("old"), false);
  assert.equal(feedback.isCtaPending("current"), true);
});
