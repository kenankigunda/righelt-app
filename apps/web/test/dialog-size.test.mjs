import test from "node:test";
import assert from "node:assert/strict";
import { animateDialogSize } from "../shell/dialog-size.js";

function fixture() {
  let observe, motionChange, natural = 300, visible = null;
  const animations = [];
  const motion = { matches: false, addEventListener(_, fn) { motionChange = fn; } };
  const dialog = {
    open: true, querySelector: () => ({}),
    getBoundingClientRect: () => ({ height: visible ?? natural }),
    animate(frames, options) {
      let resolve, reject;
      const a = { frames, options, finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
        pause() { this.paused = true; }, play() { this.paused = false; },
        cancel() { visible = null; reject(); }, finish() { visible = null; resolve(); } };
      animations.push(a); return a;
    },
  };
  const size = animateDialogSize(dialog, { motion, Observer: class {
    constructor(fn) { observe = fn; } disconnect() {} observe() {}
  } });
  size.refresh(); observe();
  return { size, dialog, animations, resize(height) { natural = height; observe(); },
    at(height) { visible = height; }, reduce() { motion.matches = true; motionChange(); } };
}

test("dialog resizing retargets from the visible height and settles at natural size", async () => {
  const f = fixture(); assert.equal(f.animations.length, 0);
  f.resize(500);
  assert.deepEqual(f.animations[0].frames, [{ height: "300px" }, { height: "500px" }]);
  f.at(360); f.resize(420);
  assert.deepEqual(f.animations[1].frames, [{ height: "360px" }, { height: "420px" }]);
  f.animations[1].finish(); await Promise.resolve();
  f.resize(420); assert.equal(f.animations.length, 2);
  f.resize(300); assert.equal(f.animations.length, 3);
});

test("reduced motion cancels a running transition and never animates further size changes", () => {
  const f = fixture(); f.resize(500); f.at(360); f.reduce();
  assert.equal(f.dialog.getBoundingClientRect().height, 500);
  f.resize(250); assert.equal(f.animations.length, 1);
});

test("closing resets size so a later opening does not animate from stale content", () => {
  const f = fixture(); f.resize(500); f.size.reset();
  f.size.refresh(); f.resize(300); assert.equal(f.animations.length, 1);
});

test("zoomed screen measurements are not reused as CSS-height keyframes", () => {
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = dialog => ({ height: `${dialog.getBoundingClientRect().height / 2}px` });
  try {
    const f = fixture(); f.resize(500);
    assert.deepEqual(f.animations[0].frames, [{ height: "150px" }, { height: "250px" }]);
    f.at(360); f.resize(420);
    assert.deepEqual(f.animations[1].frames, [{ height: "180px" }, { height: "210px" }]);
  } finally {
    if (original) globalThis.getComputedStyle = original;
    else delete globalThis.getComputedStyle;
  }
});

test("active control gestures pause resizing until activation has dispatched", () => {
  const f = fixture();
  f.size.pause();
  f.resize(500);
  assert.equal(f.animations.length, 0);
  f.size.resume();
  assert.deepEqual(f.animations[0].frames, [{ height: "300px" }, { height: "500px" }]);
});

 test("an in-flight height animation pauses and resumes without jumping", () => {
  const f = fixture(); f.resize(500); f.at(350);
  f.size.pause(); assert.equal(f.animations[0].paused, true);
  assert.equal(f.dialog.getBoundingClientRect().height, 350);
  f.size.resume(); assert.equal(f.animations[0].paused, false);
  assert.equal(f.animations.length, 1);
});
