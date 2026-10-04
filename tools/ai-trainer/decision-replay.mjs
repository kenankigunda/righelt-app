import { deterministicStateHash } from '../../packages/game-engine/src/index.ts';
import { encodeAction, encodeState, legalActionMap, transition, verifyLegalSubset } from '../../packages/computer-player/src/index.ts';
import { validateDecisionProvenance } from './decision-provenance.mjs';

// The replay verifier independently applies authoritative rules. Search's cached
// next state is never accepted as proof, and partial masks never become targets.
export function replayDecision(state, record, bounded) {
  validateDecisionProvenance(record);
  if (deterministicStateHash(state) !== record.beforeHash) throw new Error('Replay before-state mismatch');
  if (state.sideToMove !== record.controller) throw new Error('Replay controller mismatch');
  if (record.encoded && JSON.stringify(Array.from(encodeState(state))) !== JSON.stringify(record.encoded)) throw new Error('Replay encoding mismatch');
  if (record.legality?.complete === false) {
    bounded(() => verifyLegalSubset(state, record.legal));
    if (!record.legal.includes(encodeAction(record.action))) throw new Error('Partial replay selected action missing');
  } else if (record.legal && JSON.stringify([...bounded(() => legalActionMap(state)).keys()]) !== JSON.stringify(record.legal)) {
    throw new Error('Replay legal mask mismatch');
  }
  const next = bounded(() => transition(state, record.action));
  if (deterministicStateHash(next) !== record.afterHash) throw new Error('Replay after-state mismatch');
  return next;
}
