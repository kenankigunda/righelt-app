import test from 'node:test';
import assert from 'node:assert/strict';
import { createForegroundRecoveryWait } from '../shell/foreground-recovery.js';
import { recoveryMessage, needsRecoveryAction } from '../shell/recovery-view.js';

test('an overdue background outage receives a fresh 4/15 second foreground grace without changing safety state', () => {
  let now = 100000;
  const wait = createForegroundRecoveryWait({ clock: () => now, setTimer: () => 1, clearTimer: () => {} });
  const game = { recovering: true, sharedMutationsBlocked: true, recoveryStartedAt: 1, confirmationOverdue: true };
  const context = { scope: 'account:game', active: true, blocked: true };
  const options = () => ({ foregroundWaitMs: wait.update(context) });
  assert.equal(needsRecoveryAction(game, now), true, 'transport deadline remains overdue');
  assert.equal(recoveryMessage(game, now, options()), '');
  assert.equal(needsRecoveryAction(game, now, options()), false);
  now += 3999; assert.equal(recoveryMessage(game, now, options()), '');
  now++; assert.equal(recoveryMessage(game, now, options()), 'Reconnecting');
  now += 10999; assert.equal(needsRecoveryAction(game, now, options()), false);
  now++; assert.match(recoveryMessage(game, now, options()), /Still reconnecting/);
  assert.equal(needsRecoveryAction(game, now, options()), true);
  wait.update({ ...context, active: false }); now += 600000;
  assert.equal(recoveryMessage(game, now, options()), '');
  assert.equal(game.confirmationOverdue, true);
});

test('control updates respect foreground grace while actionable local failures remain immediate', () => {
  const game = { recovering: true, sharedMutationsBlocked: true, confirmationOverdue: true, pendingComputerControl: true };
  for (const foregroundWaitMs of [0, 3999]) assert.equal(recoveryMessage(game, 999999, { foregroundWaitMs }), '');
  assert.equal(recoveryMessage(game, 999999, { foregroundWaitMs: 4000 }), 'Updating computer play');
  assert.equal(needsRecoveryAction(game, 999999, { foregroundWaitMs: 4000 }), false);
  assert.equal(needsRecoveryAction(game, 999999, { foregroundWaitMs: 15000 }), true);
  for (const failure of [{ storageBlocked: true }, { upgradeRequired: true }, { recoveryIssue: 'invalid_credentials' }, { recoveryIssue: 'invalid_response' }]) {
    assert.ok(recoveryMessage({ ...game, ...failure }, 999999, { foregroundWaitMs: 0 }));
    assert.equal(needsRecoveryAction({ ...game, ...failure }, 999999, { foregroundWaitMs: 0 }), true);
  }
});
