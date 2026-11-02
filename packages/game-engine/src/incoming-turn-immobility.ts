import type { Action, GameState, Outcome } from './types';
import { resolveToStability } from './resolve';
import { serializeState } from './serialize';
import { legalActionCandidates, validateAction } from './legal';
import { commanderOutcome } from '../../shared-types/src/commander-outcome.js';
import { boundedEngineOperation, checkEngineComputation, EngineComputationLimit,
  MAX_ENGINE_OPERATION_EXPANSIONS } from './computation-guard';

type Side = 'P1' | 'P2';
/** An assertion by the caller, not something a board snapshot can establish.
 * Historical replay, midturn UI state and hypothetical side swaps cannot supply it. */
export type IncomingLiveTurn = {
  kind: 'ordinary-incoming-live-turn';
  incomingSide: Side;
  turnIndex: number;
};
type Evidence = { examinedCandidates: number; inputCanonical?: string; settledCanonical?: string };
export type IncomingTurnImmobility = Evidence & (
  | { kind: 'not-applicable'; reason: 'incoming-context' | 'historical-completed' | 'continuation'
      | 'temporary-piece-flags' | 'terminal-displacement' }
  | { kind: 'not-applicable'; reason: 'commander-outcome'; commanderOutcome: Outcome }
  | { kind: 'unknown'; reason: 'rules_budget_exceeded' | 'settlement-changed'
      | 'unexpected-legal-control' | 'empty-legal-set' }
  | { kind: 'not-immobile'; witness: Action; exhaustive: false }
  | { kind: 'incoming-loss'; cause: 'incoming-turn-immobility'; incomingSide: Side;
      winner: Side; legalActions: Action[]; exhaustive: true }
);

/** Inactive R1 evidence only. Does not apply Pass, write an outcome or infer turn start.
 * All proof is on the actual incoming board; resolution is only an admission check. */
export function probeIncomingTurnImmobility(
  state: GameState,
  context: IncomingLiveTurn,
  options: { maxExpansions?: number } = {},
): IncomingTurnImmobility {
  const cap = options.maxExpansions ?? MAX_ENGINE_OPERATION_EXPANSIONS;
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > MAX_ENGINE_OPERATION_EXPANSIONS) {
    throw new TypeError('Invalid incoming-turn expansion budget');
  }
  const evidence: Evidence = { examinedCandidates: 0 };
  if (!context || context.kind !== 'ordinary-incoming-live-turn'
    || (context.incomingSide !== 'P1' && context.incomingSide !== 'P2')
    || context.incomingSide !== state.sideToMove || !Number.isSafeInteger(context.turnIndex)
    || context.turnIndex < 0 || context.turnIndex !== state.turnIndex) {
    return { ...evidence, kind: 'not-applicable', reason: 'incoming-context' };
  }
  if (state.outcome.status !== 'ongoing') return { ...evidence, kind: 'not-applicable', reason: 'historical-completed' };
  if (state.continuation) return { ...evidence, kind: 'not-applicable', reason: 'continuation' };
  if (state.pieces.some(piece => piece.pushed || piece.shifted)) {
    return { ...evidence, kind: 'not-applicable', reason: 'temporary-piece-flags' };
  }
  if (state.terminalDisplacement !== undefined) return { ...evidence, kind: 'not-applicable', reason: 'terminal-displacement' };

  try {
    return boundedEngineOperation((): IncomingTurnImmobility => {
      checkEngineComputation(true);
      evidence.inputCanonical = serializeState(state);
      // Retain the input's artifact mode: even artifact-only differences must
      // not silently change the canonical authoritative board being admitted.
      const candidate = resolveToStability(structuredClone(state), { artifactMode: state.artifacts?.mode });
      evidence.settledCanonical = serializeState(candidate);
      const physical = commanderOutcome(candidate.pieces);
      if (physical.status !== 'ongoing') {
        return { ...evidence, kind: 'not-applicable', reason: 'commander-outcome',
          commanderOutcome: structuredClone(physical) };
      }
      if (evidence.inputCanonical !== evidence.settledCanonical) {
        return { ...evidence, kind: 'unknown', reason: 'settlement-changed' };
      }

      let pass: Action | undefined;
      // Native complete lazy stream, not a filtered/model/UI list. A positive
      // piece witness may stop early; a negative fact requires exhaustion.
      for (const action of legalActionCandidates(candidate)) {
        checkEngineComputation(true);
        evidence.examinedCandidates++;
        if (!validateAction(candidate, action).ok) continue;
        if (action.type === 'pass') { pass = structuredClone(action); continue; }
        if (action.type === 'move' || action.type === 'project' || action.type === 'rush'
          || action.type === 'push' || action.type === 'retreat' || action.type === 'follow') {
          return { ...evidence, kind: 'not-immobile', witness: structuredClone(action), exhaustive: false };
        }
        return { ...evidence, kind: 'unknown', reason: 'unexpected-legal-control' };
      }
      checkEngineComputation();
      if (!pass) return { ...evidence, kind: 'unknown', reason: 'empty-legal-set' };
      return { ...evidence, kind: 'incoming-loss', cause: 'incoming-turn-immobility',
        incomingSide: context.incomingSide, winner: context.incomingSide === 'P1' ? 'P2' : 'P1',
        legalActions: [pass], exhaustive: true };
    }, cap);
  } catch (error) {
    if (error instanceof EngineComputationLimit) return { ...evidence, kind: 'unknown', reason: error.code };
    throw error;
  }
}
