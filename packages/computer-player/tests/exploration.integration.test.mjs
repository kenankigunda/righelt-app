import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingRecipe, selectMove, encodeState } from '../src/index.ts';
import { createInitialState, resolveToStability, deterministicStateHash } from '../../game-engine/src/index.ts';
import { decisionProvenance } from '../../../tools/ai-trainer/decision-provenance.mjs';
import { replayDecision } from '../../../tools/ai-trainer/decision-replay.mjs';
import { validateExplorationProvenance } from '../../../tools/ai-trainer/exploration-provenance.mjs';

const enabled = { purpose: 'self-play', recipe: trainingRecipe('root-dirichlet-v1') };
const uniform = async () => ({ policyLogits: new Float32Array(2801), value: .25 });

test('E-I01 real action, record and independent replay verify enabled provenance and reject corruption', async () => {
  const state = resolveToStability(createInitialState());
  const result = await selectMove({ state, seed: 7, simulations: 8, rootExploration: enabled }, uniform);
  assert.equal(result.status, 'ready'); assert.equal(result.rootExploration.applied, true);
  const record = { ...decisionProvenance(result, 'model-fallback-v2'), action: result.action, controller: state.sideToMove,
    beforeHash: deterministicStateHash(state), afterHash: deterministicStateHash(result.nextState), legal: result.legality.indices, encoded: Array.from(encodeState(state)) };
  assert.equal(deterministicStateHash(replayDecision(state, record, fn => fn())), record.afterHash);
  const mutations = [
    value => { value.seed++; }, value => { value.trainingRecipe = trainingRecipe(); },
    value => { value.trainingRecipe.sha256 = 'f'.repeat(64); }, value => { delete value.trainingRecipe; },
    value => { value.rootExploration.noiseSha256 = 'f'.repeat(64); },
    value => { value.rootExploration.effectivePriors[0] += .01; }, value => { value.rootExploration.eligibleIndices.reverse(); },
    value => { value.policy[0].probability += .1; }, value => { value.encoded[0] += 1; },
    value => { value.controller = 'P2'; }, value => { value.afterHash = 'altered'; },
  ];
  for (const mutate of mutations) { const value = structuredClone(record); mutate(value); assert.throws(() => replayDecision(state, value, fn => fn())); }
  const legacy = structuredClone(record); delete legacy.trainingRecipe; delete legacy.rootExploration;
  assert.equal(deterministicStateHash(replayDecision(state, legacy, fn => fn())), record.afterHash);
  assert.throws(() => validateExplorationProvenance({ ...record, trainingRecipe: null }), /recipe/);
});

