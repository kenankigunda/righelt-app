import test from 'node:test';
import assert from 'node:assert/strict';
import { createComputerSession } from '../shell/computer-session.js';
import { renderComputerProgress } from '../shell/computer-view.js';
import { COMPUTER_CAPABILITIES, createComputerControl, changeComputerControl } from '../generated/packages/shared-types/src/computer-play.js';
import { createInitialState } from '../generated/packages/game-engine/src/state.js';

function fixture({canAnalyze = true} = {}) {
  let now = 100, visible = true, authenticated = true, generation = 1, cancelCount = 0, submitted = 0, computed = 0, blocked = false, pending;
  let progress;
  let game = { id: 'g', gameplayRevision: 0, computer: createComputerControl('owner', { p1: 'babs', p2: null }), board: { state: createInitialState() } };
  const saved = [];
  let transport = { getIdentityId: () => 'owner', getGameViewModel: () => ({ ...game, pendingCommandCount: 0, sharedMutationsBlocked: blocked }), loadGame: async () => game,
    computerControl: async (_, values) => { game = { ...game, computer: changeComputerControl(game.computer, { ...values, ownerId: 'owner', authContextId: 'session', now, turnIndex: 0 }) }; },
    decisionAttempt: async (_, value) => { saved.push(value); },
    applyGameAction: async () => { submitted++; return { committed: Promise.resolve() }; },
  };
  const runtime = { compute: async (_, onProgress) => new Promise((resolve, reject) => { computed++; progress = onProgress; pending = { resolve, reject }; }), cancel: () => { cancelCount++; pending?.reject(Error('cancelled')); pending = null; } };
  const session = createComputerSession({ deviceId: 'device', runtime, analysisRuntime: runtime, clock: () => now, timers: { setInterval() { return 1; }, clearInterval() {} }, getContext: () => ({ game, transport, accountGeneration: generation, authenticated, canAnalyze, visible }) });
  return { session, get transport() {return transport;}, changeAccount: () => {generation++;}, changeTransport: () => {transport = {...transport};}, logout: () => { authenticated = false; generation++; session.suspend(); }, switchGame: () => { game = { ...game, id: 'other-game' }; }, game: () => game, saved, setBlocked: value => { blocked = value; }, computations: () => computed, setTime: value => { now = value; }, hide: () => { visible = false; }, show: () => {visible = true;}, pending: () => pending, progress: value => progress?.(value), submissions: () => submitted, cancellations: () => cancelCount };
}

test('connection recovery defers computer work before calculation without saving or submitting', async t => {
  const f = fixture(); t.after(() => f.session.destroy()); await f.session.tick();
  f.setBlocked(true); const waiting = f.session.tick(), computationsBeforeReady = f.computations();
  if (computationsBeforeReady) f.pending().resolve({result:{status:'ready',action:{type:'pass'}}});
  await waiting;
  assert.equal(computationsBeforeReady, 0); assert.deepEqual(f.saved, []); assert.equal(f.submissions(), 0);
  f.setBlocked(false); const work = f.session.tick();
  f.pending().resolve({result:{status:'ready',action:{type:'pass'}}}); await work;
  assert.equal(f.computations(), 1); assert.equal(f.submissions(), 1);
});

for (const boundary of ['calculation', 'proof persistence']) test(`recovery during ${boundary} retains evidence and recomputes only after authority settles`, async t => {
  const f = fixture(); t.after(() => f.session.destroy()); await f.session.tick();
  if (boundary === 'proof persistence') {
    const save = f.transport.decisionAttempt;
    f.transport.decisionAttempt = async (...args) => { await save(...args); f.setBlocked(true); };
  }
  const work = f.session.tick();
  if (boundary === 'calculation') f.setBlocked(true);
  f.pending().resolve({result:{status:'ready',action:{type:'pass'}}}); await work;
  assert.equal(f.saved.length, 1); assert.equal(f.saved[0].attempt.outcome, 'ready');
  assert.equal(f.submissions(), 0); assert.notEqual(f.session.snapshot().phase, 'recovery');
  await f.session.tick(); assert.equal(f.computations(), 1);
  f.transport.decisionAttempt = async (_, value) => f.saved.push(value);
  f.setBlocked(false); const fresh = f.session.tick();
  assert.equal(f.computations(), 2);
  f.pending().resolve({result:{status:'ready',action:{type:'pass'}}}); await fresh;
  assert.equal(f.submissions(), 1); assert.equal(f.saved.length, 2);
  assert.notEqual(f.saved[0].attemptId, f.saved[1].attemptId, 'fresh calculation has fresh proof, not an intent replay');
});

test('a recovery race at durable admission defers only an unadmitted command', async t => {
  const f = fixture(); t.after(() => f.session.destroy()); await f.session.tick();
  let calls = 0;
  f.transport.applyGameAction = async () => {
    calls++;
    if (calls === 1) { f.setBlocked(true); throw Object.assign(Error('sync_recovering'), {code:'sync_recovering'}); }
    return {committed:Promise.resolve()};
  };
  const work = f.session.tick(); f.pending().resolve({result:{status:'ready',action:{type:'pass'}}}); await work;
  assert.equal(calls, 1); assert.equal(f.saved[0].attempt.outcome, 'ready');
  assert.notEqual(f.session.snapshot().phase, 'recovery');
  await f.session.tick(); assert.equal(f.computations(), 1);
  f.setBlocked(false); const fresh = f.session.tick(); f.pending().resolve({result:{status:'ready',action:{type:'pass'}}}); await fresh;
  assert.equal(calls, 2); assert.equal(f.computations(), 2);
});

test('a rejected committed command remains terminal even with the recovery error code', async t => {
  const f = fixture(); t.after(() => f.session.destroy()); await f.session.tick();
  f.transport.applyGameAction = async () => ({committed:Promise.reject(Object.assign(Error('sync_recovering'), {code:'sync_recovering'}))});
  const work = f.session.tick(); f.pending().resolve({result:{status:'ready',action:{type:'pass'}}}); await work;
  assert.equal(f.session.snapshot().phase, 'recovery');
  await f.session.tick(); assert.equal(f.computations(), 1);
});

test('a proof persistence failure remains terminal rather than becoming an unadmitted move retry', async t => {
  const f = fixture(); t.after(() => f.session.destroy()); await f.session.tick();
  f.transport.decisionAttempt = async () => { throw Object.assign(Error('sync_recovering'), {code:'sync_recovering'}); };
  const work = f.session.tick(); f.pending().resolve({result:{status:'ready',action:{type:'pass'}}}); await work;
  assert.equal(f.session.snapshot().phase,'recovery'); assert.equal(f.submissions(),0);
  await f.session.tick(); assert.equal(f.computations(),1);
});

test('a game change while recovery delays a saved result never submits the old position', async t => {
  const f = fixture(); t.after(() => f.session.destroy()); await f.session.tick();
  let release, saving;
  const startedSaving = new Promise(resolve => { saving = resolve; });
  f.transport.decisionAttempt = async (_, value) => { f.saved.push(value); await new Promise(resolve => { release = resolve; saving(); }); };
  const work = f.session.tick(); f.pending().resolve({result:{status:'ready',action:{type:'pass'}}});
  await startedSaving;
  f.setBlocked(true); f.switchGame(); release(); await work;
  assert.equal(f.submissions(),0); assert.equal(f.computations(),1);
  await f.session.tick(); assert.equal(f.computations(),1);
});
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

test('a routine lease renewal retains a completed calculation until its receipt settles',async t=>{
 const f=fixture();t.after(()=>f.session.destroy());await f.session.tick();
 const control=f.transport.computerControl;let release;
 f.transport.computerControl=async(...args)=>{
  if(args[1].action==='renew'){f.setBlocked(true);await new Promise(resolve=>{release=resolve;});}
  await control(...args);f.setBlocked(false);
 };
 const work=f.session.tick();assert.equal(f.computations(),1);
 f.setTime(5200);await f.session.tick();
 while(!release)await Promise.resolve();
 f.pending().resolve({result:{status:'ready',action:{type:'pass'}}});
 for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(f.submissions(),0);assert.equal(f.computations(),1);
 release();await work;
 assert.equal(f.submissions(),1);assert.equal(f.computations(),1);
});

test('phase clocks include proof saving, survive same-phase ticks and accept zero-based clocks', async () => {
  const f=fixture(); f.setTime(0); await f.session.tick(); const computation=f.session.tick();
  assert.equal(f.session.snapshot().startedAt,0);
  f.setTime(5000); f.progress({phase:'computing'});
  assert.equal(f.session.snapshot().elapsedMs,5000); assert.equal(f.session.snapshot().phaseElapsedMs,0);
  f.setTime(5100); f.progress({phase:'computing'});
  assert.equal(f.session.snapshot().phaseElapsedMs,100);
  let finishProof; const proofSaved=new Promise(resolve=>{finishProof=resolve});
  f.transport.decisionAttempt=async()=>proofSaved;
  f.pending().resolve({result:{status:'ready',action:{type:'pass'}}}); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.session.snapshot().phase,'saving');
  f.setTime(15100); assert.equal(f.session.snapshot().phaseElapsedMs,10000);
  assert.equal(f.submissions(),0); finishProof(); await computation;
  assert.equal(f.submissions(),1); f.session.destroy();
});

for (const phase of ['recovery', 'slow']) for (const change of ['switchGame', 'changeAccount', 'changeTransport']) {
  test(`${phase} feedback cannot follow ${change} before tick or during lease acquisition`, async () => {
    const f = fixture();
    await f.session.tick(); const previousWork = f.session.tick();
    if (phase === 'recovery') {f.pending().reject(Error('previous-game-error')); await previousWork;}
    else {f.setTime(31_100); f.progress({phase:'looking-ahead'});}
    assert.equal(f.session.snapshot().phase, phase === 'recovery' ? 'recovery' : 'looking-ahead');
    if (phase === 'slow') assert.equal(f.session.snapshot().elapsedMs, 31_000);
    f[change](); f.game().computer.lease = null;
    const clean = () => {
      const status = f.session.snapshot();
      assert.equal(status.phase, 'idle'); assert.equal(status.message, undefined);
      assert.equal(status.profile, undefined); assert.equal(status.elapsedMs, 0);
      assert.equal(status.phaseElapsedMs, 0); assert.equal(status.detailed, false);
    };
    clean();
    f.progress({phase:'checking'}); clean();
    let release, started;
    const held = new Promise(resolve => {release = resolve;});
    const sent = new Promise(resolve => {started = resolve;});
    const originalControl = f.transport.computerControl;
    f.transport.computerControl = async (id, request) => {
      if (request.action === 'acquire') {started(); await held;}
      return originalControl(id, request);
    };
    const acquisition = f.session.tick(); await sent; clean();
    release(); await acquisition; await previousWork; clean();
    // A new owner scope may compute after acquisition, including a transport
    // replacement whose game/revision key is identical to the old recovery key.
    const nextWork = f.session.tick();
    assert.equal(f.session.snapshot().phase, 'preparing');
    assert.equal(f.session.snapshot().elapsedMs, 0);
    f.session.suspend(); await nextWork; f.session.destroy();
  });
}

test('accepted revision updates retain the same owner scope and saving clock', async () => {
  const f = fixture(); let acknowledge, submitted;
  const committed = new Promise(resolve => {acknowledge = resolve;});
  const sent = new Promise(resolve => {submitted = resolve;});
  f.transport.applyGameAction = async () => {submitted(); return {committed};};
  await f.session.tick(); const work = f.session.tick();
  f.pending().resolve({result:{status:'ready', action:{type:'pass'}}}); await sent;
  f.setTime(10_100); f.game().gameplayRevision++;
  await f.session.tick();
  assert.equal(f.session.snapshot().phase, 'saving');
  assert.equal(f.session.snapshot().elapsedMs, 10_000);
  assert.equal(f.session.snapshot().phaseElapsedMs, 10_000);
  acknowledge(); await work; f.session.destroy();
});

test('explicit undo claims a reloaded device lease, while normal ticks never switch it', async () => {
  const f = fixture(), requests = [];
  f.game().computer.lease = {deviceId:'previous-page',authContextId:'session',expiresAt:10_000};
  const original = f.transport.computerControl;
  f.transport.computerControl = async (id, request) => {requests.push({action:request.action,generation:request.generation}); return original(id,request);};
  await f.session.tick(); await f.session.tick();
  assert.equal(f.session.snapshot().phase, 'other-device'); assert.deepEqual(requests, []);
  let undone = 0;
  assert.equal(await f.session.withMutation(async () => {
    await f.session.action('pause'); undone++;
    f.game().gameplayRevision++; f.game().computer.generation++; f.game().computer.lease = null;
    return true;
  }), true);
  assert.equal(undone, 1);
  assert.deepEqual(requests, [{action:'switch',generation:0},{action:'pause',generation:1}]);
  await f.session.tick(); await f.session.action('resume');
  assert.deepEqual(requests.slice(2), [{action:'acquire',generation:3},{action:'resume',generation:4}]);
  assert.equal(f.game().computer.paused, false); f.session.destroy();
});

for (const change of ['switchGame', 'changeAccount', 'changeTransport', 'foreignOwner']) {
  test(`an explicit undo lease claim cannot continue after ${change}`, async () => {
    const f = fixture(), requests = [];
    f.game().computer.lease = {deviceId:'previous-page',authContextId:'session',expiresAt:10_000};
    let release, started, mutations = 0;
    const held = new Promise(resolve => {release=resolve;});
    const sent = new Promise(resolve => {started=resolve;});
    f.transport.computerControl = async (_id, request) => {requests.push(request.action);started();await held;};
    const mutation = f.session.withMutation(async () => {mutations++;});
    await sent;
    if (change === 'foreignOwner') f.game().computer.ownerId='another-owner'; else f[change]();
    release(); assert.equal(await mutation, false);
    assert.deepEqual(requests, ['switch']); assert.equal(mutations,0); f.session.destroy();
  });
}

test('undo never claims foreign ownership or retries a rejected generation', async () => {
  const f = fixture(); let mutations=0, requests=0;
  f.game().computer.ownerId='another-owner';
  f.transport.computerControl=async()=>{requests++;throw Error('computer_control_changed');};
  assert.equal(await f.session.withMutation(async()=>{mutations++;}),false);
  assert.equal(requests,0);
  f.game().computer.ownerId='owner';
  await assert.rejects(f.session.withMutation(async()=>{mutations++;}),/computer_control_changed/);
  assert.equal(requests,1);assert.equal(mutations,0);
  assert.equal(f.session.snapshot().phase,'recovery');f.session.destroy();
});

test('a repeated-position pause cannot relabel its old warning into another game', async () => {
  const f=fixture();f.game().computer.seats={p1:'babs',p2:'tau'};
  await f.session.tick();
  for(let index=0;index<2;index++) {
    const work=f.session.tick();f.pending().resolve({result:{status:'ready',action:{type:'pass'}}});await work;
    f.game().gameplayRevision++;
  }
  let release,started;
  const held=new Promise(resolve=>{release=resolve;}),sent=new Promise(resolve=>{started=resolve;});
  f.transport.computerControl=async(_id,request)=>{assert.equal(request.action,'pause');started();await held;};
  const pause=f.session.tick();await sent;f.switchGame();
  release();await pause;
  assert.equal(f.session.snapshot().phase,'idle');assert.equal(f.session.snapshot().message,undefined);
  f.session.destroy();
});

test('failed automatic acquisition records its error and retries with bounded delay without resetting the notice clock',async t=>{
 const f=fixture();t.after(()=>f.session.destroy());enableResume(f);let requests=0;
 f.transport.computerControl=async()=>{requests++;throw Object.assign(Error('request_timeout'),{code:'request_timeout'});};
 await f.session.tick();assert.equal(requests,1);
 assert.equal(f.session.snapshot().activity.lastAcquisitionFailure.code,'request_timeout');
 f.setTime(599);await f.session.tick();assert.equal(requests,1);
 f.setTime(600);await f.session.tick();assert.equal(requests,2);
 f.setTime(30099);assert.equal(f.session.snapshot().activity.showRecoveryNotice,false);
 f.setTime(30100);assert.equal(f.session.snapshot().activity.showRecoveryNotice,true);
 await f.session.tick();assert.equal(f.session.snapshot().activity.waitingMs,30000);
 f.game().gameplayRevision++;assert.equal(f.session.snapshot().activity.waitingMs,0);
 f.setTime(50000);f.hide();assert.equal(f.session.snapshot().activity.waitingMs,0);
 f.show();assert.equal(f.session.snapshot().activity.waitingMs,0);
});

test('actual computation progress resets waiting but repeated progress labels and counts do not',async t=>{
 const f=fixture();t.after(()=>f.session.destroy());await f.session.tick();const work=f.session.tick();
 f.setTime(1000);f.progress({phase:'looking-ahead',work:1});assert.equal(f.session.snapshot().activity.waitingMs,0);
 f.setTime(2000);f.progress({phase:'looking-ahead',work:1});assert.equal(f.session.snapshot().activity.waitingMs,1000);
 f.setTime(3000);f.progress({phase:'looking-ahead'});assert.equal(f.session.snapshot().activity.waitingMs,2000);
 f.setTime(4000);f.progress({phase:'looking-ahead',work:2});assert.equal(f.session.snapshot().activity.waitingMs,0);
 f.session.suspend();await work;
});

function enableResume(f) {
 f.game().sharedReceipts=true;f.game().computerCapabilities=COMPUTER_CAPABILITIES;
 f.transport.reconcileGame=async()=>{};
}

test('explicit resume here transfers control and restores paused manual play with one concurrent request',async t=>{
 const f=fixture();t.after(()=>f.session.destroy());enableResume(f);
 Object.assign(f.game().computer,{paused:true,manual:true,singleStep:true,takeoverTurn:0,lease:{deviceId:'elsewhere',authContextId:'session',expiresAt:10000}});
 const control=f.transport.computerControl;let release,requests=0;
 const gate=new Promise(resolve=>{release=resolve;});
 f.transport.computerControl=async(...args)=>{requests++;assert.equal(args[1].action,'resume-here');await gate;return control(...args);};
 const first=f.session.action('resume-here'),second=f.session.action('resume-here');
 for(let i=0;i<20&&!requests;i++)await Promise.resolve();
 assert.equal(requests,1);assert.equal(f.session.snapshot().activity.label,'Resuming');
 assert.ok(f.session.snapshot().activity.disabledReason);
 release();await Promise.all([first,second]);
 const c=f.game().computer;
 assert.equal(c.lease.deviceId,'device');assert.deepEqual([c.paused,c.manual,c.singleStep,c.takeoverTurn],[false,false,false,null]);
 assert.equal(f.session.snapshot().activity.activeHere,true);
});

test('resume here settles authority first and refuses a new control request while the original delivery remains uncertain',async t=>{
 const f=fixture();t.after(()=>f.session.destroy());enableResume(f);let requests=0,reconciled=0;
 f.setBlocked(true);f.transport.reconcileGame=async()=>{reconciled++;};f.transport.computerControl=async()=>{requests++;};
 await assert.rejects(f.session.action('resume-here'),/sync_recovering/);
 assert.equal(reconciled,1);assert.equal(requests,0);
});

test('resume here requires advertised durable support and cannot follow account or game changes',async t=>{
 for(const change of ['switchGame','changeAccount','changeTransport']) {
  const f=fixture();t.after(()=>f.session.destroy());enableResume(f);let release,requests=0;
  f.transport.reconcileGame=async()=>new Promise(resolve=>{release=resolve;});
  f.transport.computerControl=async()=>{requests++;};
  const work=f.session.action('resume-here');while(!release)await Promise.resolve();
  f[change]();release();await work;assert.equal(requests,0);
 }
 const f=fixture();t.after(()=>f.session.destroy());
 await assert.rejects(f.session.action('resume-here'),/upgrade_required/);
});

test('acquisition failure from a previous game never contaminates current activity',async t=>{
 const f=fixture();t.after(()=>f.session.destroy());let reject;
 f.transport.computerControl=async()=>new Promise((_,r)=>{reject=r;});
 const work=f.session.tick();while(!reject)await Promise.resolve();f.switchGame();reject(Error('old-request-failed'));await work;
 assert.equal(f.session.snapshot().activity.lastAcquisitionFailure,null);
 assert.equal(f.session.snapshot().activity.waitingMs,0);
});

test('transport recovery owns retries without automatic lease requests or extra refreshes',async t=>{
 const f=fixture();t.after(()=>f.session.destroy());let controls=0,loads=0;
 f.transport.computerControl=async()=>{controls++;};f.transport.loadGame=async()=>{loads++;};f.setBlocked(true);
 for(const now of [100,1100,5100,30100]){f.setTime(now);await f.session.tick();}
 assert.equal(controls,0);assert.equal(loads,0);assert.equal(f.computations(),0);
});

test('a failed renewal retains completed work when refreshed authority still owns this tab',async t=>{
 const f=fixture();t.after(()=>f.session.destroy());await f.session.tick();const work=f.session.tick();
 const cancelled=f.cancellations();let renewed=false;
 f.transport.computerControl=async()=>{renewed=true;throw Object.assign(Error('sync_recovering'),{code:'sync_recovering'});};
 f.setTime(5200);await f.session.tick();
 for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(renewed,true);assert.equal(f.cancellations(),cancelled);
 f.pending().resolve({result:{status:'ready',action:{type:'pass'}}});await work;assert.equal(f.submissions(),1);
});

test('destroying a session fences an in-flight explicit recovery before it can acquire',async()=>{
 const f=fixture();enableResume(f);let release,requests=0;
 f.transport.reconcileGame=async()=>new Promise(resolve=>{release=resolve;});f.transport.computerControl=async()=>{requests++;};
 const work=f.session.action('resume-here');while(!release)await Promise.resolve();f.session.destroy();release();await work;
 await f.session.tick();assert.equal(requests,0);
});
