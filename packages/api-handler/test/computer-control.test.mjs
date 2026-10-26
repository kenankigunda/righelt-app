import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_COMPUTER_MODEL, COMPUTER_MODELS, getComputerModel, createComputerControl, changeComputerControl, computerCommandError, computerProfileFor, parseComputerControl } from '../../shared-types/src/computer-play.ts';
import { createInitialGame, withViewModel } from '../src/shell-live-core.ts';

const initial = () => createComputerControl('owner', { p1: 'babs', p2: null });
const change = (control, action, overrides = {}) => changeComputerControl(control, { ownerId: 'owner', authContextId: 'session', deviceId: 'device-a', generation: control.generation, action, turnIndex: 4, now: 100, ...overrides });
const proof = (control) => ({ deviceId: 'device-a', generation: control.generation, modelId: control.modelId, profile: 'babs', profileVersion: 'experimental-v1', seed: 107, attemptId: 'attempt-one' });
const error = (control, overrides = {}) => computerCommandError(control, { ownerId: 'owner', authContextId: 'session', side: 'P1', turnIndex: 4, proof: proof(control), now: 101, ...overrides });

test('lease ownership fences devices and expired or retired sessions', () => {
  const first = change(initial(), 'acquire');
  assert.equal(error(first), null);
  assert.throws(() => change(first, 'acquire', { deviceId: 'device-b' }), /device_busy/);
  const next = change(first, 'switch', { deviceId: 'device-b' });
  assert.equal(error(next, { proof: proof(first) }), 'computer_control_changed');
  assert.equal(error(first, { now: 15100 }), 'computer_control_changed');
  assert.equal(error(first, { authContextId: 'new-session' }), 'computer_control_changed');
  assert.throws(() => change(next, 'pause', { generation: first.generation }), /control_changed/);
  assert.equal(change(first, 'acquire', { deviceId: 'device-b', now: 15100 }).lease.deviceId, 'device-b');
  assert.equal(change(first, 'renew').generation, first.generation);
});
test('computer decisions fail closed without bound provenance, even for the owner', () => {
  const control = change(initial(), 'acquire');
  assert.equal(error(control, { proof: undefined }), 'computer_control_changed');
  for (const values of [{ modelId: 'unknown' }, { profile: 'horus' }, { profileVersion: 'later' }, { seed: NaN }, { attemptId: '../escape' }]) {
    assert.equal(error(control, { proof: { ...proof(control), ...values } }), 'invalid_computer_proof');
  }
  assert.equal(error(control, { ownerId: 'other' }), 'computer_owner_required');
  assert.equal(error(change(control, 'pause')), 'computer_control_changed');
});
test('temporary takeover follows the nominal turn through changing controllers', () => {
  const control = change(change(initial(), 'acquire'), 'takeover');
  const reloaded = parseComputerControl(JSON.parse(JSON.stringify(control)));
  assert.equal(computerProfileFor(reloaded, 'P1', 4), null);
  assert.equal(computerProfileFor(reloaded, 'P2', 4), null);
  assert.equal(computerProfileFor(reloaded, 'P1', 5), 'babs');
  assert.equal(error(reloaded, { proof: undefined }), null);
  assert.equal(error(reloaded), 'computer_control_changed');
  const manual = change(control, 'manual');
  assert.equal(computerProfileFor(manual, 'P1', 400), null);
});
test('malformed durable computer control never downgrades into human control', () => {
  for (const value of [null, {}, { ...initial(), generation: -1 }, { ...initial(), seats: { p1: 'unknown', p2: null } }, { ...initial(), lease: {} }]) assert.throws(() => parseComputerControl(value), /invalid_computer_control/);
});
test('resume here atomically moves control and clears overrides while preserving the opponent and model', () => {
  const previous = change(initial(), 'acquire');
  Object.assign(previous, {paused:true,singleStep:true,manual:true,takeoverTurn:4});
  const resumed = change(previous, 'resume-here', {deviceId:'device-b',authContextId:'session-b'});
  assert.equal(resumed.lease.deviceId,'device-b');
  assert.equal(resumed.lease.authContextId,'session-b');
  assert.equal(resumed.generation,previous.generation+1);
  assert.deepEqual([resumed.paused,resumed.singleStep,resumed.manual,resumed.takeoverTurn],[false,false,false,null]);
  assert.deepEqual(resumed.seats,previous.seats);assert.equal(resumed.modelId,previous.modelId);
  assert.equal(error(resumed,{proof:proof(previous)}),'computer_control_changed');
  assert.throws(()=>change(previous,'resume-here',{ownerId:'viewer'}),/computer_owner_required/);
  assert.throws(()=>change(resumed,'resume-here',{generation:previous.generation}),/computer_control_changed/);
  assert.equal(change(resumed,'resume-here',{deviceId:'device-b',authContextId:'session-b'}).generation,resumed.generation+1);
});
test('main game projection keeps computer turns read only until explicit takeover', () => {
  const game = createInitialGame({ gameId: 'g', identityId: 'owner', selfPlayMode: true });
  game.computer = initial();
  const view = withViewModel(game, 'owner');
  assert.equal(view.computerTurn, 'babs');
  assert.equal(view.canRecordMove, false);
  assert.equal(view.canEndTurn, false);
  assert.equal(view.canControlComputer, true);
  assert.equal(withViewModel(game, 'viewer').canControlComputer, false);
  game.computer.takeoverTurn = game.board.state.turnIndex;
  assert.equal(withViewModel(game, 'owner').canRecordMove, true);
});

test('published model controls retain their pinned identity and generation fences', () => {
 assert.equal(initial().modelId,CURRENT_COMPUTER_MODEL.id);
 assert.equal(CURRENT_COMPUTER_MODEL.id,'initial-1554');
 assert.equal(getComputerModel('production-20261025-99'),null);
 const old={...initial(),modelId:'initial-1554'};
 assert.equal(parseComputerControl(JSON.parse(JSON.stringify(old))).modelId,'initial-1554');
 assert.equal(getComputerModel('initial-1554').sha256,'748fcc5e7346900ead62a241002c50ca1012ef8857c73c3eb71e308b955d0490');
 const acquired=change(old,'acquire');assert.equal(error(acquired),null);
 const declined=change(acquired,'decline-upgrade');assert.equal(declined.modelId,'initial-1554');
 assert.equal(declined.declinedModelId,CURRENT_COMPUTER_MODEL.id);
 const upgraded=change(declined,'upgrade');assert.equal(upgraded.modelId,CURRENT_COMPUTER_MODEL.id);
 assert.equal(upgraded.declinedModelId,null);assert.equal(error(upgraded),null);
 assert.equal(error(upgraded,{proof:proof(acquired)}),'computer_control_changed');
});
test('every published compatible model retains its exact downloadable asset', async () => {
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 for(const [id,model]of Object.entries(COMPUTER_MODELS)){
  assert.equal(id,model.id);assert.match(model.url,/^\/computer\/models\/[a-zA-Z0-9-]+\.onnx$/);
  const bytes=await readFile(new URL('../../../apps/web'+model.url,import.meta.url));
  assert.equal(bytes.byteLength,model.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),model.sha256);
  assert.match(model.checkpoint,/^[a-f0-9]{64}$/);
 }
});
