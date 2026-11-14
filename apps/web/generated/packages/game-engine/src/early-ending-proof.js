import { probeTerminalSettlement } from './terminal-settlement.js';
import { listLegalActions } from './legal.js';
import { applyAction } from './apply.js';
import { canCloseContinuationNow } from './continuation.js';
import { serializeState } from './serialize.js';
import { commanderOutcome } from '../../shared-types/src/commander-outcome.js';
import { boundedEngineOperation, checkEngineComputation, EngineComputationLimit, MAX_ENGINE_OPERATION_EXPANSIONS } from './computation-guard.js';
const unknown = (reason) => ({ kind: 'unknown', reason });
const prepend = (action, fact) => fact.kind === 'witness'
    ? { ...fact, witness: { ...fact.witness, actions: [structuredClone(action), ...fact.witness.actions.map(value => structuredClone(value))] } }
    : fact;
/** Inactive same-sequence proof only. No incoming Pass rule or authoritative write. */
export function proveRelevantContinuation(state, originalTurnOwner, options = {}) {
    if (originalTurnOwner !== 'P1' && originalTurnOwner !== 'P2')
        throw new TypeError('Invalid original turn owner');
    const cap = options.maxExpansions ?? MAX_ENGINE_OPERATION_EXPANSIONS;
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > MAX_ENGINE_OPERATION_EXPANSIONS)
        throw new TypeError('Invalid early-ending expansion budget');
    const counts = { visitedNodes: 0, cacheHits: 0 };
    if (state.outcome.status !== 'ongoing')
        return { ...counts, kind: 'unknown', reason: 'historical-completed' };
    if (!state.continuation)
        return { ...counts, kind: 'unknown', reason: 'outside-sequence' };
    const completed = new Map();
    const visiting = new Set();
    let candidateKey;
    // The source of survival is the real settled shared outcome, never a frozen
    // or display flag from the protected ongoing frame. Reason text is irrelevant.
    const alive = (settled) => {
        const key = commanderOutcome(settled.pieces).status;
        return key === 'ongoing' || key === (originalTurnOwner === 'P1' ? 'p1_win' : 'p2_win');
    };
    const ownership = (value) => !value.continuation || (value.continuation.type === 'rush'
        ? value.continuation.owner === originalTurnOwner && value.sideToMove === originalTurnOwner
        : value.continuation.attackerOwner === originalTurnOwner && value.continuation.owner === value.sideToMove
            && (value.continuation.phase === 'retreat' ? value.sideToMove !== originalTurnOwner : value.sideToMove === originalTurnOwner));
    const progress = (value) => {
        const continuation = value.continuation;
        const spent = new Set(continuation?.rushedPieceIds ?? []);
        return [continuation?.type === 'push' && continuation.phase === 'retreat' ? 1 : 0,
            value.pieces.filter(piece => piece.owner === originalTurnOwner && !piece.pushed
                && (continuation?.type === 'rush' ? !spent.has(piece.id) : !piece.shifted)).length];
    };
    const decreases = (before, after) => {
        const a = progress(before), b = progress(after);
        return b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]);
    };
    const settle = (value, root) => {
        // Only caller-supplied completed history was rejected above. A terminal
        // state actually produced on an internal legal edge is a trusted endpoint.
        if (value.outcome.status !== 'ongoing')
            return structuredClone(value);
        const result = probeTerminalSettlement(value, root ? options.push : undefined);
        return result.kind === 'settled' ? result.frame.occupancy : undefined;
    };
    function visit(value, mode, initialCandidateKillsOriginalOwner, root = false) {
        checkEngineComputation(true);
        counts.visitedNodes++;
        if (!ownership(value))
            return unknown('original-owner-linkage');
        const physical = settle(value, root);
        if (!physical)
            return unknown('unsupported-settlement-or-unlinked-push');
        const key = JSON.stringify([serializeState(value), originalTurnOwner, mode, originalTurnOwner, initialCandidateKillsOriginalOwner]);
        const cached = completed.get(key);
        if (cached) {
            counts.cacheHits++;
            return structuredClone(cached);
        }
        if (visiting.has(key))
            return unknown('path-cycle');
        visiting.add(key);
        try {
            if (value.outcome.status !== 'ongoing' || !value.continuation) {
                const changed = mode === 'required' && physical.outcome.status !== candidateKey;
                const rescued = mode === 'self-rescue' && initialCandidateKillsOriginalOwner && alive(physical);
                const fact = changed || rescued
                    ? { kind: 'witness', reason: changed ? 'outcome-change' : 'attacker-rescue',
                        witness: { actions: [], endpoint: structuredClone(physical), complete: true } }
                    : { kind: 'complete', endpoints: 1, optionalEndpoints: 0 };
                completed.set(key, structuredClone(fact));
                return fact;
            }
            // Always enumerate the complete current engine list, in its native order.
            const actions = listLegalActions(value);
            if (root)
                counts.rootLegalActions = actions.map(action => structuredClone(action));
            if (actions.length === 0)
                return unknown('empty-completion');
            const closable = canCloseContinuationNow(value) && value.sideToMove === originalTurnOwner;
            let endpoints = 0, optionalEndpoints = 0, incomplete;
            for (const action of actions) {
                const next = applyAction(value, action).state;
                if (next.continuation && next.outcome.status === 'ongoing' && !decreases(value, next)) {
                    incomplete ??= 'nondecreasing-progress';
                    continue;
                }
                const optional = mode === 'required' && closable && action.type !== 'end_turn';
                // Optional branches use a separate existential fact, scoped by the
                // INITIAL candidate's loss of original A. A required prefix can already
                // restore A physically; that must not redefine the root quantifier.
                // Follow every optional prefix through to a complete legal endpoint.
                const fact = visit(next, optional ? 'self-rescue' : mode, initialCandidateKillsOriginalOwner);
                if (fact.kind === 'witness')
                    return prepend(action, fact);
                if (fact.kind === 'unknown') {
                    incomplete ??= fact.reason;
                    continue;
                }
                if (optional)
                    optionalEndpoints += fact.endpoints + fact.optionalEndpoints;
                else {
                    endpoints += fact.endpoints;
                    optionalEndpoints += fact.optionalEndpoints;
                }
            }
            if (incomplete)
                return unknown(incomplete);
            if (endpoints === 0)
                return unknown('empty-completion');
            const fact = { kind: 'complete', endpoints, optionalEndpoints };
            completed.set(key, structuredClone(fact)); // Unknown/interrupted facts never enter this local cache.
            return fact;
        }
        finally {
            visiting.delete(key);
        }
    }
    try {
        return boundedEngineOperation(() => {
            checkEngineComputation(true);
            if (!ownership(state))
                return { ...counts, kind: 'unknown', reason: 'original-owner-linkage' };
            const candidate = settle(state, true);
            if (!candidate)
                return { ...counts, kind: 'unknown', reason: 'unsupported-settlement-or-unlinked-push' };
            if (candidate.outcome.status === 'ongoing')
                return { ...counts, kind: 'continue', reason: 'candidate-ongoing', candidate: structuredClone(candidate) };
            candidateKey = candidate.outcome.status;
            const initialCandidateKillsOriginalOwner = !alive(candidate);
            const fact = visit(structuredClone(state), 'required', initialCandidateKillsOriginalOwner, true);
            if (fact.kind === 'unknown')
                return { ...counts, kind: 'unknown', reason: fact.reason };
            if (fact.kind === 'witness')
                return { ...counts, kind: 'continue', reason: fact.reason, witness: structuredClone(fact.witness) };
            return { ...counts, kind: 'proven-terminal', candidateOutcome: structuredClone(candidate.outcome),
                endpointCount: fact.endpoints, optionalEndpointCount: fact.optionalEndpoints, complete: true };
        }, cap);
    }
    catch (error) {
        if (error instanceof EngineComputationLimit)
            return { ...counts, kind: 'unknown', reason: error.code };
        throw error;
    }
}
