import { readFileSync } from 'node:fs';
import {
  analyzeRushSupplyGuidance, boundedEngineOperation, listLegalActions,
  normalizeState, resolveToStability, withEngineComputationObserver,
} from '../apps/web/generated/packages/game-engine/src/index.js';

// Run with the resource supervisor. This is a bounded diagnostic, not a source
// of legality answers or a machine-dependent timing assertion.
const catalog = JSON.parse(readFileSync(new URL('../apps/web/scenarios/catalog.json', import.meta.url)));
const samples = catalog.scenarios.flatMap(scenario => ['initialState', 'resultingState']
  .filter(key => scenario[key]).map(key => ({ id: scenario.id, position: key, state: scenario[key] })));
for (const name of ['game-loading-rush', 'mobile-end-turn-rush']) samples.push({
  id: name, position: 'retained rules position',
  state: JSON.parse(readFileSync(new URL(`../packages/game-engine/test/fixtures/${name}.json`, import.meta.url))),
});
const results = [];
for (const sample of samples) {
  const state = normalizeState(sample.state);
  for (const operation of ['legal', 'stabilize', ...(state.continuation?.type === 'rush' ? ['guidance'] : [])]) {
    let expansions = 0, candidates = 0, successors = 0; const keys = new Set();
    const started = performance.now();
    const result = { id: sample.id, position: sample.position, operation };
    try {
      const value = withEngineComputationObserver(event => {
        if (event.type === 'expansion') expansions++;
        if (event.type === 'candidate') candidates++;
        if (event.type === 'successor') successors++;
        if (event.type === 'continuation-key') keys.add(event.key);
      }, () => boundedEngineOperation(() => operation === 'legal' ? listLegalActions(state)
        : operation === 'guidance' ? analyzeRushSupplyGuidance(state) : resolveToStability(structuredClone(state))));
      Object.assign(result, { status: 'complete', ...(operation === 'legal' ? { actions: value.length }
        : operation === 'guidance' ? { actions: value.actions.length } : {}) });
    } catch (error) {
      Object.assign(result, { status: error.code === 'rules_budget_exceeded' ? 'unknown' : 'error', code: error.code ?? error.message });
    }
    results.push({ ...result, expansions, candidates, successors, uniqueContinuationStates: keys.size, elapsedMs: performance.now() - started });
  }
}
console.log(JSON.stringify({ sampleCount: samples.length, operations: results.length,
  unknown: results.filter(result => result.status === 'unknown').length,
  errors: results.filter(result => result.status === 'error').length, results }, null, 2));
if (results.some(result => result.status === 'error')) process.exitCode = 1;
