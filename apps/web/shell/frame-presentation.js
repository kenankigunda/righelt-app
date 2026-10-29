export const COMPUTER_UI_FRAME_MEASURE = 'righelt-computer-ui-frame';

// Presentation consumes current state when the frame runs. Authority, progress
// accounting and watchdogs belong to the caller and must remain synchronous.
export function createFramePresentation({
  render,
  requestFrame = callback => globalThis.requestAnimationFrame(callback),
  cancelFrame = id => globalThis.cancelAnimationFrame(id),
  visible = () => !globalThis.document?.hidden,
  performanceImpl = globalThis.performance,
  measurementName = null,
}) {
  let frame = null, epoch = 0;
  const stats = { requests: 0, renders: 0, coalesced: 0, hidden: 0, lastDurationMs: 0, maxDurationMs: 0 };
  const now = () => performanceImpl?.now?.() ?? Date.now();
  const schedule = () => {
    stats.requests++;
    if (!visible()) { stats.hidden++; return; }
    if (frame !== null) { stats.coalesced++; return; }
    const token = ++epoch;
    frame = requestFrame(() => {
      if (token !== epoch) return;
      frame = null;
      if (!visible()) return;
      const started = now();
      try { render(); }
      finally {
        const ended = now();
        stats.renders++;
        stats.lastDurationMs = Math.max(0, ended - started);
        stats.maxDurationMs = Math.max(stats.maxDurationMs, stats.lastDurationMs);
        // Keep one local timing entry, without game/account data or network
        // telemetry. Timing support must never determine presentation success.
        if (measurementName) try {
          performanceImpl?.clearMeasures?.(measurementName);
          performanceImpl?.measure?.(measurementName, { start: started, end: ended, detail: { ...stats } });
        } catch { /* Timing is diagnostic only. */ }
      }
    });
  };
  const cancel = () => {
    epoch++;
    if (frame !== null) cancelFrame(frame);
    frame = null;
  };
  return { schedule, cancel, snapshot: () => ({ ...stats, pending: frame !== null }) };
}
