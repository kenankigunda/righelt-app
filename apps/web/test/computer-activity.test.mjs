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
 assert.equal(computerActivity(c).label,'Waiting');assert.equal(computerActivity(c).showResume,true);
 assert.equal(computerActivity(c).showRecoveryNotice,false);
});

test('a terminal protocol mismatch exposes disabled card recovery with a reload reason',()=>{
 for(const expiresAt of [115000,1]){
  const c=context();c.projection.upgradeRequired=true;c.game.computer.lease.expiresAt=expiresAt;
  const result=computerActivity(c);assert.equal(result.activeHere,false);assert.equal(result.label,'Needs help');assert.equal(result.showResume,true);
  assert.match(result.disabledReason,/Reload the game/);assert.equal(result.showRecoveryNotice,false);
 }
});

test('intentional background inactivity and an unclaimed human turn remain quiet',()=>{
 const c=context();c.game.computer.lease=null;c.visible=false;
 assert.equal(computerActivity(c).label,'Inactive in this tab');assert.equal(computerActivity(c).showRecoveryNotice,false);
 c.visible=true;c.game.board.state.sideToMove='P1';
 assert.equal(computerActivity(c).label,'Waiting for a turn');assert.equal(computerActivity(c).showResume,true);assert.equal(computerActivity(c).showRecoveryNotice,false);
 c.game.board.state.sideToMove='P2';assert.equal(computerActivity(c).label,'Needs help');assert.equal(computerActivity(c).showRecoveryNotice,true);
 c.game.board.state.sideToMove='P1';c.lastAcquisitionFailure={code:'session_changed'};assert.equal(computerActivity(c).label,'Needs help');
});

test('a retained unacknowledged lease stays quiet on the human turn without claiming local authority',()=>{
 const c=context();c.controlAcknowledged=false;c.game.board.state.sideToMove='P1';
 const human=computerActivity(c);
 assert.equal(human.label,'Waiting for a turn');assert.equal(human.activeHere,false);assert.equal(human.showResume,true);assert.equal(human.disabledReason,null);assert.equal(human.showRecoveryNotice,false);
 c.game.board.state.sideToMove='P2';const computer=computerActivity(c);
 assert.equal(computer.label,'Waiting');assert.equal(computer.activeHere,false);assert.equal(computer.showResume,true);assert.equal(computer.showRecoveryNotice,false,'a still-live unacknowledged lease does not bypass the existing delayed recovery gate');
});

function freshRenewal() {
  const c = context(); c.game.board.state.sideToMove = 'P1'; c.game.computer.generation = 3; c.renewing = true;
  c.projection = { pendingCommandCount: 1, pendingComputerControl: true, sharedMutationsBlocked: true, syncStatus: 'applying-update',
    pendingComputerControlRequest: { action: 'renew', deviceId: c.deviceId, generation: 3, submittedAt: c.now - 5000 } };
  return c;
}

test('quiet renewal preserves acknowledged human-turn activity without changing uncertainty', () => {
  const c = freshRenewal(), original = structuredClone(c);
  assert.equal(computerActivity(c).label, 'Active here');
  assert.equal(computerActivity(c).quietRenewal, true); assert.equal(computerActivity(c).showResume, false);
  assert.deepEqual(c, original, 'presentation must not relax or rewrite the pending projection');
});

test('quiet renewal ends at lease expiry and rejects unknown, stale, manual and failed work', () => {
  const changes = [
    c => c.renewing = false, c => c.visible = false, c => c.authenticated = false,
    c => c.controlAcknowledged = false, c => c.identityId = 'other-owner', c => c.game.canControlComputer = false,
    c => c.game.computer.lease.expiresAt = c.now, c => c.game.computer.lease.deviceId = 'elsewhere',
    c => c.game.board.state.sideToMove = 'P2', c => c.game.board.state.outcome.status = 'won', c => c.game.inHistoryMode = true, c => c.projection.inHistoryMode = true,
    c => c.game.computer.paused = true, c => c.game.computer.manual = true, c => c.game.computer.takeoverTurn = 35,
    c => c.resuming = true, c => c.lastAcquisitionFailure = { code: 'request_timeout' }, c => c.status.phase = 'recovery',
    c => c.projection.pendingCommandCount = 2, c => c.projection.pendingComputerControl = false,
    c => c.projection.syncStatus = 'confirming', c => c.projection.confirmationOverdue = true,
    c => c.projection.recoveryIssue = 'unavailable', c => c.projection.storageBlocked = true,
    c => c.projection.upgradeRequired = true, c => c.projection.unsavedCommand = true,
    c => c.projection.pendingComputerControlRequest.action = 'pause', c => c.projection.pendingComputerControlRequest.action = 'resume-here',
    c => c.projection.pendingComputerControlRequest.deviceId = 'old-device', c => c.projection.pendingComputerControlRequest.generation--,
    c => c.projection.pendingComputerControlRequest.submittedAt = c.now + 1,
    c => c.projection.pendingComputerControlRequest.submittedAt = c.now - 15000,
    c => c.projection.pendingComputerControlRequest = null,
  ];
  for (const change of changes) { const c = freshRenewal(); change(c); assert.equal(computerActivity(c).quietRenewal, false, change.toString()); }
});

test('routine confirmation and transient retry never mark the computer as needing intervention',()=>{
 for(const update of [c=>c.projection.pendingCommandCount=1,c=>c.projection.sharedMutationsBlocked=true,c=>c.lastAcquisitionFailure={code:'request_timeout'},c=>c.projection.recoveryIssue='network_error']){
 const c=context();update(c);const result=computerActivity(c);assert.notEqual(result.state,'attention');assert.equal(result.needsHelp,false);}
 const c=context();c.projection.storageBlocked=true;assert.equal(computerActivity(c).needsHelp,true);c.projection.storageBlocked=false;assert.equal(computerActivity(c).needsHelp,false);
});

test('winning confirmed playback finishes presentation before the computer card becomes finished',()=>{
 const c=context();c.game.board.state.outcome.status='p2_win';c.projection.confirmedPlayback={playing:true};assert.equal(computerActivity(c).label,'Making their move');
 c.projection.confirmedPlayback.error='offline';assert.equal(computerActivity(c).label,'Needs help');assert.equal(computerActivity(c).showResume,false);
 delete c.projection.confirmedPlayback;assert.equal(computerActivity(c).label,'Game finished');
});
