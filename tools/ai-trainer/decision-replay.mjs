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
  if ((record.policyMask ?? true) && record.policy !== undefined) {
    if (!Array.isArray(record.policy) || !record.policy.length || new Set(record.policy.map(item => item.index)).size !== record.policy.length ||
        record.policy.some(item => !Number.isSafeInteger(item.index) || !record.legal?.includes(item.index) ||
          !Number.isFinite(item.probability) || item.probability < 0) ||
        Math.abs(record.policy.reduce((sum, item) => sum + item.probability, 0) - 1) > 1e-10) throw new Error('Replay policy target mismatch');
    if (record.search?.actions) {
      const visits = record.policy.map(item => record.search.actions.find(action => action.index === item.index)?.visits);
      const total = visits.reduce((sum, value) => sum + value, 0);
      if (visits.some(value => !Number.isSafeInteger(value) || value < 0) || total <= 0 ||
          record.policy.some((item, i) => Math.abs(item.probability - visits[i] / total) > 1e-10)) throw new Error('Replay policy visits mismatch');
    }
  }
  const next = bounded(() => transition(state, record.action));
  if (deterministicStateHash(next) !== record.afterHash) throw new Error('Replay after-state mismatch');
  return next;
}
