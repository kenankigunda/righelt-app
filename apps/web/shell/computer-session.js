import { COMPUTER_CAPABILITIES, COMPUTER_TIMING, COMPUTER_PROFILES, CURRENT_COMPUTER_MODEL, computerProfileFor } from '../generated/packages/shared-types/src/computer-play.js';
import { SYNC_TIMING } from '../generated/packages/shared-types/src/sync-protocol.js';
import { computerActivity } from './computer-activity.js';
import { deterministicStateHash } from '../generated/packages/game-engine/src/hash.js';
import { ComputerRuntime } from './computer-runtime.js';

export function createComputerSession({ getContext, onChange = () => {}, runtime = new ComputerRuntime(), analysisRuntime = new ComputerRuntime(), clock = () => Date.now(), timers = globalThis, deviceId = crypto.randomUUID() }) {
  let status = { phase: 'idle' }, statusScope = null, epoch = 0, active = null, busy = false, leaseWork = null, leaseWorkAction = null, controlWork = 0, renewedAt = 0, recovery = null, pendingSubmission = null;
  let analysis = null, analysisContext = null, analysisEpoch = 0, lastPositionRevision = null;
  let activityScope = null, waitingSince = null, waitingRevision = null, lastAcquisitionFailure = null, acquisitionAttempts = 0, retryAt = 0, resumeWork = null, resumeScope = null;
  const progressWork = new Map();
  const repetitions = new Map();
  const ownerScope = context => ({gameId:context.game?.id, transport:context.transport, accountGeneration:context.accountGeneration});
  const sameOwnerScope = (scope, context) => scope?.gameId === context.game?.id && scope?.transport === context.transport && scope?.accountGeneration === context.accountGeneration;
  const publish = (next, context = current()) => {
    if (!sameOwnerScope(statusScope, context)) status = {phase:'idle'};
    const phaseStartedAt = next.phase !== undefined && next.phase !== status.phase ? clock() : status.phaseStartedAt;
    statusScope = ownerScope(context);
    status = { ...status, ...next, phaseStartedAt }; onChange();
  };
  const keyFor = ({ game, accountGeneration }) => game ? `${accountGeneration}:${game.id}:${game.gameplayRevision}:${game.computer?.generation}:${game.computer?.modelId}` : null;
  const current = () => { const context = getContext(); return { ...context, key: keyFor(context) }; };
  const cancelWork = (reason) => { epoch++; runtime.cancel(reason); };
  const ownLease = (game) => game?.computer?.lease?.deviceId === deviceId && game.computer.lease.expiresAt > clock();
  const resumeSupported = game => game?.sharedReceipts === true && game.computerCapabilities?.resumeHere === COMPUTER_CAPABILITIES.resumeHere;
  const recoveryScopeIsCurrent = context => sameOwnerScope(ownerScope(context), current()) && current().authenticated;
  const updateActivity = context => {
    if (!sameOwnerScope(activityScope, context)) {
      activityScope = ownerScope(context); waitingSince = null; waitingRevision = null;
      lastAcquisitionFailure = null; acquisitionAttempts = 0; retryAt = 0; progressWork.clear();
    }
    const game = context.game, control = game?.computer;
    const eligible = context.visible && context.authenticated && control?.ownerId === context.transport.getIdentityId() && game.board.state.outcome?.status === 'ongoing' && !control.paused && computerProfileFor(control, game.board.state.sideToMove, game.board.state.turnIndex ?? 0);
    if (!eligible) waitingSince = null;
    else if (waitingSince === null || waitingRevision !== game.gameplayRevision) { waitingSince = clock(); progressWork.clear(); }
    waitingRevision = game?.gameplayRevision;
  };
  const activity = (context, scopedStatus) => {
    updateActivity(context);
    return computerActivity({ game: context.game, identityId: context.transport.getIdentityId(), deviceId, authenticated: context.authenticated, visible: context.visible, status: scopedStatus, projection: context.game ? context.transport.getGameViewModel(context.game.id) : {}, now: clock(), resuming: Boolean(resumeWork && sameOwnerScope(resumeScope, context)), waitingMs: waitingSince === null ? 0 : Math.max(0, clock() - waitingSince), lastAcquisitionFailure, resumeSupported: resumeSupported(context.game) });
  };
  const noteProgress = (context, progress) => {
    if (!recoveryScopeIsCurrent(context)) return;
    const work = progress.work ?? progress.completed ?? progress.received;
    const key = `${progress.asset ?? ''}:${progress.phase ?? ''}`;
    if (Number.isFinite(work) && work > (progressWork.get(key) ?? 0)) { progressWork.set(key, work); waitingSince = clock(); }
  };
  const control = async (context, action) => context.transport.computerControl(context.game.id, { action, deviceId, generation: context.game.computer.generation });
  const startLeaseWork = (work, action = 'acquire') => {
    const pending = Promise.resolve().then(work);
    leaseWork = pending;
    leaseWorkAction = action;
    const clear = () => { if (leaseWork === pending) { leaseWork = null; leaseWorkAction = null; } };
    void pending.then(clear, clear);
    return pending;
  };
  const withControlWork = async work => {
    controlWork++;
    try { return await work(); }
    finally { controlWork--; }
  };
  const fence = action => withControlWork(async () => {
    cancelWork(action);
    let context = current();
    if (!context.game?.computer) return;
    const gameId = context.game.id;
    const owner = context.transport, accountGeneration = context.accountGeneration;
    publish({ phase: 'saving', message: 'Confirming the last move…' });
    // Accepted commands remain accepted. Never drop an uncertain submission to enable takeover.
    const submissionToReconcile = pendingSubmission;
    if (submissionToReconcile) { await context.transport.reconcileGame(context.game.id); await submissionToReconcile.catch(() => {}); }
    // Undo drops the lease. Another tick may already be restoring it, so wait
    // for that acknowledged generation before issuing this control once.
    if (leaseWork) await leaseWork;
    context = current();
    if (!context.game?.computer || context.game.id !== gameId || context.transport !== owner || context.accountGeneration !== accountGeneration || !context.authenticated) return;
    try {
      if (!ownLease(context.game)) throw new Error('computer_control_changed');
      await control(context, action);
    }
    catch (error) { await context.transport.loadGame(gameId).catch(() => {}); publish({ phase: 'recovery', message: error.message }, context); throw error; }
    recovery = null; lastPositionRevision = null; repetitions.clear();
    publish({ phase: action === 'pause' ? 'paused' : 'idle', message: null }, context);
  });
  async function tick() {
    const context = current(), game = context.game;
    updateActivity(context);
    if (analysis && (analysis.gameId !== game?.id || analysisContext?.accountGeneration !== context.accountGeneration || analysisContext?.transport !== context.transport || !context.authenticated)) {
      cancelAnalysis(); analysis = null; analysisContext = null;
    }
    if (!context.visible || !context.authenticated || !game?.computer || game.computer.ownerId !== context.transport.getIdentityId()) {
      if (active) {
        const previous = active; active = null; cancelWork('left-game');
        if (ownLease(previous.game) && previous.accountGeneration === context.accountGeneration) void control(previous, 'release').catch(() => {});
        publish({ phase: 'idle' });
      }
      if (!context.visible && analysis?.phase === 'computing') cancelAnalysis();
      return;
    }
    if (active && (context.key !== active.key || !sameOwnerScope(ownerScope(active), context))) cancelWork('position-or-control-changed');
    if (!sameOwnerScope(statusScope, context)) {
      recovery = null; lastPositionRevision = null; repetitions.clear();
      publish({phase:'idle'}, context);
    }
    active = context;
    onChange();
    // A control can advance the server generation before its response is applied.
    // Do not renew or start computation with the previous client generation.
    if (controlWork) return;
    if (analysis?.phase === 'computing' && clock() - analysis.startedAt >= COMPUTER_TIMING.detailAfterMs) onChange();
    if (busy && status.startedAt !== undefined && clock() - status.startedAt >= COMPUTER_TIMING.detailAfterMs) onChange();
    if (!ownLease(game)) {
      cancelWork('other-device');
      if (game.computer.lease?.expiresAt > clock()) { if (status.phase !== 'other-device') publish({ phase: 'other-device' }); return; }
      if (leaseWork) {
        const wasRenewal = leaseWorkAction === 'renew';
        await leaseWork;
        // Undo can invalidate a renewal already in flight. Re-evaluate the new
        // generation before returning to its explicit resume operation. Do not
        // repeat a failed acquisition or follow work into another owner scope.
        const latest = current();
        if (wasRenewal && latest.game?.id === game.id && latest.transport === context.transport && latest.accountGeneration === context.accountGeneration) return tick();
        return;
      }
      if (clock() < retryAt) return;
      startLeaseWork(async () => {
        try {
          await control(context, 'acquire');
          if (!recoveryScopeIsCurrent(context)) return;
          renewedAt = clock(); lastAcquisitionFailure = null; acquisitionAttempts = 0; retryAt = 0;
          publish({phase:'idle', message:undefined}, context);
        } catch (error) {
          if (!recoveryScopeIsCurrent(context)) return;
          lastAcquisitionFailure = {code:error.code ?? error.message, at:clock()};
          const terminal = ['computer_owner_required', 'invalid_credentials', 'session_changed', 'upgrade_required', 'storage_reset', 'invalid_device'].includes(lastAcquisitionFailure.code);
          retryAt = terminal ? Infinity : clock() + SYNC_TIMING.retryDelaysMs[Math.min(acquisitionAttempts++, SYNC_TIMING.retryDelaysMs.length - 1)];
          if (terminal) publish({phase:'recovery', message:error.message}, context);
          await context.transport.loadGame(game.id).catch(() => {});
          if (recoveryScopeIsCurrent(context)) onChange();
        }
      });
      await leaseWork;
      return;
    }
    if (!leaseWork && clock() - renewedAt >= COMPUTER_TIMING.renewAfterMs) {
      void startLeaseWork(() => control(context, 'renew').then(() => { renewedAt = clock(); }).catch(() => { cancelWork('lease-lost'); return context.transport.loadGame(game.id); }).catch(() => {}), 'renew');
    }
    const profile = computerProfileFor(game.computer, game.board.state.sideToMove, game.currentTurn?.index ?? game.board.state.turnIndex ?? 0);
    if (game.computer.paused || !profile || game.board.state.outcome?.status !== 'ongoing') {
      if (!busy && status.phase !== (game.computer.paused ? 'paused' : 'idle')) publish({ phase: game.computer.paused ? 'paused' : 'idle', message: null });
      return;
    }
    const projection = context.transport.getGameViewModel(game.id);
    if (busy || leaseWork || pendingSubmission || projection?.sharedMutationsBlocked || projection?.pendingCommandCount > 0 || recovery === context.key) return;
    if (game.computer.seats.p1 && game.computer.seats.p2 && lastPositionRevision !== game.gameplayRevision) {
      lastPositionRevision = game.gameplayRevision;
      const position = structuredClone(game.board.state); position.turnIndex = 0;
      const repeated = deterministicStateHash(position), count = (repetitions.get(repeated) ?? 0) + 1;
      repetitions.set(repeated, count);
      if (count >= 3) { await fence('pause'); if (sameOwnerScope(ownerScope(context), current())) publish({ phase: 'paused', message: 'This position has repeated three times. Continue, inspect it, or stop.' }, context); return; }
    }
    busy = true;
    const run = ++epoch, attemptId = crypto.randomUUID(), seed = crypto.getRandomValues(new Uint32Array(1))[0], startedAt = clock();
    const proof = { deviceId, generation: game.computer.generation, modelId: game.computer.modelId, profile, profileVersion: COMPUTER_PROFILES[profile].version, seed, attemptId };
    const base = { proof, gameId: game.id, gameplayRevision: game.gameplayRevision, fingerprint: deterministicStateHash(game.board.state), startedAt, state: structuredClone(game.board.state) };
    let saved = false;
    publish({ phase: 'preparing', startedAt, profile, attemptId, progress: null, message: null });
    try {
      const response = await runtime.compute({ gameId: game.id, gameplayRevision: game.gameplayRevision, state: game.board.state, modelId: game.computer.modelId, profile, seed, controlGeneration: game.computer.generation }, progress => { if (run === epoch && sameOwnerScope(ownerScope(context), current())) { noteProgress(context, progress); publish({ phase: progress.phase, progress }, context); } });
      if (run !== epoch || current().key !== context.key || !sameOwnerScope(ownerScope(context), current())) return;
      const attempt = { ...base, completedAt: clock(), outcome: response.result.status, result: response.result, cacheAvailable: runtime.cacheAvailable, evidenceSource: 'client-reported' };
      // Proof persistence is part of saving; a slow evidence write deserves the
      // same delayed feedback as a slow gameplay command.
      publish({ phase: 'saving', progress: null }, context);
      await context.transport.decisionAttempt(game.id, { operation: 'write', kind: 'computer', attemptId, attempt }); saved = true;
      if (run !== epoch || current().key !== context.key || !sameOwnerScope(ownerScope(context), current())) return;
      if (response.result.status !== 'ready') throw new Error(response.result.reason);
      // A routine renewal keeps the same control generation. Preserve completed
      // calculation while its durable receipt settles instead of calculating again.
      if (leaseWork && leaseWorkAction === 'renew') {
        await leaseWork;
        if (run !== epoch || current().key !== context.key) return;
      }
      // Recovery can begin during calculation or evidence persistence. Keep the
      // completed evidence, then calculate again from settled authority later.
      if (context.transport.getGameViewModel(game.id)?.sharedMutationsBlocked) {
        publish({ phase: 'idle', message: null }, context);
        return;
      }
      publish({ phase: 'saving', progress: null }, context);
      const handle = await context.transport.applyGameAction({ gameId: game.id, state: game.board.state, action: response.result.action, computer: proof });
      if (!handle?.committed) throw new Error(handle?.validation?.code ?? 'move-not-submitted');
      pendingSubmission = handle.committed;
      await pendingSubmission;
      publish({ phase: 'idle' }, context);
    } catch (error) {
      if (!saved) void context.transport.decisionAttempt(game.id, { operation: 'write', kind: 'computer', attemptId, attempt: { ...base, stoppedAt: clock(), outcome: 'unfinished', reason: error.message, progress: status.progress ?? null } }).catch(() => {});
      // The admission guard may win the final race after the projection check.
      // No command exists yet, so wait for recovery instead of latching a
      // computer failure. Once admitted, its durable outcome remains binding.
      if (saved && !pendingSubmission && error.code === 'sync_recovering' && run === epoch && current().key === context.key && sameOwnerScope(ownerScope(context), current())) {
        publish({ phase: 'idle', message: null }, context);
        return;
      }
      if (run === epoch) { recovery = context.key; publish({ phase: 'recovery', message: error.message }, context); }
    } finally { busy = false; pendingSubmission = null; }
  }
  function cancelAnalysis() {
    analysisEpoch++; analysisRuntime.cancel('analysis-cancelled');
    if (analysis?.phase === 'computing') {
      analysis = { ...analysis, phase: 'cancelled', stoppedAt: clock(), outcome: 'unfinished' };
      void analysisContext?.transport.decisionAttempt(analysis.gameId, { operation: 'write', kind: 'analysis', attemptId: analysis.attemptId, attempt: analysis }).catch(() => {});
    }
    onChange();
  }
  async function analyze(state, decisionId = null) {
    cancelAnalysis();
    let context = current();
    if (!context.authenticated || context.canAnalyze === false || !context.game) throw new Error('Sign in to analyze this position.');
    const requestEpoch = analysisEpoch, requestContext = context;
    const frozen = structuredClone(state), gameId = context.game.id, revision = context.game.gameplayRevision;
    if (context.game.computer?.ownerId === context.transport.getIdentityId() && ownLease(context.game)) await fence('pause');
    context = current();
    if (requestEpoch !== analysisEpoch || context.transport !== requestContext.transport || context.accountGeneration !== requestContext.accountGeneration || context.game?.id !== gameId || !context.authenticated || !context.visible) return;
    analysisContext = context;
    const run = ++analysisEpoch, attemptId = crypto.randomUUID();
    analysis = { phase: 'computing', state: frozen, decisionId, gameId, attemptId, startedAt: clock(), modelId: CURRENT_COMPUTER_MODEL.id }; onChange();
    try {
      const result = await analysisRuntime.compute({ gameId, gameplayRevision: revision, state: frozen, modelId: CURRENT_COMPUTER_MODEL.id, profile: 'horus', seed: 107, analysis: true }, progress => { if (run === analysisEpoch) { analysis.progress = progress; onChange(); } });
      if (run !== analysisEpoch) return;
      analysis = { ...analysis, phase: 'complete', completedAt: clock(), result: result.result, evidenceSource: 'client-reported', valuePerspective: 'P1/red' };
      await context.transport.decisionAttempt(gameId, { operation: 'write', kind: 'analysis', attemptId, attempt: analysis });
    } catch (error) { if (run === analysisEpoch) { analysis = { ...analysis, phase: 'recovery', stoppedAt: clock(), outcome: 'unfinished', message: error.message }; await context.transport.decisionAttempt(gameId, { operation: 'write', kind: 'analysis', attemptId, attempt: analysis }).catch(() => {}); } }
    onChange();
  }
  const resumeHere = () => {
    if (resumeWork) return resumeWork;
    const initial = current();
    const allowed = context => recoveryScopeIsCurrent(initial) && context.visible && context.game?.id === initial.game?.id && context.game?.computer?.ownerId === context.transport.getIdentityId() && context.game.canControlComputer !== false && context.game.board.state.outcome?.status === 'ongoing';
    if (!allowed(initial)) return Promise.reject(Error('computer_owner_required'));
    if (!resumeSupported(initial.game)) return Promise.reject(Error('upgrade_required'));
    resumeScope = ownerScope(initial);
    const work = Promise.resolve().then(() => withControlWork(async () => {
      cancelWork('resume-here');
      publish({phase:'resuming', message:null}, initial);
      const submission = pendingSubmission;
      try {
        await initial.transport.reconcileGame(initial.game.id);
        if (submission) await submission.catch(() => {});
        if (leaseWork) await leaseWork;
        if (!allowed(current())) return;
        await initial.transport.loadGame(initial.game.id);
        const context = current();
        if (!allowed(context)) return;
        if (!resumeSupported(context.game)) throw Error('upgrade_required');
        const projection = context.transport.getGameViewModel(context.game.id);
        if (projection?.sharedMutationsBlocked || projection?.pendingCommandCount > 0) throw Object.assign(Error('sync_recovering'), {code:'sync_recovering'});
        await control(context, 'resume-here');
        if (!allowed(current())) return;
        recovery = null; lastAcquisitionFailure = null; acquisitionAttempts = 0; retryAt = 0; renewedAt = clock();
        waitingSince = clock(); progressWork.clear(); lastPositionRevision = null; repetitions.clear();
        publish({phase:'idle', message:null}, current());
      } catch (error) {
        if (recoveryScopeIsCurrent(initial)) publish({phase:'recovery', message:error.message}, initial);
        throw error;
      }
    })).finally(() => {
      if (resumeWork === work) { resumeWork = null; resumeScope = null; onChange(); }
    });
    resumeWork = work;
    onChange();
    return work;
  };
  const timer = timers.setInterval(() => { void tick().catch(error => publish({ phase: 'recovery', message: error.message })); }, 1000);
  return {
    tick, analyze, cancelAnalysis,
    withMutation: work => withControlWork(async () => {
      cancelWork('history-mutation');
      const original = current();
      if (leaseWork) await leaseWork;
      let context = current();
      const mayMutate = value => sameOwnerScope(ownerScope(original), value) && value.authenticated && value.game?.computer?.ownerId === value.transport.getIdentityId();
      if (!mayMutate(context)) return false;
      try {
        if (!ownLease(context.game)) {
          // Undo is explicit owner intent. Claim its serialized lease before
          // pausing, while ordinary ticks continue to respect another device.
          const foreignLease = context.game.computer.lease?.expiresAt > clock();
          await control(context, foreignLease ? 'switch' : 'acquire');
          context = current();
          if (!mayMutate(context)) return false;
          if (!ownLease(context.game)) throw Error('computer_control_changed');
        }
        return await work();
      } catch (error) {
        if (mayMutate(current())) publish({phase:'recovery', message:error.message}, context);
        throw error;
      }
    }),
    snapshot: () => {
      const context = current();
      const scopedAnalysis = context.authenticated && analysis?.gameId === context.game?.id && analysisContext?.accountGeneration === context.accountGeneration && analysisContext?.transport === context.transport ? analysis : null;
      const scopedStatus = sameOwnerScope(statusScope, context) ? status : {phase:'idle'};
      return { ...scopedStatus, elapsedMs: scopedStatus.startedAt !== undefined ? Math.max(0, clock() - scopedStatus.startedAt) : 0, phaseElapsedMs: scopedStatus.phaseStartedAt !== undefined ? Math.max(0, clock() - scopedStatus.phaseStartedAt) : 0, detailed: Boolean(scopedStatus.startedAt !== undefined && clock() - scopedStatus.startedAt >= COMPUTER_TIMING.detailAfterMs), analysis: scopedAnalysis, deviceId, activity: activity(context, scopedStatus) };
    },
    action: async action => { if (action === 'resume-here') return resumeHere(); if (action === 'switch') await withControlWork(async () => { cancelWork('switch'); const context = current(); await control(context, 'switch'); }); else await fence(action === 'retry' ? 'resume' : action); },
    suspend: () => { const previous = active; cancelWork('session-changed'); cancelAnalysis(); analysis = null; analysisContext = null; active = null; activityScope = null; waitingSince = null; recovery = null; status = { phase: 'idle' }; if (previous && ownLease(previous.game)) void control(previous, 'release').catch(() => {}); onChange(); },
    destroy: () => { timers.clearInterval(timer); cancelWork('destroyed'); cancelAnalysis(); active = null; },
  };
}
