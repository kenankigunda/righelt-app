import type { Action, GameState, Outcome } from './types';
import type { AcknowledgedPushFrame } from './terminal-push-frame';
import { probeTerminalSettlement, type TerminalSettlement } from './terminal-settlement';
import { DecisionRuleCache, withDecisionRuleCache } from './decision-cache';
import { listLegalActions, validateAction } from './legal';
import { applyAction } from './apply';
import { canCloseContinuationNow } from './continuation';
import { serializeState } from './serialize';
import { commanderOutcome } from '../../shared-types/src/commander-outcome.js';
import { boundedEngineOperation, checkEngineComputation, EngineComputationLimit, MAX_ENGINE_OPERATION_EXPANSIONS } from './computation-guard';

type Side = 'P1' | 'P2';
type Mode = 'required' | 'self-rescue';
type Witness = { actions: Action[]; endpoint: GameState; complete: true };
type Counts = { visitedNodes: number; cacheHits: number; settlementCalls: number; rootLegalActions?: Action[] };
export type EarlyEndingProof = Counts & (
  | { kind: 'unknown'; reason: string }
  | { kind: 'continue'; reason: 'candidate-ongoing'; candidate: GameState }
  | { kind: 'continue'; reason: 'outcome-change' | 'attacker-rescue'; witness: Witness }
  | { kind: 'proven-terminal'; candidateOutcome: Outcome; settlement: Extract<TerminalSettlement, { kind: 'settled' }>; endpointCount: number; optionalEndpointCount: number; complete: true }
);
type Fact =
  | { kind: 'unknown'; reason: string }
  | { kind: 'complete'; endpoints: number; optionalEndpoints: number }
  | { kind: 'witness'; reason: 'outcome-change' | 'attacker-rescue'; witness: Witness };
const unknown = (reason: string): Fact => ({ kind: 'unknown', reason });
const prepend = (action: Action, fact: Fact): Fact => fact.kind === 'witness'
  ? { ...fact, witness: { ...fact.witness, actions: [structuredClone(action), ...fact.witness.actions.map(value => structuredClone(value))] } }
  : fact;

/** Pure same-sequence proof. Only an authorized caller can commit its settlement. */
export function proveRelevantContinuation(
  state: GameState,
  originalTurnOwner: Side,
  options: { push?: AcknowledgedPushFrame; maxExpansions?: number; rootLegalActions?: boolean; cache?: boolean } = {},
): EarlyEndingProof {
  if (originalTurnOwner !== 'P1' && originalTurnOwner !== 'P2') throw new TypeError('Invalid original turn owner');
  const cap = options.maxExpansions ?? MAX_ENGINE_OPERATION_EXPANSIONS;
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > MAX_ENGINE_OPERATION_EXPANSIONS) throw new TypeError('Invalid early-ending expansion budget');
  const counts: Counts = { visitedNodes: 0, cacheHits: 0, settlementCalls: 0 };
  if (state.outcome.status !== 'ongoing') return { ...counts, kind: 'unknown', reason: 'historical-completed' };
  if (!state.continuation) return { ...counts, kind: 'unknown', reason: 'outside-sequence' };
  const completed = new Map<string, Exclude<Fact, { kind: 'unknown' }>>();
  const visiting = new Set<string>();
  let candidateKey: Outcome['status'];
  let rootSettlement: Extract<TerminalSettlement, { kind: 'settled' }>;

  // The source of survival is the real settled shared outcome, never a frozen
  // or display flag from the protected ongoing frame. Reason text is irrelevant.
  const alive = (settled: GameState) => {
    const key = commanderOutcome(settled.pieces).status;
    return key === 'ongoing' || key === (originalTurnOwner === 'P1' ? 'p1_win' : 'p2_win');
  };
  const ownership = (value: GameState) => !value.continuation || (value.continuation.type === 'rush'
    ? value.continuation.owner === originalTurnOwner && value.sideToMove === originalTurnOwner
    : value.continuation.attackerOwner === originalTurnOwner && value.continuation.owner === value.sideToMove
      && (value.continuation.phase === 'retreat' ? value.sideToMove !== originalTurnOwner : value.sideToMove === originalTurnOwner));
  const progress = (value: GameState): [number, number] => {
    const continuation = value.continuation;
    const spent = new Set(continuation?.rushedPieceIds ?? []);
    return [continuation?.type === 'push' && continuation.phase === 'retreat' ? 1 : 0,
      value.pieces.filter(piece => piece.owner === originalTurnOwner && !piece.pushed
        && (continuation?.type === 'rush' ? !spent.has(piece.id) : !piece.shifted)).length];
  };
  const decreases = (before: GameState, after: GameState) => {
    const a = progress(before), b = progress(after);
    return b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]);
  };
  const settle = (value: GameState, root: boolean): GameState | undefined => {
    // Only caller-supplied completed history was rejected above. A terminal
    // state actually produced on an internal legal edge is a trusted endpoint.
    if (value.outcome.status !== 'ongoing') return structuredClone(value);
    if (!root) counts.settlementCalls++;
    const result = root ? rootSettlement : probeTerminalSettlement(value);
    return result.kind === 'settled' ? result.frame.occupancy : undefined;
  };

  function visit(value: GameState, mode: Mode, initialCandidateKillsOriginalOwner: boolean, root = false): Fact {
    checkEngineComputation(true);
    counts.visitedNodes++;
    if (!ownership(value)) return unknown('original-owner-linkage');
    const key = JSON.stringify([serializeState(value), originalTurnOwner, mode, initialCandidateKillsOriginalOwner]);
    const cached = completed.get(key);
    if (cached) { counts.cacheHits++; return cached; }
    if (visiting.has(key)) return unknown('path-cycle');
    visiting.add(key);
    try {
      const physical = settle(value, root);
      if (!physical) return unknown('unsupported-settlement-or-unlinked-push');
      if (value.outcome.status !== 'ongoing' || !value.continuation) {
        const changed = mode === 'required' && physical.outcome.status !== candidateKey;
        const rescued = mode === 'self-rescue' && initialCandidateKillsOriginalOwner && alive(physical);
        const fact: Exclude<Fact, { kind: 'unknown' }> = changed || rescued
          ? { kind: 'witness', reason: changed ? 'outcome-change' : 'attacker-rescue',
            witness: { actions: [], endpoint: structuredClone(physical), complete: true } }
          : { kind: 'complete', endpoints: 1, optionalEndpoints: 0 };
        completed.set(key, fact);
        return fact;
      }
      const closable = value.sideToMove === originalTurnOwner && canCloseContinuationNow(value);
      // R4/R5: optional extensions matter only if the ORIGINAL attacker needs rescue.
      // Still execute the real close and compare its settled endpoint. Required
      // alternatives and root-losing/draw searches retain their native order.
      const directClose = !initialCandidateKillsOriginalOwner && closable
        && validateAction(value, { type: 'end_turn' }).ok;
      const actions = directClose ? [{ type: 'end_turn' as const }] : listLegalActions(value);
      if (root && options.rootLegalActions) counts.rootLegalActions = directClose
        ? listLegalActions(value) : actions.map(action => structuredClone(action));
      if (actions.length === 0) return unknown('empty-completion');
      let endpoints = 0, optionalEndpoints = 0, incomplete: string | undefined;
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
        const fact = visit(next, optional ? 'self-rescue' : mode,
          initialCandidateKillsOriginalOwner);
        if (fact.kind === 'witness') return prepend(action, fact);
        if (fact.kind === 'unknown') { incomplete ??= fact.reason; continue; }
        if (optional) optionalEndpoints += fact.endpoints + fact.optionalEndpoints;
        else { endpoints += fact.endpoints; optionalEndpoints += fact.optionalEndpoints; }
      }
      if (incomplete) return unknown(incomplete);
      if (endpoints === 0) return unknown('empty-completion');
      const fact: Exclude<Fact, { kind: 'unknown' }> = { kind: 'complete', endpoints, optionalEndpoints };
      completed.set(key, fact); // Unknown/interrupted facts never enter this local cache.
      return fact;
    } finally {
      visiting.delete(key);
    }
  }

  try {
    return withDecisionRuleCache(options.cache === false ? undefined : new DecisionRuleCache(), () => boundedEngineOperation((): EarlyEndingProof => {
      checkEngineComputation(true);
      if (!ownership(state)) return { ...counts, kind: 'unknown', reason: 'original-owner-linkage' };
      counts.settlementCalls++;
      const admission = probeTerminalSettlement(state, options.push);
      if (admission.kind !== 'settled') return { ...counts, kind: 'unknown', reason: 'unsupported-settlement-or-unlinked-push' };
      rootSettlement = admission;
      const candidate = rootSettlement.frame.occupancy;
      if (!candidate) return { ...counts, kind: 'unknown', reason: 'unsupported-settlement-or-unlinked-push' };
      if (candidate.outcome.status === 'ongoing') return { ...counts, kind: 'continue', reason: 'candidate-ongoing', candidate: structuredClone(candidate) };
      candidateKey = candidate.outcome.status;
      const initialCandidateKillsOriginalOwner = !alive(candidate);
      const fact = visit(structuredClone(state), 'required', initialCandidateKillsOriginalOwner, true);
      if (fact.kind === 'unknown') return { ...counts, kind: 'unknown', reason: fact.reason };
      if (fact.kind === 'witness') return { ...counts, kind: 'continue', reason: fact.reason, witness: structuredClone(fact.witness) };
      return { ...counts, kind: 'proven-terminal', candidateOutcome: structuredClone(candidate.outcome), settlement: rootSettlement,
        endpointCount: fact.endpoints, optionalEndpointCount: fact.optionalEndpoints, complete: true };
    }, cap));
  } catch (error) {
    if (error instanceof EngineComputationLimit) return { ...counts, kind: 'unknown', reason: error.code };
    throw error;
  }
}
