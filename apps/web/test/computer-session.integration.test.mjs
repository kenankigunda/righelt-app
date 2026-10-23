import test from 'node:test';
import assert from 'node:assert/strict';
import { createComputerSession } from '../shell/computer-session.js';
import { renderComputerProgress } from '../shell/computer-view.js';
import { createComputerControl, changeComputerControl } from '../generated/packages/shared-types/src/computer-play.js';
import { createInitialState } from '../generated/packages/game-engine/src/state.js';

function fixture({canAnalyze = true} = {}) {
  let now = 100, visible = true, authenticated = true, generation = 1, cancelCount = 0, submitted = 0, pending;
  let game = { id: 'g', gameplayRevision: 0, computer: createComputerControl('owner', { p1: 'babs', p2: null }), board: { state: createInitialState() } };
  const saved = [];
  const transport = { getIdentityId: () => 'owner', getGameViewModel: () => ({ ...game, pendingCommandCount: 0 }), loadGame: async () => game,
    computerControl: async (_, values) => { game = { ...game, computer: changeComputerControl(game.computer, { ...values, ownerId: 'owner', authContextId: 'session', now, turnIndex: 0 }) }; },
    decisionAttempt: async (_, value) => { saved.push(value); },
    applyGameAction: async () => { submitted++; return { committed: Promise.resolve() }; },
  };
  const runtime = { compute: async () => new Promise((resolve, reject) => { pending = { resolve, reject }; }), cancel: () => { cancelCount++; pending?.reject(Error('cancelled')); pending = null; } };
  const session = createComputerSession({ deviceId: 'device', runtime, analysisRuntime: runtime, clock: () => now, timers: { setInterval() { return 1; }, clearInterval() {} }, getContext: () => ({ game, transport, accountGeneration: generation, authenticated, canAnalyze, visible }) });
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

test('undo resume waits for an acquisition already started by another tick', async () => {
  for (const viaTick of [true, false]) {
    const f = fixture();
    f.game().computer.paused = true;
    f.game().computer.generation = 3;
    let serverControl = structuredClone(f.game().computer);
    const requests = [];
    let release;
    const held = new Promise(resolve => { release = resolve; });
    f.transport.computerControl = async (id, request) => {
      requests.push({ action: request.action, generation: request.generation });
      serverControl = changeComputerControl(serverControl, { ...request, ownerId: 'owner', authContextId: 'session', now: 100, turnIndex: 0 });
      if (request.action === 'acquire') await held;
      Object.assign(f.game().computer, structuredClone(serverControl));
    };
    const acquisition = f.session.tick();
    const resumed = (async () => {
      if (viaTick) await f.session.tick();
      await f.session.action('resume');
    })();
    // Observe the pending outcome without producing an unhandled rejection.
    let result;
    const settled = resumed.then(() => { result = 'passed'; }, error => { result = error.message; });
    await Promise.resolve(); await Promise.resolve();
    const beforeRelease = [...requests];
    release(); await acquisition; await settled;
    assert.deepEqual(beforeRelease, [{ action: 'acquire', generation: 3 }]);
    assert.equal(result, 'passed');
    assert.deepEqual(requests, [{ action: 'acquire', generation: 3 }, { action: 'resume', generation: 4 }]);
    assert.equal(f.game().computer.paused, false);
    assert.equal(f.game().computer.generation, 5);
    assert.equal(f.session.snapshot().phase, 'idle');
    f.session.destroy();
  }
});

test('a control waiting for acquisition never resumes a changed account or game', async () => {
  for (const change of ['logout', 'switchGame']) {
    const f = fixture(), requests = [];
    let release;
    const held = new Promise(resolve => { release = resolve; });
    f.transport.computerControl = async (_, request) => { requests.push(request.action); await held; };
    const acquisition = f.session.tick();
    const resume = f.session.action('resume');
    await Promise.resolve(); f[change](); release();
    await acquisition; await resume;
    assert.deepEqual(requests, ['acquire']);
    f.session.destroy();
  }
});

test('a rejected acquisition does not send or retry resume', async () => {
  const f = fixture(), requests = [];
  f.transport.computerControl = async (_, request) => { requests.push(request.action); throw Error('computer_device_busy'); };
  const acquisition = f.session.tick();
  const resume = f.session.action('resume');
  await acquisition;
  await assert.rejects(resume, /computer_control_changed/);
  assert.deepEqual(requests, ['acquire']);
  assert.equal(f.session.snapshot().phase, 'recovery');
  f.session.destroy();
});

test('guest play permission does not grant private analysis',async()=>{
 const f=fixture({canAnalyze:false});
 await assert.rejects(f.session.analyze(f.game().board.state),/Sign in/);
 assert.equal(f.pending(),null);assert.deepEqual(f.saved,[]);
 f.session.destroy();
});

test('undo reacquires control after an obsolete in-flight renewal settles', async () => {
  const f = fixture();
  f.game().computer.paused = true;
  await f.session.tick();
  const originalControl = f.transport.computerControl;
  const requests = [];
  let rejectRenewal, renewalStarted;
  const started = new Promise(resolve => { renewalStarted = resolve; });
  f.transport.computerControl = async (id, request) => {
    requests.push(request.action);
    if (request.action === 'renew') {
      renewalStarted();
      return new Promise((_, reject) => { rejectRenewal = reject; });
    }
    return originalControl(id, request);
  };
  f.setTime(6100);
  await f.session.tick(); await started;
  // The committed undo advances the control generation and removes its lease.
  f.game().computer.generation++;
  f.game().computer.lease = null;
  const restored = f.session.tick();
  rejectRenewal(Error('computer_control_changed'));
  await restored;
  await f.session.action('resume');
  assert.deepEqual(requests, ['renew', 'acquire', 'resume']);
  assert.equal(f.game().computer.paused, false);
  f.session.destroy();
});

for (const action of ['pause', 'resume', 'switch']) test(`automatic renewal waits for ${action} acknowledgement`, async () => {
  const f = fixture();
  f.game().computer.seats = { p1: null, p2: 'babs' };
  f.game().computer.paused = action === 'resume';
  await f.session.tick();
  let server = structuredClone(f.game().computer), acknowledge, started;
  const held = new Promise(resolve => { acknowledge = resolve; });
  const sent = new Promise(resolve => { started = resolve; });
  const requests = [], failures = [];
  f.transport.computerControl = async (_, request) => {
    requests.push({ action: request.action, generation: request.generation });
    try {
      server = changeComputerControl(server, { ...request, ownerId: 'owner', authContextId: 'session', now: 6100, turnIndex: 0 });
      if (request.action === action) { started(); await held; }
      Object.assign(f.game().computer, structuredClone(server));
    } catch (error) { failures.push(error.message); throw error; }
  };
  const command = f.session.action(action); await sent;
  f.setTime(6100);
  const tick = f.session.tick();
  await Promise.resolve(); await Promise.resolve();
  const beforeAcknowledgement = [...requests];
  acknowledge(); await command; await tick;
  assert.deepEqual(beforeAcknowledgement, [{ action, generation: 1 }]);
  assert.deepEqual(failures, []);
  await f.session.tick(); await Promise.resolve();
  assert.equal(requests.at(-1).action, 'renew');
  assert.equal(requests.at(-1).generation, 2);
  f.session.destroy();
});

test('a rejected control releases the automatic-work guard without replaying it', async () => {
  const f = fixture(); f.game().computer.paused = true; await f.session.tick();
  const original = f.transport.computerControl, requests = [];
  f.transport.computerControl = async (id, request) => {
    requests.push(request.action);
    if (request.action === 'pause') throw Error('control-request-failed');
    return original(id, request);
  };
  await assert.rejects(f.session.action('pause'), /control-request-failed/);
  f.setTime(6100); await f.session.tick(); await Promise.resolve();
  assert.deepEqual(requests, ['pause', 'renew']);
  f.session.destroy();
});

for (const rejected of [false, true]) test(`history mutation fences automatic renewal until settlement (rejected=${rejected})`, async () => {
  const f = fixture();
  f.game().computer.seats = { p1: null, p2: 'babs' };
  await f.session.tick(); await f.session.action('pause');
  const original = f.transport.computerControl, requests = [];
  f.transport.computerControl = async (id, request) => { requests.push(request.action); return original(id, request); };
  let settle, started;
  const held = new Promise(resolve => { settle = resolve; });
  const sent = new Promise(resolve => { started = resolve; });
  const mutation = f.session.withMutation(async () => {
    started(); await held;
    if (rejected) throw Error('undo-rejected');
    f.game().computer.generation++; f.game().computer.lease = null;
  });
  const outcome = mutation.catch(error => error.message);
  await sent; f.setTime(6100); await f.session.tick();
  const beforeAcknowledgement = [...requests];
  settle(); const result = await outcome;
  assert.deepEqual(beforeAcknowledgement, []);
  assert.equal(result, rejected ? 'undo-rejected' : undefined);
  await f.session.tick(); await Promise.resolve();
  assert.deepEqual(requests, [rejected ? 'renew' : 'acquire']);
  f.session.destroy();
});
