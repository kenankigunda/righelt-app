import { deterministicStateHash } from '../../packages/game-engine/src/index.ts';
import { encodeAction, encodeState, SEARCH_POLICY_VERSION } from '../../packages/computer-player/src/index.ts';
import { decisionProvenance } from './decision-provenance.mjs';
import { replayDecision } from './decision-replay.mjs';

// A development decision is not a one-decision training game. It can neither
// acquire a terminal target nor enter the trainer's complete-game archive.
export function explorationRecord(job, bounded) {
  const result = job.result;
  if (job.partition !== 'development' || job.kind !== 'exploration-screen' ||
      typeof job.id !== 'string' || !job.id || result?.status !== 'ready' ||
      result.seed !== job.seed || !Number.isSafeInteger(job.seed) ||
      result.actionIndex !== encodeAction(result.action) ||
      result.rootExploration?.recipe.id !== job.recipe?.id ||
      result.rootExploration?.recipe.sha256 !== job.recipe?.sha256) {
    throw new Error('Invalid exploration decision identity');
  }
  const record = { id: job.id, controller: job.state.sideToMove, action: result.action, actionIndex: result.actionIndex,
    beforeHash: deterministicStateHash(job.state), afterHash: deterministicStateHash(result.nextState),
    encoded: Array.from(encodeState(job.state)), legal: result.legality.indices,
    ...decisionProvenance(result, SEARCH_POLICY_VERSION) };
  const next = replayDecision(job.state, record, bounded);
  if (deterministicStateHash(next) !== deterministicStateHash(result.nextState)) {
    throw new Error('Exploration transition differs from independent replay');
  }
  return { schema: 1, kind: 'exploration-decision-proof', partition: 'development',
    trainingData: false, state: job.state, record, nextState: next,
    replay: { passed: true, beforeHash: record.beforeHash, afterHash: record.afterHash } };
}
