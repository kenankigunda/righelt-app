let current;
export function checkEngineComputation(expansion = false) {
    for (let frame = current; frame; frame = frame.parent)
        frame.guard(expansion);
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
