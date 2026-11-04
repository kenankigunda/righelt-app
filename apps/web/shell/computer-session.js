import {createComputerSpeculation} from './computer-speculation.js';
import {isCompletedGame,isOngoingGame} from './game-lifecycle.js';
import { COMPUTER_CAPABILITIES, COMPUTER_TIMING, COMPUTER_PROFILES, CURRENT_COMPUTER_MODEL, computerProfileFor } from '../generated/packages/shared-types/src/computer-play.js';
import { SYNC_TIMING, canonicalCommandJson } from '../generated/packages/shared-types/src/sync-protocol.js';
import { computerRetryDisposition } from './computer-recovery.js';
import { createForegroundRecoveryWait } from './foreground-recovery.js';
import { computerActivity } from './computer-activity.js';
import { createComputerControlWork } from './computer-control-work.js';
import { deterministicStateHash } from '../generated/packages/game-engine/src/hash.js';
import { ComputerRuntime } from './computer-runtime.js';

export const COMPUTER_PRESENTATION = Object.freeze({ immediate: 'immediate', progress: 'progress' });

export function createComputerSession({ getContext, onChange = () => {}, runtime = new ComputerRuntime(), analysisRuntime = new ComputerRuntime(), clock = () => Date.now(), timers = globalThis, deviceId = crypto.randomUUID() }) {
  let status = { phase: 'idle' }, statusScope = null, epoch = 0, active = null, busy = false, renewedAt = 0, recovery = null, pendingSubmission = null, pendingSubmissionScope = null;
  let analysis = null, analysisContext = null, analysisEpoch = 0, lastPositionRevision = null, destroyed = false;
  let activityScope = null, waitingSince = null, waitingRevision = null, lastAcquisitionFailure = null, acquisitionAttempts = 0, retryAt = 0;
  const workFor = createComputerControlWork();
  const speculation=createComputerSpeculation({compute:(request,progress)=>runtime.compute(request,progress),onChange,clock});
  const progressWork = new Map();
  let acknowledgedLease = null;
  const repetitions = new Map();
  let phaseDeadline = null;
  let decisionRetry = null;
  const retryWait = createForegroundRecoveryWait({ clock, setTimer: timers.setTimeout?.bind(timers) ?? (() => null), clearTimer: timers.clearTimeout?.bind(timers) ?? (() => {}), onChange });
  const cancelPhaseDeadline = () => {
    if (phaseDeadline) timers.clearTimeout?.(phaseDeadline.timer);
    phaseDeadline = null;
  };
  const phaseLabelIdentity = context => {
    if (destroyed || !context.visible || !context.authenticated || !context.game || context.game.computer?.paused || !sameOwnerScope(statusScope, context)) return null;
    const projection = context.transport.getGameViewModel?.(context.game.id);
    const pendingAt = projection?.pendingComputerSaveStartedAt;
    const phase = pendingAt != null && !['recovery', 'other-device', 'paused'].includes(status.phase) ? 'saving' : status.phase;
    if (!['checking', 'saving'].includes(phase)) return null;
    const startedAt = pendingAt ?? status.phaseStartedAt;
    return startedAt == null ? null : {
      key: context.key, phase, startedAt, attemptId: status.attemptId, scope: ownerScope(context),
    };
  };
  const samePhaseLabel = (a, b) => Boolean(a && b && a.key === b.key && a.phase === b.phase &&
    a.startedAt === b.startedAt && a.attemptId === b.attemptId && sameOwnerScope(a.scope, {
      game: {id: b.scope.gameId}, transport: b.scope.transport, accountGeneration: b.scope.accountGeneration,
    }));
  const schedulePhaseLabel = () => {
    const identity = phaseLabelIdentity(current());
    if (samePhaseLabel(phaseDeadline, identity)) return;
    cancelPhaseDeadline();
    if (!identity || clock() - identity.startedAt >= COMPUTER_TIMING.phaseLabelAfterMs || !timers.setTimeout) return;
    const deadline = { ...identity };
    // One notification at the phase-label boundary; progress updates keep this deadline.
    // Recheck the current session authority before touching a newly navigated board.
    deadline.timer = timers.setTimeout(() => {
      if (phaseDeadline !== deadline) return;
      phaseDeadline = null;
      if (samePhaseLabel(deadline, phaseLabelIdentity(current()))) onChange();
    }, COMPUTER_TIMING.phaseLabelAfterMs - (clock() - identity.startedAt));
    phaseDeadline = deadline;
  };
  const ownerScope = context => ({gameId:context.game?.id, transport:context.transport, accountGeneration:context.accountGeneration});
  const sameOwnerScope = (scope, context) => scope?.gameId === context.game?.id && scope?.transport === context.transport && scope?.accountGeneration === context.accountGeneration;
  const publish = (next, context = current(), presentation = COMPUTER_PRESENTATION.immediate) => {
    if (destroyed || !sameOwnerScope(ownerScope(context), current())) return;
    if (!sameOwnerScope(statusScope, context)) status = {phase:'idle'};
    const phaseChanged = next.phase !== undefined && next.phase !== status.phase;
    const phaseStartedAt = phaseChanged ? clock() : status.phaseStartedAt;
    statusScope = ownerScope(context);
    status = { ...status, ...next, phaseStartedAt }; schedulePhaseLabel(); onChange({ presentation: phaseChanged ? COMPUTER_PRESENTATION.immediate : presentation });
  };
  const keyFor = ({ game, accountGeneration }) => game ? `${accountGeneration}:${game.id}:${game.gameplayRevision}:${game.computer?.generation}:${game.computer?.modelId}` : null;
  const current = () => { const context = getContext(); return { ...context, key: keyFor(context) }; };
  const cancelWork = (reason) => { cancelPhaseDeadline(); epoch++; speculation.discard();runtime.cancel(reason); };
  const ownLease = game => !destroyed && isOngoingGame(game) && sameOwnerScope(acknowledgedLease, current()) && acknowledgedLease.generation === game?.computer?.generation && game?.computer?.lease?.deviceId === deviceId && game.computer.lease.expiresAt > clock();
  const resumeSupported = game => game?.sharedReceipts === true && game.computerCapabilities?.resumeHere === COMPUTER_CAPABILITIES.resumeHere;
  const recoveryScopeIsCurrent = context => !destroyed && isOngoingGame(current().game) && sameOwnerScope(ownerScope(context), current()) && current().authenticated;
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
    const work = workFor(context);
    return computerActivity({ game: context.game, identityId: context.transport.getIdentityId(), deviceId, authenticated: context.authenticated, visible: context.visible, status: scopedStatus, projection: context.game ? context.transport.getGameViewModel(context.game.id) : {}, now: clock(), resuming: Boolean(work.resumeWork || (work.leaseWork && work.leaseWorkAction === 'acquire')), waitingMs: waitingSince === null ? 0 : Math.max(0, clock() - waitingSince), lastAcquisitionFailure, resumeSupported: resumeSupported(context.game), controlAcknowledged: ownLease(context.game), renewing: Boolean(work.leaseWork && work.leaseWorkAction === 'renew' && !work.controlWork && !work.resumeWork) });
  };
  const noteProgress = (context, progress) => {
    if (!recoveryScopeIsCurrent(context)) return;
    const work = progress.work ?? progress.completed ?? progress.received;
    const key = `${progress.asset ?? ''}:${progress.phase ?? ''}`;
    if (Number.isFinite(work) && work > (progressWork.get(key) ?? 0)) { progressWork.set(key, work); waitingSince = clock(); }
  };
  const control = async (context, action) => {
    const latest=current();
    if (!isOngoingGame(context.game) || latest.game?.id===context.game.id && !isOngoingGame(latest.game)) return;
    if (action!=='release' && (latest.key!==context.key || !sameOwnerScope(ownerScope(context),latest))) return;
    const result = await context.transport.computerControl(context.game.id, { action, deviceId, generation: context.game.computer.generation });
    // Public leases omit authentication context. A stable tab ID alone cannot
    // establish ownership after account/transport replacement. Only an accepted
    // control response in this exact scope establishes local authority.
    if (recoveryScopeIsCurrent(context)) {
      const latest = current();
      acknowledgedLease = latest.game?.computer?.lease?.deviceId === deviceId
        ? { ...ownerScope(latest), generation: latest.game.computer.generation } : null;
    }
    return result;
  };
  const startLeaseWork = (work, action = 'acquire', context = current()) => {
    const scoped = workFor(context), pending = Promise.resolve().then(work);
    scoped.leaseWork = pending; scoped.leaseWorkAction = action;
    onChange();
    const clear = () => {
      if (scoped.leaseWork !== pending) return;
      scoped.leaseWork = null; scoped.leaseWorkAction = null;
      if (!destroyed) onChange();
    };
    void pending.then(clear, clear);
    return pending;
  };
  const withControlWork = async (work, context = current()) => {
    const scoped = workFor(context); scoped.controlWork++;
    try { return await work(); }
    finally { scoped.controlWork--; }
  };
  const fence = action => withControlWork(async () => {
    decisionRetry = null; retryWait.reset();
    cancelWork(action);
    let context = current();
    if (!context.game?.computer || !isOngoingGame(context.game)) return;
    const gameId = context.game.id;
    const owner = context.transport, accountGeneration = context.accountGeneration;
    publish({ phase: 'saving', message: 'Confirming the last move…' });
    // Accepted commands remain accepted. Never drop an uncertain submission to enable takeover.
    const submissionToReconcile = sameOwnerScope(pendingSubmissionScope, context) ? pendingSubmission : null;
    if (submissionToReconcile) { await context.transport.reconcileGame(context.game.id); await submissionToReconcile.catch(() => {}); }
    // Undo drops the lease. Another tick may already be restoring it, so wait
    // for that acknowledged generation before issuing this control once.
    const leaseWork = workFor(context).leaseWork;
    if (leaseWork) await leaseWork;
    context = current();
    if (!context.game?.computer || context.game.id !== gameId || context.transport !== owner || context.accountGeneration !== accountGeneration || !context.authenticated) return;
    try {
      if (!ownLease(context.game)) throw new Error('computer_control_changed');
      await control(context, action);
      if (!recoveryScopeIsCurrent(context)) return;
    }
    catch (error) { await context.transport.loadGame(gameId).catch(() => {}); publish({ phase: 'recovery', message: error.message }, context); throw error; }
    recovery = null; lastPositionRevision = null; repetitions.clear();
    publish({ phase: action === 'pause' ? 'paused' : 'idle', message: null }, context);
  });
  const renewWhenDue = context => {
    const latest = current();
    if (destroyed || !isOngoingGame(latest.game) || !isOngoingGame(context.game) || !latest.visible || !latest.authenticated || latest.key !== context.key || !sameOwnerScope(ownerScope(context), latest)) return;
    const game = context.game, work = workFor(context);
    const projection = context.transport.getGameViewModel(game.id);
    if (work.leaseWork || work.controlWork || work.resumeWork || projection?.sharedMutationsBlocked || projection?.pendingCommandCount > 0
      || !ownLease(game) || clock() - renewedAt < COMPUTER_TIMING.renewAfterMs) return;
    return startLeaseWork(async () => {
      try { await control(context, 'renew'); if (recoveryScopeIsCurrent(context)) renewedAt = clock(); }
      catch {
        if (!recoveryScopeIsCurrent(context)) return;
        renewedAt = clock();
        await context.transport.loadGame(game.id).catch(() => {});
        const latest = current();
        if (recoveryScopeIsCurrent(context) && (!ownLease(latest.game) || latest.game.computer.generation !== game.computer.generation)) cancelWork('lease-lost');
      }
    }, 'renew', context);
  };
  async function tick() {
    if (destroyed) return;
    const context = current(), game = context.game, work = workFor(context);
    if (decisionRetry && (!context.visible || !context.authenticated || context.key !== decisionRetry.key || !sameOwnerScope(decisionRetry.scope, context))) { decisionRetry = null; retryWait.reset(); }
    updateActivity(context);
    if (analysis && (analysis.gameId !== game?.id || analysisContext?.accountGeneration !== context.accountGeneration || analysisContext?.transport !== context.transport || !context.authenticated)) {
      cancelAnalysis(); analysis = null; analysisContext = null;
    }
    // Completion retires only unadmitted local work. Any accepted/uncertain
    // gameplay handle continues under its existing durable journal owner.
    if (isCompletedGame(game)) {
      if (!context.visible && analysis?.phase === 'computing') cancelAnalysis();
      if (active || status.phase!=='idle' || !sameOwnerScope(statusScope,context)) {
        active=null;cancelWork('game-finished');acknowledgedLease=null;decisionRetry=null;retryWait.reset();
        recovery=null;waitingSince=null;lastAcquisitionFailure=null;retryAt=0;
        lastPositionRevision=null;repetitions.clear();
        publish({phase:'idle',startedAt:undefined,attemptId:null,profile:null,progress:null,message:null},context);
      }
      return;
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
    if (active && (context.key !== active.key || !sameOwnerScope(ownerScope(active), context)) && !(sameOwnerScope(ownerScope(active),context)&&speculation.matches(game,`${context.accountGeneration}:${game.id}`))) cancelWork('position-or-control-changed');
    if (!sameOwnerScope(statusScope, context)) {
      recovery = null; lastPositionRevision = null; repetitions.clear();
      publish({phase:'idle'}, context);
    }
    active = context;
    // This synchronous notification includes current elapsed and analysis state.
    // Repeating it below would repaint the same state during expensive work.
    onChange();
    // A control can advance the server generation before its response is applied.
    // Do not renew or start computation with the previous client generation.
    if (work.controlWork || work.resumeWork) return;
    const projection = context.transport.getGameViewModel(game.id);
    // The durable transport owns unsettled commands. Automatic lease work must
    // not start a second retry loop while that authority is being reconciled.
    if (projection?.sharedMutationsBlocked || projection?.pendingCommandCount > 0) return;
    if (!ownLease(game)) {
      cancelWork('other-device');
      if (game.computer.lease?.expiresAt > clock()) { if (status.phase !== 'other-device') publish({ phase: 'other-device' }); return; }
      if (work.leaseWork) {
        const wasRenewal = work.leaseWorkAction === 'renew';
        await work.leaseWork;
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
          const terminal = computerRetryDisposition(error) === 'terminal' && !['computer_device_busy', 'computer_control_changed'].includes(lastAcquisitionFailure.code);
          retryAt = terminal ? Infinity : clock() + Math.max(SYNC_TIMING.retryDelaysMs[Math.min(acquisitionAttempts++, SYNC_TIMING.retryDelaysMs.length - 1)], error.retryAfterMs ?? 0);
          if (terminal) publish({phase:'recovery', message:error.message}, context);
          await context.transport.loadGame(game.id).catch(() => {});
          if (recoveryScopeIsCurrent(context)) onChange();
        }
      });
      await work.leaseWork;
      return;
    }
    void renewWhenDue(context);
    const profile = computerProfileFor(game.computer, game.board.state.sideToMove, game.currentTurn?.index ?? game.board.state.turnIndex ?? 0);
    if (game.computer.paused || !profile || game.board.state.outcome?.status !== 'ongoing') {
      if (!busy && status.phase !== (game.computer.paused ? 'paused' : 'idle')) publish({ phase: game.computer.paused ? 'paused' : 'idle', message: null });
      return;
    }
    if (busy || work.leaseWork || pendingSubmission || projection?.sharedMutationsBlocked || projection?.pendingCommandCount > 0 || recovery === context.key) return;
    if (decisionRetry && clock() < decisionRetry.at) return;
    if (game.computer.seats.p1 && game.computer.seats.p2 && lastPositionRevision !== game.gameplayRevision) {
      lastPositionRevision = game.gameplayRevision;
      const position = structuredClone(game.board.state); position.turnIndex = 0;
      const repeated = deterministicStateHash(position), count = (repetitions.get(repeated) ?? 0) + 1;
      repetitions.set(repeated, count);
      if (count >= 3) { await fence('pause'); if (sameOwnerScope(ownerScope(context), current())) publish({ phase: 'paused', message: 'This position has repeated three times. Continue, inspect it, or stop.' }, context); return; }
    }
    busy = true;
    const retry = decisionRetry, retained = retry?.decision;
    const candidate=!retained?speculation.take(game,`${context.accountGeneration}:${game.id}`):null;
    const run = ++epoch, attemptId = retained?.attemptId ?? candidate?.proof.attemptId ?? crypto.randomUUID(), seed = retained?.proof.seed ?? candidate?.proof.seed ?? crypto.getRandomValues(new Uint32Array(1))[0], startedAt = retained?.base.startedAt ?? candidate?.startedAt ?? clock();
    const proof = retained?.proof ?? { deviceId, generation: game.computer.generation, modelId: game.computer.modelId, profile, profileVersion: COMPUTER_PROFILES[profile].version, seed, attemptId };
    const base = retained?.base ?? { proof, gameId: game.id, gameplayRevision: game.gameplayRevision, fingerprint: deterministicStateHash(game.board.state), startedAt, state: structuredClone(game.board.state) };
    const decisionIsCurrent = () => {
      const latest = current();
      return run === epoch && isOngoingGame(latest.game) && latest.visible && latest.authenticated && latest.key === context.key
        && sameOwnerScope(ownerScope(context), latest) && deterministicStateHash(latest.game.board.state) === base.fingerprint;
    };
    let saved = retained?.saved === true, attempt = retained?.attempt ?? null, evidenceWriteStarted = Boolean(retained);
    const retainCompletedDecision = () => {
      decisionRetry = { scope: ownerScope(context), key: context.key, failures: retry?.failures ?? 0, at: clock(),
        decision: { attemptId, proof, base, attempt, saved } };
      publish({ phase: 'idle', message: null }, context);
    };
    publish({ phase: attempt ? 'saving' : 'preparing', startedAt, profile, attemptId, progress: null, message: null });
    try {
      if (!attempt) {
        const response = candidate ? await candidate.promise : await runtime.compute({ gameId: game.id, gameplayRevision: game.gameplayRevision, state: game.board.state, modelId: game.computer.modelId, profile, seed, controlGeneration: game.computer.generation }, progress => { if (run === epoch && sameOwnerScope(ownerScope(context), current())) { noteProgress(context, progress); publish({ phase: progress.phase, progress }, context, COMPUTER_PRESENTATION.progress); } });
        if(!response)throw candidate?.error??Error('speculation_discarded');
        // Retain the exact JSON payload the API stores, including omission of
        // undefined optional diagnostics, for an unambiguous recovery compare.
        attempt = JSON.parse(JSON.stringify({ ...base, completedAt: candidate?.completedAt??clock(), outcome: response.result.status, result: response.result, cacheAvailable: runtime.cacheAvailable, evidenceSource: 'client-reported' }));
      }
      if (!decisionIsCurrent()) { decisionRetry = null; return; }
      // Proof persistence is part of saving; a slow evidence write deserves the
      // same delayed feedback as a slow gameplay command.
      publish({ phase: 'saving', progress: null }, context);
      // Cold preparation can delay interval ticks. Start the same guarded
      // renewal before persisting evidence, then await its receipt below.
      void renewWhenDue(context);
      if (retained && !saved) {
        const existing = await context.transport.decisionAttempt(game.id, { operation: 'read', kind: 'computer', attemptId });
        if (existing?.attempt) {
          if (canonicalCommandJson(existing.attempt) !== canonicalCommandJson(attempt)) throw Object.assign(new Error('attempt_id_conflict'), { code: 'attempt_id_conflict' });
          saved = true;
        }
      }
      if (!decisionIsCurrent()) { decisionRetry = null; return; }
      if (!saved) {
        evidenceWriteStarted = true;
        await context.transport.decisionAttempt(game.id, { operation: 'write', kind: 'computer', attemptId, attempt }); saved = true;
      }
      if (!decisionIsCurrent()) { decisionRetry = null; return; }
      if (attempt.result.status !== 'ready') throw new Error(attempt.result.reason);
      // A routine renewal keeps the same control generation. Preserve completed
      // calculation while its durable receipt settles instead of calculating again.
      if (work.leaseWork && work.leaseWorkAction === 'renew') {
        await work.leaseWork;
        if (!decisionIsCurrent()) { decisionRetry = null; return; }
      }
      // A temporary admission fence does not invalidate a completed decision.
      // The key/hash checks above and on every later tick still retire evidence
      // after actual position, control, account, or viewing-scope changes.
      if (context.transport.getGameViewModel(game.id)?.sharedMutationsBlocked) {
        retainCompletedDecision();
        return;
      }
      // Evidence does not extend control authority. An expired lease leaves
      // this attempt unsubmitted; the normal tick must acquire fresh control
      // and calculate a new proof. Never replay an admitted gameplay command.
      if (!ownLease(current().game)) {
        decisionRetry = null;
        publish({ phase: 'idle', message: null }, context);
        return;
      }
      publish({ phase: 'saving', progress: null }, context);
      const handle = await context.transport.applyGameAction({ gameId: game.id, state: game.board.state, action: attempt.result.action, computer: proof });
      if (!handle?.committed) throw Object.assign(new Error(handle?.validation?.code ?? 'move-not-submitted'), { code: handle?.validation?.code ?? 'move-not-submitted' });
      pendingSubmission = handle.committed; pendingSubmissionScope = ownerScope(context);
      decisionRetry = null;
      const expected=handle.state,nextProfile=expected&&computerProfileFor(game.computer,expected.sideToMove,expected.turnIndex);
      if(expected?.outcome?.status==='ongoing'&&nextProfile&&!game.computer.paused&&!game.computer.manual&&current().visible&&sameOwnerScope(ownerScope(context),current())){
        const nextSeed=crypto.getRandomValues(new Uint32Array(1))[0],nextAttemptId=crypto.randomUUID();
        const nextProof={deviceId,generation:game.computer.generation,modelId:game.computer.modelId,profile:nextProfile,profileVersion:COMPUTER_PROFILES[nextProfile].version,seed:nextSeed,attemptId:nextAttemptId};
        speculation.start({scope:`${context.accountGeneration}:${game.id}`,gameId:game.id,revision:game.gameplayRevision+1,generation:game.computer.generation,modelId:game.computer.modelId,state:expected,proof:nextProof,startedAt:clock(),
          request:{gameId:game.id,gameplayRevision:game.gameplayRevision+1,state:expected,modelId:game.computer.modelId,profile:nextProfile,seed:nextSeed,controlGeneration:game.computer.generation}});
      }
      await pendingSubmission;
      decisionRetry = null;
      publish({ phase: 'idle' }, context);
    } catch (error) {
      if(pendingSubmission){speculation.discard();runtime.cancel('parent-command-unconfirmed');}
      // A lost evidence-write response may already have stored a completed
      // attempt. Never replace it with a different unfinished payload.
      if (!evidenceWriteStarted && !isCompletedGame(current().game)) void context.transport.decisionAttempt(game.id, { operation: 'write', kind: 'computer', attemptId, attempt: { ...base, stoppedAt: clock(), outcome: 'unfinished', reason: error.message, progress: status.progress ?? null } }).catch(() => {});
      // The admission guard may win the final race after the projection check.
      // No command exists yet, so wait for recovery instead of latching a
      // computer failure. Once admitted, its durable outcome remains binding.
      if (!pendingSubmission && !decisionIsCurrent()) { decisionRetry = null; return; }
      if (!pendingSubmission) {
        if (saved && attempt?.result?.status === 'ready' && (error.code ?? error.message) === 'sync_recovering') {
          retainCompletedDecision();
          return;
        }
        const disposition = computerRetryDisposition(error);
        if (disposition !== 'terminal') {
          const failures = retry?.failures ?? 0;
          const delay = disposition === 'discard' ? 0 : Math.max(SYNC_TIMING.retryDelaysMs[Math.min(failures, SYNC_TIMING.retryDelaysMs.length - 1)], error.retryAfterMs ?? 0);
          decisionRetry = disposition === 'discard' ? null : { scope: ownerScope(context), key: context.key, failures: failures + 1, at: clock() + delay,
            decision: evidenceWriteStarted ? { attemptId, proof, base, attempt } : null };
          publish({ phase: 'idle', message: null }, context);
          return;
        }
      }
      if (run === epoch) { decisionRetry = null; recovery = context.key; publish({ phase: 'recovery', message: error.message }, context); }
    } finally { busy = false; pendingSubmission = null; pendingSubmissionScope = null; }
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
    if (isOngoingGame(context.game) && context.game.computer?.ownerId === context.transport.getIdentityId() && ownLease(context.game)) await fence('pause');
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
    const initial = current(), scoped = workFor(initial);
    if (scoped.resumeWork) return scoped.resumeWork;
    const allowed = context => recoveryScopeIsCurrent(initial) && context.visible && context.game?.id === initial.game?.id && context.game?.computer?.ownerId === context.transport.getIdentityId() && context.game.canControlComputer !== false && context.game.board.state.outcome?.status === 'ongoing';
    if (!allowed(initial)) return Promise.reject(Error('computer_owner_required'));
    if (!resumeSupported(initial.game)) return Promise.reject(Error('upgrade_required'));
    const work = Promise.resolve().then(() => withControlWork(async () => {
      if (!allowed(current())) return;
      cancelWork('resume-here');
      publish({phase:'resuming', message:null}, initial);
      const submission = sameOwnerScope(pendingSubmissionScope, initial) ? pendingSubmission : null;
      try {
        await initial.transport.reconcileGame(initial.game.id);
        if (submission) await submission.catch(() => {});
        if (scoped.leaseWork) await scoped.leaseWork;
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
    }, initial)).finally(() => {
      if (scoped.resumeWork === work) { scoped.resumeWork = null; if (!destroyed) onChange(); }
    });
    scoped.resumeWork = work;
    onChange();
    return work;
  };
  const timer = timers.setInterval(() => { const context = current(); void tick().catch(error => publish({ phase: 'recovery', message: error.message }, context)); }, 1000);
  return {
    tick, analyze, cancelAnalysis,
    withMutation: work => withControlWork(async () => {
      cancelWork('history-mutation');
      const original = current(), leaseWork = workFor(original).leaseWork;
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
      schedulePhaseLabel();
      const context = current();
      const scopedAnalysis = context.authenticated && analysis?.gameId === context.game?.id && analysisContext?.accountGeneration === context.accountGeneration && analysisContext?.transport === context.transport ? analysis : null;
      const scopedStatus = sameOwnerScope(statusScope, context) ? status : {phase:'idle'};
      const retrying = Boolean(decisionRetry && context.key === decisionRetry.key && sameOwnerScope(decisionRetry.scope, context));
      const retryVisible = retrying && context.visible && context.authenticated && !context.transport.getGameViewModel(context.game.id)?.inHistoryMode;
      const retryWaitMs = retryWait.update({ scope: context.key, active: retryVisible, blocked: retrying });
      return { ...scopedStatus, speculation:speculation.snapshot(), automaticRetry: retryVisible ? { waitMs: retryWaitMs, canRetry: !busy } : null, observedAt: clock(), elapsedMs: scopedStatus.startedAt !== undefined ? Math.max(0, clock() - scopedStatus.startedAt) : 0, phaseElapsedMs: scopedStatus.phaseStartedAt !== undefined ? Math.max(0, clock() - scopedStatus.phaseStartedAt) : 0, detailed: Boolean(scopedStatus.startedAt !== undefined && clock() - scopedStatus.startedAt >= COMPUTER_TIMING.detailAfterMs), analysis: scopedAnalysis, deviceId, activity: activity(context, scopedStatus) };
    },
    action: async action => { if(isCompletedGame(current().game))return; if (action === 'resume-here') return resumeHere(); if (action === 'switch') await withControlWork(async () => { cancelWork('switch'); const context = current(); await control(context, 'switch'); }); else await fence(action === 'retry' ? 'resume' : action); },
    suspend: () => { const previous = active; cancelWork('session-changed'); cancelAnalysis(); analysis = null; analysisContext = null; active = null; activityScope = null; waitingSince = null; recovery = null; decisionRetry = null; retryWait.reset(); status = { phase: 'idle' }; if (previous && ownLease(previous.game)) void control(previous, 'release').catch(() => {}); onChange(); },
    destroy: () => { destroyed = true; retryWait.reset(); timers.clearInterval(timer); cancelWork('destroyed'); cancelAnalysis(); active = null; },
  };
}
