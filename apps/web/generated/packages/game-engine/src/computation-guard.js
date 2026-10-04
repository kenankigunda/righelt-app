// Retained replay evidence peaks at 9,879 expansions; 16,384 bounds allocation
// with headroom while the caller's deadline remains independently enforced.
export const MAX_ENGINE_OPERATION_EXPANSIONS = 16_384;
let current;
let currentObserver;
/** Observers are opt-in diagnostics, separate from rule/resource decisions. */
export function isEngineComputationObserved() { return currentObserver !== undefined; }
export function observeEngineComputation(event) {
    for (let frame = currentObserver; frame; frame = frame.parent)
        frame.observer(event);
}
/** Never attach the process-local context across an inference await. */
export function withEngineComputationObserver(observer, operation) {
    const previous = currentObserver;
    currentObserver = { observer, parent: previous };
    try {
        const result = operation();
        if (result && typeof result.then === "function") {
            throw new TypeError("Engine computation observers require synchronous operations");
        }
        return result;
    }
    finally {
        currentObserver = previous;
    }
}
export function checkEngineComputation(expansion = false) {
    for (let frame = current; frame; frame = frame.parent)
        frame.guard(expansion);
    if (expansion && currentObserver)
        observeEngineComputation({ type: "expansion" });
}
/** Install only around a synchronous engine call, never across an inference await. */
export function withEngineComputationGuard(guard, operation) {
    const previous = current;
    current = { guard, parent: previous };
    try {
        checkEngineComputation();
        const result = operation();
        if (result && typeof result.then === 'function') {
            throw new TypeError('Engine computation guards require synchronous operations');
        }
        checkEngineComputation();
        return result;
    }
    finally {
        current = previous;
    }
}
