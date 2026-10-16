// Per synchronous operation, separate from model-guided search tree nodes.
import type { Action } from "./types";

// Retained replay evidence peaks at 9,879 expansions; 16,384 bounds allocation
// with headroom while the caller's deadline remains independently enforced.
export const MAX_ENGINE_OPERATION_EXPANSIONS = 16_384;

/** Optional synchronous resource accounting; authoritative unguarded rules are unchanged. */
export type EngineComputationGuard = (expansion: boolean) => void;
type Frame = { guard: EngineComputationGuard; parent?: Frame };
let current: Frame | undefined;

export type EngineComputationEvent =
  | { type: "expansion" | "successor" | "supply-start" | "supply-end" }
  | { type: "continuation-key" | "memo-hit"; key: string }
  | { type: "candidate"; action: Action }
  | { type: "candidate-result"; action: Action; status: "legal" | "illegal" | "unknown" };
export type EngineComputationObserver = (event: EngineComputationEvent) => void;
type ObserverFrame = { observer: EngineComputationObserver; parent?: ObserverFrame };
let currentObserver: ObserverFrame | undefined;

/** Observers are opt-in diagnostics, separate from rule/resource decisions. */
export function isEngineComputationObserved(): boolean { return currentObserver !== undefined; }
export function observeEngineComputation(event: EngineComputationEvent): void {
  for (let frame = currentObserver; frame; frame = frame.parent) frame.observer(event);
}

/** Never attach the process-local context across an inference await. */
export function withEngineComputationObserver<T>(observer: EngineComputationObserver, operation: () => T): T {
  const previous = currentObserver;
  currentObserver = { observer, parent: previous };
  try {
    const result = operation();
    if (result && typeof (result as { then?: unknown }).then === "function") {
      throw new TypeError("Engine computation observers require synchronous operations");
    }
    return result;
  } finally {
    currentObserver = previous;
  }
}

export function checkEngineComputation(expansion = false): void {
  for (let frame = current; frame; frame = frame.parent) frame.guard(expansion);
  if (expansion && currentObserver) observeEngineComputation({ type: "expansion" });
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
