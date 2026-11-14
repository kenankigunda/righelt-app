import assert from 'node:assert/strict';
import test from 'node:test';
import { captureHistorySelectionFocus, createHistorySelectionActions } from '../shell/history-selection-actions.js';
import { createHistorySelectionTransition } from '../shell/history-selection-transition.js';

const fixture = () => {
  const events = [];
  const sounds = [];
  let version = 0;
  const transition = {
    run(scope, select) {
      version += 1;
      events.push(`begin:${scope}`);
      const value = select();
      events.push(`selected:${scope}`);
      return Promise.resolve(value).then(result => {
        events.push(`settled:${scope}`);
        return result;
      });
    },
    version: () => version,
  };
  const actions = createHistorySelectionActions({ transition, playSound: cue => sounds.push(cue) });
  return { actions, events, sounds };
};

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('app selection wiring commits synchronously without the former deselection delay or second motion owner', async () => {
  const view = fixture();
  let selection = 'old';
  let after = 0;
  const pending = view.actions.run({
    scope: 'move:new',
    select: () => { selection = 'new'; return 'selected'; },
    accepted: value => value === 'selected',
    sound: 'history',
    after: ({ accepted }) => { assert.equal(accepted, true); after += 1; },
  });

  assert.equal(selection, 'new', 'the production callback runs before the first promise turn');
  assert.deepEqual(view.events, ['begin:move:new', 'selected:move:new']);
  assert.deepEqual(view.sounds, [], 'sound waits for accepted settlement');
  assert.equal(after, 0);
  assert.deepEqual(await pending, { accepted: true, value: 'selected' });
  assert.deepEqual(view.events, ['begin:move:new', 'selected:move:new', 'settled:move:new']);
  assert.deepEqual(view.sounds, ['history']);
  assert.equal(after, 1);
});

test('one accepted selection produces one cue while rejected and failed selections stay quiet', async () => {
  const view = fixture();
  await view.actions.run({ scope: 'turn:2', select: () => 2, accepted: value => value === 2, sound: 'history' });
  await view.actions.run({ scope: 'turn:3', select: () => 2, accepted: value => value === 3, sound: 'history' });
  await assert.rejects(
    view.actions.run({ scope: 'turn:4', select: () => { throw new Error('selection failed'); }, sound: 'history' }),
    /selection failed/,
  );
  assert.deepEqual(view.sounds, ['history']);
});

test('deferred A to B to A settlements fence stale acceptance, sound and post-settlement work', async () => {
  const transition = createHistorySelectionTransition();
  const sounds = [];
  const accepted = [];
  const after = [];
  const actions = createHistorySelectionActions({ transition, playSound: cue => sounds.push(cue) });
  const first = deferred();
  const second = deferred();
  const third = deferred();
  const run = (scope, pending) => actions.run({
    scope,
    select: () => pending.promise,
    accepted: value => { accepted.push(`${scope}:${value}`); return true; },
    sound: scope,
    after: result => after.push([scope, result.accepted, result.value]),
  });

  const a1 = run('move:A', first);
  const b = run('move:B', second);
  const a2 = run('move:A', third);
  first.resolve('first');
  second.resolve('second');
  assert.deepEqual(await a1, { accepted: false, value: 'first' });
  assert.deepEqual(await b, { accepted: false, value: 'second' });
  assert.deepEqual({ accepted, sounds, after }, { accepted: [], sounds: [], after: [] });
  third.resolve('third');
  assert.deepEqual(await a2, { accepted: true, value: 'third' });
  assert.deepEqual(accepted, ['move:A:third']);
  assert.deepEqual(sounds, ['move:A']);
  assert.deepEqual(after, [['move:A', true, 'third']]);
});

test('lifecycle cancellation fences a deferred settlement from cues and post-settlement work', async () => {
  const transition = createHistorySelectionTransition();
  const pending = deferred();
  const calls = [];
  const actions = createHistorySelectionActions({ transition, playSound: cue => calls.push(['sound', cue]) });
  const selection = actions.run({
    scope: 'move:A',
    select: () => pending.promise,
    accepted: value => { calls.push(['accepted', value]); return true; },
    sound: 'history',
    after: result => calls.push(['after', result]),
  });
  transition.cancel();
  pending.resolve('late');
  assert.deepEqual(await selection, { accepted: false, value: 'late' });
  assert.deepEqual(calls, []);
});

test('invalid wiring cannot create a second selection owner', async () => {
  assert.throws(() => createHistorySelectionActions({ transition: null }), /one transition owner/);
  assert.throws(() => createHistorySelectionActions({ transition: { run() {} } }), /one transition owner/);
  const view = fixture();
  await assert.rejects(view.actions.run({ scope: 'move', select: null }), /callbacks must be functions/);
});

test('keyboard-owned selection restores focus to the settled selected entry without stealing pointer focus', () => {
  const body = {};
  const trigger = { isConnected: true, matches: selector => selector === ':focus-visible' };
  const selected = {
    isConnected: true,
    tabIndex: 0,
    focus(options) { assert.deepEqual(options, { preventScroll: true }); document.activeElement = this; },
  };
  const document = { activeElement: trigger, body };
  const restore = captureHistorySelectionFocus({ document, root: { querySelector: () => selected }, trigger, keyboard: true });
  trigger.isConnected = false;
  document.activeElement = body;
  assert.equal(restore(), true);
  assert.equal(document.activeElement, selected);
  assert.equal(selected.tabIndex, -1);

  const pointerTrigger = { isConnected: true, matches: () => false };
  document.activeElement = pointerTrigger;
  const ignore = captureHistorySelectionFocus({ document, root: { querySelector: () => selected }, trigger: pointerTrigger, keyboard: false });
  pointerTrigger.isConnected = false;
  document.activeElement = body;
  assert.equal(ignore(), false);
  assert.equal(document.activeElement, body);
});
