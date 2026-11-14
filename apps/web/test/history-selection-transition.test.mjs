import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistorySelectionTransition } from '../shell/history-selection-transition.js';

const fixture = ({ reduced = false } = {}) => {
  let height = 100;
  const classes = new Set();
  const animations = [];
  const scrolls = [];
  const element = {
    isConnected: true,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    getBoundingClientRect: () => ({ height }),
    animate(keyframes, options) {
      const animation = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; this.oncancel?.(); } };
      animations.push(animation);
      return animation;
    },
  };
  const owner = createHistorySelectionTransition({
    reducedMotion: () => reduced,
    isElement: value => value === element,
    readScroll: () => ({ x: 4, y: 28 }),
    restoreScroll: position => scrolls.push(position),
  });
  return { element, owner, animations, classes, scrolls, setHeight: value => { height = value; } };
};

test('selection updates synchronously and presents one measured height transition', async () => {
  const view = fixture();
  let selected = 'old';
  const selection = view.owner.run('move:new', () => {
    selected = 'new';
    const captured = view.owner.capture(view.element);
    view.setHeight(240);
    assert.equal(view.owner.present(captured), true);
  });
  assert.equal(selected, 'new', 'selection is authoritative before the first promise turn');
  await selection;
  assert.deepEqual(view.animations[0].keyframes, [{ height: '100px' }, { height: '240px' }]);
  assert.deepEqual(view.animations[0].options, { duration: 180, easing: 'ease-out' });
  assert.deepEqual(view.scrolls, [{ x: 4, y: 28 }]);
  assert.equal(view.classes.has('history-selection-transitioning'), true);
  view.animations[0].onfinish();
  assert.equal(view.classes.has('history-selection-transitioning'), false);
});

test('rapid selection retargets from rendered geometry and rejects stale owners', () => {
  const view = fixture();
  const first = view.owner.begin('move:first');
  const firstCapture = view.owner.capture(view.element);
  view.setHeight(240);
  view.owner.present(firstCapture);
  view.setHeight(165);

  const second = view.owner.begin('turn:second');
  const secondCapture = view.owner.capture(view.element);
  assert.equal(view.animations[0].cancelled, true);
  view.setHeight(80);
  assert.equal(view.owner.present(firstCapture), false);
  assert.equal(view.owner.present(secondCapture), true);
  assert.deepEqual(view.animations[1].keyframes, [{ height: '165px' }, { height: '80px' }]);
  view.animations[0].onfinish?.();
  assert.equal(view.classes.has('history-selection-transitioning'), true, 'stale completion cannot clear the current owner');
  assert.equal(view.owner.finish(first), false);
  assert.equal(view.owner.finish(second), true);
});

test('reduced motion, disconnected hosts, and cancellation snap without animation', () => {
  const reduced = fixture({ reduced: true });
  const token = reduced.owner.begin('move:reduced');
  assert.equal(reduced.owner.capture(reduced.element), null);
  assert.equal(reduced.animations.length, 0);
  assert.equal(reduced.owner.finish(token), true);

  const disconnected = fixture();
  disconnected.element.isConnected = false;
  disconnected.owner.begin('move:gone');
  assert.equal(disconnected.owner.capture(disconnected.element), null);
  disconnected.owner.cancel();
  assert.equal(disconnected.animations.length, 0);
});

test('an unrelated History replacement retires completed selection motion', async () => {
  const view = fixture();
  await view.owner.run('move:selected', () => {
    const captured = view.owner.capture(view.element);
    view.setHeight(220);
    view.owner.present(captured);
  });
  assert.equal(view.classes.has('history-selection-transitioning'), true);
  assert.equal(view.owner.capture(view.element), null);
  assert.equal(view.animations[0].cancelled, true);
  assert.equal(view.classes.has('history-selection-transitioning'), false);
});
