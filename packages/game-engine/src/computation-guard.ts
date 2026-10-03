// Per synchronous operation, separate from model-guided search tree nodes.
// Retained replay evidence peaks at 9,879 expansions; 16,384 bounds allocation
// with headroom while the caller's deadline remains independently enforced.
export const MAX_ENGINE_OPERATION_EXPANSIONS = 16_384;

/** Optional synchronous resource accounting; authoritative unguarded rules are unchanged. */
export type EngineComputationGuard = (expansion: boolean) => void;
type Frame = { guard: EngineComputationGuard; parent?: Frame };
let current: Frame | undefined;

export function checkEngineComputation(expansion = false): void {
  for (let frame = current; frame; frame = frame.parent) frame.guard(expansion);
}

/** Install only around a synchronous engine call, never across an inference await. */
export function withEngineComputationGuard<T>(guard: EngineComputationGuard, operation: () => T): T {
  const previous = current;
  current = { guard, parent: previous };
  try {
    checkEngineComputation();
    const result = operation();
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      throw new TypeError('Engine computation guards require synchronous operations');
    }
    checkEngineComputation();
    return result;
  } finally {
    current = previous;
  }
}
