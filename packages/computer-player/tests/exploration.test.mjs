import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { core } from './search-graph-helper.mjs';
import { trainingRecipe, validateTrainingRecipe, verifyTrainingRecipe, explorationSeed, dirichletNoise,
  explorationEvidence, applyRootExploration, recipeJson } from '../src/index.ts';
import { trainingExplorationOptions } from '../../../tools/ai-trainer/exploration-provenance.mjs';

const enabled = { purpose: 'self-play', recipe: trainingRecipe('root-dirichlet-v1') };
const disabled = { purpose: 'self-play', recipe: trainingRecipe() };
const clean = value => { const copy = structuredClone(value); delete copy.elapsedMs; delete copy.rootExploration; return copy; };

test('E-U01 recipe bindings are separately hashed and reject unknown, null, partial and altered values', async () => {
  const catalog = JSON.parse(readFileSync(new URL('../config/training-recipes-v1.json', import.meta.url)));
  for (const item of catalog.recipes) {
    assert.equal(createHash('sha256').update(recipeJson(item.definition)).digest('hex'), item.sha256);
    await verifyTrainingRecipe(trainingRecipe(item.id));
  }
  for (const bad of [null, {}, { id: undefined, sha256: disabled.recipe.sha256 },
    { id: 'missing', sha256: '0'.repeat(64) }, { ...enabled.recipe, sha256: disabled.recipe.sha256 }, { ...enabled.recipe, extra: true }]) {
    assert.throws(() => validateTrainingRecipe(bad), /recipe/i);
  }
  assert.throws(() => explorationEvidence({ ...enabled, noiseWeight: NaN }, 1), /request/i);
  assert.throws(() => explorationEvidence({ ...enabled, purpose: 'browser' }, 1), /request/i);
  assert.throws(() => explorationSeed(NaN, enabled.recipe), /seed/);
});

test('E-U01 bounded Dirichlet sampling stays finite and reproducible for tiny and maximum K', () => {
  for (const count of [2, 3, 20, 2801]) for (const seed of [0, 107, 0xffffffff]) {
    const first = dirichletNoise(count, seed);
    assert.deepEqual(first, dirichletNoise(count, seed));
    assert.ok(first.every(value => Number.isFinite(value) && value >= 0));
    assert.ok(Math.abs(first.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  }
  for (const count of [0, 1, 2802, Infinity, NaN, 2.5]) assert.throws(() => dirichletNoise(count, 107), /settings/);
  assert.throws(() => dirichletNoise(3, -1), /settings/);
  assert.throws(() => dirichletNoise(3, 1, disabled.recipe), /settings/);
  assert.notDeepEqual(dirichletNoise(20, 107), dirichletNoise(20, 108));
});

test('E-U01 sorted root noise preserves the eligible raw mass and records one reproducible draw', async () => {
  const actions = [{ index: 12, prior: .02 }, { index: 2, prior: .05 }, { index: 4, prior: .03 }];
  const evidence = explorationEvidence(enabled, 107);
  const priors = await applyRootExploration(evidence, actions, 63, true);
  assert.equal(evidence.applied, true);
  assert.deepEqual(evidence.eligibleIndices, [2, 4, 12]);
  assert.deepEqual(evidence.rawPriors, [.05, .03, .02]);
  assert.ok(Math.abs([...priors.values()].reduce((sum, value) => sum + value, 0) - .1) < 1e-14);
  assert.notDeepEqual(evidence.rawPriors, evidence.effectivePriors);
  const again = explorationEvidence(enabled, 107);
  await applyRootExploration(again, [...actions].reverse(), 63, true);
  assert.deepEqual(again, evidence);
  assert.notEqual(explorationSeed(107, enabled.recipe), 107);
  await assert.rejects(applyRootExploration(explorationEvidence(enabled, 107), [{ index: 1, prior: NaN }, { index: 2, prior: .1 }], 63, true), /priors/);
  await assert.rejects(applyRootExploration(explorationEvidence(enabled, 107), [{ index: 1, prior: .1 }, { index: 1, prior: .1 }], 63, true), /priors/);
});

test('E-U01 skip paths have no noise draw and leave raw inputs untouched', async () => {
  const two = [{ index: 1, prior: .1 }, { index: 2, prior: .1 }];
  for (const [actions, remaining, first, deadline, reason] of [
    [two, 20, false, undefined, 'first-visit-incomplete'], [two.slice(0, 1), 20, true, undefined, 'too-few-actions'],
    [two, 1, true, undefined, 'too-few-simulations'], [two, 20, true, 0, 'deadline'],
    [two.map(item => ({ ...item, prior: 0 })), 20, true, undefined, 'zero-mass']]) {
    const evidence = explorationEvidence(enabled, 7), before = structuredClone(actions);
    assert.equal((await applyRootExploration(evidence, actions, remaining, first, deadline)).size, 0);
    assert.equal(evidence.applied, false); assert.equal(evidence.skipReason, reason);
    assert.equal(evidence.noiseSha256, null); assert.deepEqual(evidence.eligibleIndices, []);
    assert.deepEqual(actions, before);
  }
});

function graphRun(graph, options = {}, preferences = {}) {
  core.configure(graph);
  const evaluated = [];
  return core.selectMove({ state: core.start(), seed: 7, simulations: 16, temperature: 1, maxValueGap: .1, ...options },
    async (_, context) => {
      evaluated.push(context.state.key);
      const policyLogits = new Float32Array(2801);
      for (const [index, value] of Object.entries(preferences)) policyLogits[index] = value;
      return { policyLogits, value: context.state.sideToMove === 'P1' ? .25 : -.25 };
    }).then(result => ({ result, evaluated, operations: [...core.operations] }));
}
const simple = { root: { actions: [{ index: 1, to: 'a' }, { index: 2, to: 'b' }, { index: 3, to: 'c' }] }, a: {}, b: {}, c: {} };

test('E-U02 disabled exploration preserves exact baseline output, rule order and evaluator calls', async () => {
  for (const controller of ['P1', 'P2']) {
    const graph = structuredClone(simple); for (const node of Object.values(graph)) node.controller = controller;
    const off = await graphRun(graph), explicit = await graphRun(graph, { rootExploration: disabled });
    assert.deepEqual(clean(explicit.result), clean(off.result));
    assert.deepEqual(explicit.evaluated, off.evaluated); assert.deepEqual(explicit.operations, off.operations);
    assert.equal(explicit.result.rootExploration.skipReason, 'disabled');
    assert.equal(off.result.rootExploration, undefined);
  }
});

test('E-U02 noise changes root visits after the raw first visit, without changing tactics or final-choice RNG', async () => {
  const base = await graphRun(simple), on = await graphRun(simple, { rootExploration: enabled });
  assert.equal(on.result.rootExploration.applied, true);
  assert.equal(base.evaluated[1], on.evaluated[1]);
  assert.deepEqual(on.result.actions.map(item => [item.index, item.prior, item.policyLogit, item.immediate, item.tactical]),
    base.result.actions.map(item => [item.index, item.prior, item.policyLogit, item.immediate, item.tactical]));
  assert.notDeepEqual(on.result.actions.map(item => item.visits), base.result.actions.map(item => item.visits));
  // All leaves have equal value. Recompute the single final temperature draw.
  const choices = on.result.actions.filter(item => item.visits > 0);
  let draw = core.seededRandom(7)() * choices.reduce((sum, item) => sum + item.visits, 0);
  const selected = choices.find(item => (draw -= item.visits) < 0) ?? choices.at(-1);
  assert.equal(on.result.actionIndex, selected.index);
  const repeat = await graphRun(simple, { rootExploration: enabled });
  assert.deepEqual(clean(repeat.result), clean(on.result));
});

test('E-U02 forced, fallback, partial legality and tiny-work paths preserve raw selection and bypass noise', async () => {
  const cases = [
    [{ root: { actions: [{ index: 1, to: 'won' }, { index: 2, to: 'a' }] }, won: { terminal: 1 }, a: {} }, {}, 'immediate-win'],
    [{ root: { actions: [{ index: 1, to: 'a' }, { index: 2, to: 'b' }] }, a: { actions: [{ index: 3, to: 'won' }] }, b: {}, won: { terminal: 1 } }, {}, 'forced-win'],
    [simple, { maxNodes: 1 }, 'model-fallback'],
    [{ ...simple, root: { actions: [{ index: 1, to: 'a', legalLimit: true }, { index: 2, to: 'b' }] } }, {}, 'model-fallback'],
    [simple, { simulations: 2 }, 'search'],
  ];
  for (const [graph, options, reason] of cases) {
    const off = await graphRun(graph, options, { 1: 4 }), on = await graphRun(graph, { ...options, rootExploration: enabled }, { 1: 4 });
    assert.equal(on.result.reason, reason); assert.equal(on.result.rootExploration.applied, false);
    assert.deepEqual(clean(on.result), clean(off.result));
    assert.deepEqual(on.evaluated, off.evaluated); assert.deepEqual(on.operations, off.operations);
  }
});

test('E-U02 deeper raw-prior ordering and repeated controllers survive root exploration', async () => {
  for (const controller of ['P1', 'P2']) {
    const graph = { ...structuredClone(simple), a: { actions: [{ index: 10, to: 'a1' }, { index: 11, to: 'a2' }] }, a1: {}, a2: {} };
    for (const node of Object.values(graph)) node.controller = controller;
    const options = { simulations: 32 };
    const off = await graphRun(graph, options, { 10: 3 }), on = await graphRun(graph, { ...options, rootExploration: enabled }, { 10: 3 });
    assert.equal(on.result.rootExploration.applied, true);
    assert.equal(on.evaluated[1], off.evaluated[1]);
    const deep = on.evaluated.filter(key => key === 'a1' || key === 'a2');
    assert.equal(deep[0], 'a1');
    assert.equal(on.result.value, controller === 'P1' ? .25 : -.25);
  }
});

test('E-U02 later limited branches retain the original noise draw without renormalization', async () => {
  const graph = { ...structuredClone(simple), b: { actions: [{ index: 10, to: 'blocked', limit: true }] }, blocked: {} };
  const { result, operations } = await graphRun(graph, { simulations: 32, rootExploration: enabled });
  assert.equal(result.rootExploration.applied, true);
  assert.deepEqual(result.rootExploration.eligibleIndices, [1, 2, 3]);
  assert.equal(operations.filter(key => key === 'transition:b:10').length, 1);
  const evidence = explorationEvidence(enabled, 7);
  await applyRootExploration(evidence, result.actions.map(item => ({ index: item.index, prior: item.prior })), 31, true);
  assert.deepEqual(evidence, result.rootExploration);
});

test('E-U02 tactical enumeration failure is excluded from noise without losing eligible prior mass', async () => {
  const graph = { ...structuredClone(simple), b: { legalLimit: true } };
  const { result, operations } = await graphRun(graph, { simulations: 32, rootExploration: enabled });
  assert.equal(result.rootExploration.applied, true);
  assert.deepEqual(result.rootExploration.eligibleIndices, [1, 3]);
  assert.deepEqual(result.rootExploration.rawPriors, [1 / 3, 1 / 3]);
  assert.ok(Math.abs(result.rootExploration.effectivePriors.reduce((sum, value) => sum + value, 0) - 2 / 3) < 1e-14);
  assert.equal(operations.filter(key => key === 'legal:b').length, 1);
  assert.equal(result.actions.find(item => item.index === 2).visits, 0);
  assert.equal(result.reason, 'search');
});


test('E-U02 worker whitelists exploration only for explicit training and development screen jobs', () => {
  for (const command of ['arena', 'search', 'prepare', 'replay']) {
    assert.deepEqual(trainingExplorationOptions({ command, profile: { rootExploration: enabled } }), {});
    assert.throws(() => trainingExplorationOptions({ command, rootExploration: enabled, partition: 'train' }), /restricted/);
  }
  assert.deepEqual(trainingExplorationOptions({ command: 'generate', partition: 'train', rootExploration: enabled }), { rootExploration: enabled });
  assert.deepEqual(trainingExplorationOptions({ command: 'search', partition: 'development', kind: 'exploration-screen',
    rootExploration: { ...enabled, purpose: 'development-screen' } }).rootExploration.recipe, enabled.recipe);
});
