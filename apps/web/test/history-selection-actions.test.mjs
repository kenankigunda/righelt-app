import assert from 'node:assert/strict';
import test from 'node:test';
import { captureHistorySelectionFocus, createHistorySelectionActions } from '../shell/history-selection-actions.js';
import { createHistorySelectionTransition } from '../shell/history-selection-transition.js';
import { createRenderGestureGate } from '../shell/render-gesture.js';

const fixture = () => {
  const events = [];
  const sounds = [];
  let version = 0;
  const transition = {
    run(scope, select, beforeSettled) {
      version += 1;
      events.push(`begin:${scope}`);
      const value = select();
      events.push(`selected:${scope}`);
      return Promise.resolve(value).then(async result => {
        await beforeSettled?.(result);
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

test('the exact clicked control owns pending presentation and clears it after settlement', async () => {
  const view = fixture();
  const attributes = new Map();
  const classes = new Set();
  const trigger = {
    isConnected: true,
    classList: {add: value => classes.add(value), remove: value => classes.delete(value)},
    setAttribute: (name,value) => attributes.set(name,value),
    getAttribute: name => attributes.get(name) ?? null,
    removeAttribute: name => attributes.delete(name),
  };
  const pending = deferred();
  const selection = view.actions.run({scope:'game:live',trigger,select:()=>pending.promise});
  assert.equal(classes.has('history-selection-pending'), true);
  assert.equal(attributes.get('aria-busy'), 'true');
  pending.resolve('live');
  await selection;
  assert.equal(classes.has('history-selection-pending'), false);
  assert.equal(attributes.has('aria-busy'), false);
});

test('one explicit loading episode starts before selection and survives until transition settlement', async () => {
  const settled = deferred();
  const events = [];
  let version = 0;
  const transition = {
    version: () => version,
    async run(scope, select, beforeSettled) {
      version += 1;
      events.push(`transition:${scope}`);
      const value = select();
      events.push(`selected:${scope}`);
      await beforeSettled?.(await value);
      await settled.promise;
      return value;
    },
  };
  const actions = createHistorySelectionActions({
    transition,
    onPendingChange: episode => events.push(episode ? `pending:${episode.key}` : 'pending:clear'),
  });
  const selection = actions.run({scope:'game:live',select:()=>{
    assert.equal(actions.snapshot().scope, 'game:live');
    events.push('select');
    return 'live';
  }});
  assert.deepEqual(events, [
    'pending:history-selection:1:game:live',
    'transition:game:live',
    'select',
    'selected:game:live',
  ]);
  assert.equal(actions.snapshot().key, 'history-selection:1:game:live');
  settled.resolve();
  assert.deepEqual(await selection, {accepted:true,value:'live'});
  assert.equal(actions.snapshot(), null);
  assert.equal(actions.presentation().scope, 'game:live','accepted presentation survives loading settlement for its matching render');
  assert.equal(actions.consumePresentation(actions.presentation().key),true);
  assert.equal(actions.presentation(),null);
  assert.equal(events.at(-1), 'pending:clear');
});

test('rejected acceptance and explicit lifecycle retirement leave no claimable presentation',async()=>{
  const view=fixture();
  await view.actions.run({scope:'game:turn:2',select:()=>2,accepted:()=>false});
  assert.equal(view.actions.presentation(),null);
  await assert.rejects(view.actions.run({scope:'game:turn:3',select:()=>3,accepted:()=>{throw new Error('bad acceptance');}}),/bad acceptance/);
  assert.equal(view.actions.snapshot(),null);
  assert.equal(view.actions.presentation(),null);
  await view.actions.run({scope:'game:turn:4',select:()=>4});
  assert.equal(view.actions.presentation().scope,'game:turn:4');
  view.actions.retire();
  assert.equal(view.actions.presentation(),null);
});

test('gesture-deferred cached selection keeps one transition owner through the committed render',async()=>{
  const jobs=[];
  let height=100,animation=null,gate;
  const panel={
    isConnected:true,matches:()=>false,closest:()=>null,
    getBoundingClientRect:()=>({height}),classList:{add(){},remove(){}},
    animate(){animation={cancel(){},onfinish:null,oncancel:null};return animation;},
  };
  const transition=createHistorySelectionTransition({
    isElement:value=>value===panel,
    readScroll:()=>({x:0,y:0}),restoreScroll(){},
  });
  const commit=()=>{const captured=transition.capture(panel);height=200;transition.present(captured);};
  const render=()=>{if(gate.defer({includeBoard:true}))return false;commit();return true;};
  gate=createRenderGestureGate({render:commit,schedule:callback=>{jobs.push(callback);return callback;},cancel:callback=>{const index=jobs.indexOf(callback);if(index>=0)jobs.splice(index,1);}});
  const actions=createHistorySelectionActions({
    transition,
    onPresentationReady:async()=>{render();await gate.waitForFlush();},
  });
  gate.begin();gate.end();
  const selection=actions.run({scope:'game:turn:2',select:()=>2,accepted:value=>value===2});
  await Promise.resolve();await Promise.resolve();
  assert.equal(actions.snapshot().scope,'game:turn:2','pending survives until the actual presentation settles');
  assert.equal(height,100);assert.equal(jobs.length,1);
  jobs.shift()();
  assert.equal(height,200);assert.ok(animation,'the gesture-flushed render retains its measured transition owner');
  animation.onfinish();
  assert.deepEqual(await selection,{accepted:true,value:2});
  assert.equal(actions.snapshot(),null);
  gate.destroy();
});
