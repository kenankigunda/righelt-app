import test from 'node:test';
import assert from 'node:assert/strict';
import { computerActivity } from '../shell/computer-activity.js';

function context() {
  return { identityId: 'owner', deviceId: 'here', authenticated: true, visible: true, now: 100000, waitingMs: 30000,
    status: { phase: 'idle' }, projection: {}, game: { canControlComputer: true, computer: { ownerId: 'owner', seats: { p1: null, p2: 'horus' }, paused: false, manual: false, takeoverTurn: null, lease: { deviceId: 'here', expiresAt: 115000 } }, board: { state: { outcome: { status: 'ongoing' }, sideToMove: 'P2', turnIndex: 35 } } } };
}

test('a healthy local runner remains active while waiting for the human turn', () => {
  const c = context(); c.game.board.state.sideToMove = 'P1';
  assert.equal(computerActivity(c).label, 'Active here');
  assert.equal(computerActivity(c).showResume, false);
});

test('expanded recovery is immediately available for another tab, pause, manual play and expired control', () => {
  for (const change of [c => c.game.computer.lease.deviceId = 'elsewhere', c => c.game.computer.paused = true, c => c.game.computer.manual = true, c => c.game.computer.takeoverTurn = 35, c => c.game.computer.lease.expiresAt = 1]) {
    const c = context(); c.waitingMs = 0; change(c);
    const result = computerActivity(c);
    assert.equal(result.showResume, true); assert.equal(result.disabledReason, null); assert.equal(result.showRecoveryNotice, false);
  }
});

test('unsolicited recovery appears only at thirty seconds without control', () => {
  const c = context(); c.game.computer.lease = null;
  c.waitingMs = 29999; assert.equal(computerActivity(c).showRecoveryNotice, false);
  c.waitingMs = 30000; assert.equal(computerActivity(c).showRecoveryNotice, true);
});

test('healthy work, explicit overrides and uncertain delivery suppress the unsolicited notice', () => {
  for (const change of [c => c.resumeSupported = false, c => c.visible = false, c => c.authenticated = false, c => c.identityId = 'viewer', c => c.game.board.state.sideToMove = 'P1', c => c.game.board.state.outcome.status = 'won', c => c.game.computer.paused = true, c => c.game.computer.manual = true, c => c.game.computer.takeoverTurn = 35, c => c.projection.pendingCommandCount = 1, c => c.projection.sharedMutationsBlocked = true, c => c.resuming = true, ...['preparing', 'initializing-verified-runtime', 'checking', 'looking-ahead', 'saving', 'recovery'].map(phase => c => c.status.phase = phase)]) {
    const c = context(); c.game.computer.lease = null; change(c);
    assert.equal(computerActivity(c).showRecoveryNotice, false);
  }
});

test('resume permissions and in-flight state provide a disabled explanation', () => {
  for (const change of [c => c.identityId = 'viewer', c => c.game.canControlComputer = false, c => c.game.board.state.outcome.status = 'won', c => c.resuming = true, c => c.resumeSupported = false]) {
    const c = context(); c.game.computer.lease = null; change(c);
    assert.equal(computerActivity(c).showResume, true);
    assert.ok(computerActivity(c).disabledReason);
  }
});

test('expired leases and failed or uncertain sessions never claim Active here', () => {
  for (const change of [c => c.game.computer.lease.expiresAt = c.now, c => c.status.phase = 'recovery', c => c.lastAcquisitionFailure = { code: 'request_timeout' }, c => c.projection.pendingCommandCount = 1]) {
    const c = context(); change(c); assert.equal(computerActivity(c).activeHere, false);
  }
});

test('a retained local device lease needs acknowledgement in the current session scope',()=>{
 const c=context();c.controlAcknowledged=false;
 assert.equal(computerActivity(c).label,'Needs attention');assert.equal(computerActivity(c).showResume,true);
 assert.equal(computerActivity(c).showRecoveryNotice,false);
});

test('a terminal protocol mismatch exposes disabled card recovery with a reload reason',()=>{
 for(const expiresAt of [115000,1]){
  const c=context();c.projection.upgradeRequired=true;c.game.computer.lease.expiresAt=expiresAt;
  const result=computerActivity(c);assert.equal(result.activeHere,false);assert.equal(result.label,'Needs attention');assert.equal(result.showResume,true);
  assert.match(result.disabledReason,/Reload the game/);assert.equal(result.showRecoveryNotice,false);
 }
});
