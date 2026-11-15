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
  assert.deepEqual(view.animations[0].keyframes, [{ height: '100px' }, { height: '240px' }]);
  assert.deepEqual(view.animations[0].options, { duration: 180, easing: 'ease-out' });
  assert.deepEqual(view.scrolls, [{ x: 4, y: 28 }]);
  assert.equal(view.classes.has('history-selection-transitioning'), true);
  view.animations[0].onfinish();
  await selection;
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
  const captured = reduced.owner.capture(reduced.element);
  assert.ok(captured);
  assert.equal(reduced.owner.present(captured), false);
  assert.equal(reduced.animations.length, 0);
  assert.equal(reduced.owner.finish(token), true);

  const disconnected = fixture();
  disconnected.element.isConnected = false;
  disconnected.owner.begin('move:gone');
  assert.equal(disconnected.owner.capture(disconnected.element), null);
  disconnected.owner.cancel();
  assert.equal(disconnected.animations.length, 0);
});

test('selection settlement waits for its measured motion and unrelated replacement cancels it', async () => {
  const view = fixture();
  const selection = view.owner.run('move:selected', () => {
    const captured = view.owner.capture(view.element);
    view.setHeight(220);
    view.owner.present(captured);
  });
  assert.equal(view.classes.has('history-selection-transitioning'), true);
  view.owner.begin('unrelated');
  await selection;
  assert.equal(view.animations[0].cancelled, true);
  assert.equal(view.classes.has('history-selection-transitioning'), false);
});

test('post-settlement reveal is generation-fenced through later animation frames', async () => {
  const view = fixture();
  let isCurrent = null;
  const selection = view.owner.run('move:first', () => {
    const captured = view.owner.capture(view.element);
    view.setHeight(220);
    view.owner.present(captured, guard => { isCurrent = guard; });
  });
  view.animations[0].onfinish();
  await selection;
  assert.equal(isCurrent(), true);
  view.owner.begin('move:second');
  assert.equal(isCurrent(), false, 'a reveal queued by the settled generation cannot scroll after retargeting');
});

test('reduced motion runs the fenced reveal immediately without geometry animation', () => {
  const view = fixture({reduced:true});
  const token = view.owner.begin('move:reduced');
  const captured = view.owner.capture(view.element);
  let calls = 0;
  assert.equal(view.owner.present(captured, (guard,options) => { assert.equal(guard(), true); assert.deepEqual(options,{immediate:true}); calls += 1; }), false);
  assert.equal(calls, 1);
  assert.equal(view.animations.length, 0);
  assert.equal(view.owner.finish(token), true);
});

test('one owner measures Board and History together after the complete shell update', () => {
  const classes = new Map();
  const animations = [];
  const heights = new Map([['history', 100], ['board', 300]]);
  const target = name => ({
    name,
    isConnected: true,
    classList: {
      add: value => (classes.get(name) ?? classes.set(name, new Set()).get(name)).add(value),
      remove: value => classes.get(name)?.delete(value),
    },
    getBoundingClientRect: () => ({height: heights.get(name)}),
    animate(keyframes, options) {
      const animation = {name,keyframes,options,cancel() { this.oncancel?.(); }};
      animations.push(animation);
      return animation;
    },
  });
  const history = target('history');
  const board = target('board');
  const shell = {
    isConnected: true,
    matches: selector => selector === '[data-game-shell-root]',
    querySelector: selector => selector.includes('history') ? history : board,
  };
  const owner = createHistorySelectionTransition({isElement: value => [shell,history,board].includes(value)});
  const token = owner.begin('turn:2');
  const captured = owner.capture(shell);
  heights.set('history', 240);
  heights.set('board', 280);
  assert.equal(owner.present(captured), true);
  assert.deepEqual(animations.map(animation => [animation.name,animation.keyframes]), [
    ['history', [{height:'100px'},{height:'240px'}]],
    ['board', [{height:'300px'},{height:'280px'}]],
  ]);
  animations[0].onfinish();
  assert.equal(classes.get('history').has('history-selection-transitioning'), true, 'the group remains owned until every target settles');
  animations[1].onfinish();
  assert.equal(classes.get('history').has('history-selection-transitioning'), false);
  assert.equal(owner.finish(token), true);
});
