import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationStack, recoveryActivity } from '../shell/notification-state.js';
import { renderGameAlertCard } from '../shell/game-alert.js';
const notice = (key, priority) => ({key, priority});
test('notification selection survives stack insertions, removals, and changing copy', () => {
  const stack = createNotificationStack();
  const items = [notice('a'),notice('b'),notice('c')];
  stack.order('game', items); stack.advance('game', items);
  assert.equal(stack.order('game', [notice('new'),notice('b'),notice('c')])[0].key,'b');
  assert.equal(stack.order('game', [notice('c'),{key:'b',html:'Updated elapsed time'}])[0].key,'b');
  assert.equal(stack.order('other', items)[0].key,'a');
});
test('a new urgent incident takes precedence once without defeating deliberate cycling', () => {
  const stack = createNotificationStack();
  stack.order('game', [notice('progress')]);
  const items = [notice('progress'),notice('failed','urgent')];
  assert.equal(stack.order('game',items)[0].key,'failed');
  stack.advance('game',items);
  assert.equal(stack.order('game',items)[0].key,'progress');
  stack.order('game',[]);
  assert.equal(stack.advance('game',[]),false);
  assert.deepEqual(stack.order('game',[notice('fresh')]),[notice('fresh')]);
});
test('recovery only pulses for actual processing, never paused or failed states', () => {
  for (const game of [{recovering:true},{syncStatus:'confirming'},{pendingCommandCount:1}]) assert.equal(recoveryActivity(game),'processing');
  for (const game of [{},{recovering:true,storageBlocked:true},{recovering:true,recoveryIssue:'invalid_response'},{recovering:true,upgradeRequired:true}]) assert.equal(recoveryActivity(game),'static');
});
test('notification rendering exposes distinct activity but errors always remain static', () => {
  assert.match(renderGameAlertCard({activity:'processing'}),/data-notification-activity="processing"/);
  assert.match(renderGameAlertCard({activity:'waiting'}),/data-notification-activity="waiting"/);
  assert.match(renderGameAlertCard({activity:'processing',tone:'danger'}),/data-notification-activity="static"/);
  assert.match(renderGameAlertCard({activity:'unexpected'}),/data-notification-activity="static"/);
});

test('a known incident becoming blocking takes precedence once', () => {
  const stack = createNotificationStack();
  stack.order('game',[notice('progress'),notice('recovery','normal')]);
  assert.equal(stack.order('game',[notice('progress'),notice('recovery','urgent')])[0].key,'recovery');
  stack.advance('game',[notice('progress'),notice('recovery','urgent')]);
  assert.equal(stack.order('game',[notice('progress'),notice('recovery','urgent')])[0].key,'progress');
});
