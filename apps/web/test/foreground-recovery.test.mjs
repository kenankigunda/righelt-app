import test from 'node:test';
import assert from 'node:assert/strict';
import { createForegroundRecoveryWait } from '../shell/foreground-recovery.js';

test('foreground recovery schedules the two presentation boundaries without restarting on updates', () => {
  let now = 0, changed = 0, nextId = 0;
  const timers = new Map();
  const wait = createForegroundRecoveryWait({ clock: () => now, setTimer: (fn, ms) => { timers.set(++nextId, { fn, ms }); return nextId; }, clearTimer: id => timers.delete(id), onChange: () => changed++ });
  const context = { scope: 'account:game:episode', active: true, blocked: true };
  assert.equal(wait.update(context), 0);
  assert.equal([...timers.values()][0].ms, 4000);
  now = 3000; assert.equal(wait.update(context), 3000); assert.equal(timers.size, 1);
  now = 4000; const [id, timer] = [...timers][0]; timers.delete(id); timer.fn();
  assert.equal(changed, 1); assert.equal(wait.update(context), 4000);
  assert.equal([...timers.values()][0].ms, 11000);
  now = 15000; const [strongId, strong] = [...timers][0]; timers.delete(strongId); strong.fn();
  assert.equal(wait.update(context), 15000); assert.equal(timers.size, 0);
});

test('hidden time, leaving inspection, account/game changes and settled recovery start a fresh wait', () => {
  let now = 100;
  const timers = new Map(); let id = 0;
  const wait = createForegroundRecoveryWait({ clock: () => now, setTimer: fn => { timers.set(++id, fn); return id; }, clearTimer: key => timers.delete(key) });
  const context = { scope: 'account:game:episode', active: true, blocked: true };
  wait.update(context); now += 3000;
  assert.equal(wait.update({ ...context, active: false }), 0); assert.equal(timers.size, 0);
  now += 600000; assert.equal(wait.update(context), 0);
  for (const scope of ['account:other-game:episode', 'other-account:other-game:episode', 'other-account:other-game:new-episode']) {
    now += 10000; assert.equal(wait.update({ ...context, scope }), 0);
  }
  wait.update({ ...context, blocked: false }); now += 600000;
  assert.equal(wait.update(context), 0);
  wait.reset(); assert.equal(timers.size, 0);
});
