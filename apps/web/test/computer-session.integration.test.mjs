import test from 'node:test';
import assert from 'node:assert/strict';
import { createComputerSession } from '../shell/computer-session.js';
import { renderComputerProgress } from '../shell/computer-view.js';
import { createComputerControl, changeComputerControl } from '../generated/packages/shared-types/src/computer-play.js';
import { createInitialState } from '../generated/packages/game-engine/src/state.js';

function fixture() {
  let now = 100, visible = true, authenticated = true, generation = 1, cancelCount = 0, submitted = 0, pending;
  let game = { id: 'g', gameplayRevision: 0, computer: createComputerControl('owner', { p1: 'babs', p2: null }), board: { state: createInitialState() } };
  const saved = [];
  const transport = { getIdentityId: () => 'owner', getGameViewModel: () => ({ ...game, pendingCommandCount: 0 }), loadGame: async () => game,
    computerControl: async (_, values) => { game = { ...game, computer: changeComputerControl(game.computer, { ...values, ownerId: 'owner', authContextId: 'session', now, turnIndex: 0 }) }; },
    decisionAttempt: async (_, value) => { saved.push(value); },
    applyGameAction: async () => { submitted++; return { committed: Promise.resolve() }; },
  };
  const runtime = { compute: async () => new Promise((resolve, reject) => { pending = { resolve, reject }; }), cancel: () => { cancelCount++; pending?.reject(Error('cancelled')); pending = null; } };
  const session = createComputerSession({ deviceId: 'device', runtime, analysisRuntime: runtime, clock: () => now, timers: { setInterval() { return 1; }, clearInterval() {} }, getContext: () => ({ game, transport, accountGeneration: generation, authenticated, visible }) });
  return { session, transport, logout: () => { authenticated = false; generation++; session.suspend(); }, switchGame: () => { game = { ...game, id: 'other-game' }; }, game: () => game, saved, setTime: value => { now = value; }, hide: () => { visible = false; }, pending: () => pending, submissions: () => submitted, cancellations: () => cancelCount };
}
test('detailed disclosure begins at five seconds without cancelling progressing work', async () => {
  const f = fixture(); await f.session.tick(); const computation = f.session.tick();
  f.setTime(5099); assert.equal(f.session.snapshot().detailed, false);
  f.setTime(5100); assert.equal(f.session.snapshot().detailed, true);
  assert.equal(f.submissions(), 0);
  f.session.suspend(); await computation; f.session.destroy();
});
test('leaving a game terminates owned computation, preserves the attempt, and never submits its result', async () => {
  const f = fixture(); await f.session.tick(); const computation = f.session.tick();
  const late = f.pending(); f.hide(); await f.session.tick();
  late.resolve({ result: { status: 'ready', action: { type: 'pass' } } }); await computation;
  assert.equal(f.submissions(), 0); assert.ok(f.cancellations() > 0);
  assert.equal(f.saved.at(-1).attempt.outcome, 'unfinished'); f.session.destroy();
});
test('a result is saved before it is submitted through the durable command path', async () => {
  const f = fixture(); await f.session.tick(); const computation = f.session.tick();
  f.pending().resolve({ result: { status: 'ready', action: { type: 'pass' } } }); await computation;
  assert.equal(f.saved.length, 1); assert.equal(f.saved[0].kind, 'computer'); assert.equal(f.submissions(), 1);
  f.session.destroy();
});

test('a confirmed pause clears a stale control error while preserving its unfinished attempt', async () => {
  const f = fixture(); await f.session.tick(); const computation = f.session.tick();
  f.pending().reject(Error('computer_control_changed')); await computation;
  assert.equal(f.session.snapshot().phase, 'recovery');
  f.game().computer.paused = true; await f.session.tick();
  assert.equal(f.session.snapshot().phase, 'paused');
  assert.equal(f.session.snapshot().message, null);
  const view = renderComputerProgress({ ...f.game(), canControlComputer: true }, f.session.snapshot());
  assert.match(view, /Computer play paused/);
  assert.doesNotMatch(view, /computer_control_changed/);
  assert.equal(f.saved.at(-1).attempt.reason, 'computer_control_changed');
  assert.equal(f.saved.at(-1).attempt.outcome, 'unfinished');
  f.session.destroy();
});

test('takeover reconciles a pending accepted move even when reconciliation clears the pending slot', async () => {
  const f = fixture(), order = [];
  let settle, submitted;
  const acknowledged = new Promise(resolve => { settle = resolve; });
  const sent = new Promise(resolve => { submitted = resolve; });
  f.transport.applyGameAction = async () => { submitted(); return { committed: acknowledged }; };
  await f.session.tick(); const computation = f.session.tick();
  f.pending().resolve({ result: { status: 'ready', action: { type: 'pass' } } });
  await sent; await Promise.resolve();
  f.transport.reconcileGame = async () => { order.push('reconcile'); settle(); await computation; order.push('accepted'); };
  const originalControl = f.transport.computerControl;
  f.transport.computerControl = async (id, request) => { order.push(request.action); return originalControl(id, request); };
  await f.session.action('takeover');
  assert.deepEqual(order, ['reconcile', 'accepted', 'takeover']);
  assert.equal(f.game().computer.takeoverTurn, 0);
  f.session.destroy();
});

test('analysis waiting for pause cannot start after account suspension', async () => {
  const f = fixture(); await f.session.tick();
  let finishPause;
  const original = f.transport.computerControl;
  f.transport.computerControl = async (id, value) => {
    if (value.action === 'pause') await new Promise(resolve => { finishPause = resolve; });
    return original(id, value);
  };
  const analysis = f.session.analyze(f.game().board.state, 'initial');
  f.logout(); finishPause(); await analysis;
  assert.equal(f.pending(), null); assert.equal(f.session.snapshot().analysis, null);
  f.session.destroy();
});
test('completed private analysis is scoped to the game and cleared on account suspension', async () => {
  for (const change of ['logout', 'switchGame']) {
    const f = fixture();
    const work = f.session.analyze(f.game().board.state, 'initial');
    f.pending().resolve({ result: { status: 'ready', action: { type: 'pass' } } }); await work;
    assert.equal(f.session.snapshot().analysis.phase, 'complete');
    f[change](); assert.equal(f.session.snapshot().analysis, null);
    assert.equal(f.saved[0].kind, 'analysis'); f.session.destroy();
  }
});
