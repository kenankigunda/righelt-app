import { ComputerRuntime } from './computer-runtime.js';
import { COMPUTER_TIMING, CURRENT_COMPUTER_MODEL } from '../generated/packages/shared-types/src/computer-play.js';

// Preparation belongs to the entry surface, not to any game running behind it.
// Its worker is retired on dismissal. Gameplay owns a separate cancellable worker.
export function createComputerPreparation({ runtime = new ComputerRuntime(), onChange = () => {}, clock = () => Date.now(), timers = globalThis } = {}) {
  let owner = null, epoch = 0, flight = null, timer = null;
  let state = { state: 'idle', message: 'Preparing your opponent…' };
  const clearTimer = () => { if (timer !== null) timers.clearInterval(timer); timer = null; };
  const snapshot = (requestedOwner) => {
    if (owner !== requestedOwner) return { state: 'idle', message: 'Preparing your opponent…' };
    const elapsedMs = state.startedAt === undefined ? 0 : clock() - state.startedAt;
    const detailed = state.state === 'preparing' && elapsedMs >= COMPUTER_TIMING.detailAfterMs;
    const progress = state.progress;
    const phase = progress?.phase === 'initializing-verified-runtime' ? 'Getting ready to play' : 'Loading your opponent';
    const bytes = Number.isFinite(progress?.received) && Number.isFinite(progress?.total) && progress.total > 0
      ? ` · ${progress.received.toLocaleString()} of ${progress.total.toLocaleString()} bytes` : '';
    return { ...state, detailed, elapsedMs, message: detailed ? `${phase} · ${Math.floor(elapsedMs / 1000)}s${bytes}` : state.message };
  };
  const cancel = (requestedOwner = owner) => {
    if (requestedOwner !== owner || owner === null) return;
    epoch++; owner = null; flight = null; clearTimer(); runtime.cancel('preparation-dismissed');
    state = { state: 'idle', message: 'Preparing your opponent…' }; onChange();
  };
  const start = (requestedOwner, modelId = CURRENT_COMPUTER_MODEL.id) => {
    if (owner === requestedOwner && state.modelId === modelId && (flight || state.state === 'ready')) return flight ?? Promise.resolve(snapshot(owner));
    cancel(); owner = requestedOwner; const run = ++epoch;
    state = { state: 'preparing', modelId, startedAt: clock(), message: 'Preparing your opponent…', progress: null };
    timer = timers.setInterval(onChange, 1000); onChange();
    flight = (async () => {
      try {
        await runtime.prepare(modelId, progress => { if (run === epoch) { state.progress = progress; onChange(); } });
        if (run !== epoch) return { state: 'cancelled' };
        state = { ...state, state: 'ready', message: 'Ready to play' };
      } catch (error) {
        if (run !== epoch) return { state: 'cancelled' };
        state = { ...state, state: 'error', message: 'Could not prepare your opponent. Try again.', reason: error.message };
      } finally {
        if (run === epoch) { clearTimer(); flight = null; onChange(); }
      }
      return snapshot(requestedOwner);
    })();
    return flight;
  };
  return { start, cancel, snapshot, activeOwner: () => owner };
}
