import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createInitialState, resolveToStability } from '../../../packages/game-engine/src/index.ts';
import { trainingRecipe } from '../../../packages/computer-player/src/index.ts';

async function run(job) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tools/ai-trainer/engine-worker.mjs'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let settled = false, evaluations = 0;
  const exited = new Promise(resolve => child.once('exit', code => { settled = true; resolve(code); }));
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 10000);
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  child.stdin.write(JSON.stringify(job) + '\n');
  const messages = [];
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const message = JSON.parse(line);
      if (message.type === 'evaluate') {
        evaluations++;
        child.stdin.write(JSON.stringify({ type: 'evaluation', id: message.id, policyLogits: Array(2801).fill(0), value: .25 }) + '\n');
      } else messages.push(message);
    }
    return { messages, code: await exited, stderr, evaluations };
  } finally {
    // A parsing/protocol failure must not abandon a still-running fixture child.
    if (!settled) child.kill('SIGKILL');
    await exited;
    clearTimeout(watchdog);
    child.stdin.destroy();
  }
}

test('E-U02 actual trainer worker ignores profile-injected exploration in normal evaluation', async () => {
  const job = { command: 'search', state: resolveToStability(createInitialState()), seed: 107, profile: { simulations: 3 }, budgetMs: 5000 };
  const baseline = await run(job);
  const injected = await run({ ...job, profile: { ...job.profile,
    rootExploration: { purpose: 'self-play', recipe: trainingRecipe('root-dirichlet-v1') } } });
  assert.equal(baseline.code, 0, baseline.stderr); assert.equal(injected.code, 0, injected.stderr);
  const clean = result => { delete result.elapsedMs; return result; };
  assert.deepEqual(clean(injected.messages[0].result), clean(baseline.messages[0].result));
  assert.equal(injected.messages[0].result.rootExploration, undefined);
});

test('E-I01 actual worker enables explicit development arm and rejects unsupported on requests before inference', async () => {
  const rootExploration = { purpose: 'development-screen', recipe: trainingRecipe('root-dirichlet-v1') };
  const job = { command: 'search', partition: 'development', kind: 'exploration-screen', rootExploration,
    state: resolveToStability(createInitialState()), seed: 107, profile: { simulations: 8 }, budgetMs: 5000 };
  const on = await run(job);
  assert.equal(on.code, 0, on.stderr); assert.equal(on.messages[0].result.rootExploration.applied, true);
  for (const change of [{ partition: 'validation' }, { command: 'arena' }, { kind: 'normal' }]) {
    const rejected = await run({ ...job, ...change });
    assert.equal(rejected.code, 1); assert.equal(rejected.messages.length, 1);
    assert.equal(rejected.evaluations, 0);
    assert.equal(rejected.messages[0].type, 'error'); assert.match(rejected.messages[0].message, /restricted/);
  }
});

test('E-I02 screen records an independently replayed development decision without producing a training game', async () => {
  const recipe = trainingRecipe('root-dirichlet-v1');
  const state = resolveToStability(createInitialState());
  const searched = await run({ command: 'search', partition: 'development', kind: 'exploration-screen',
    rootExploration: { purpose: 'development-screen', recipe }, state, seed: 108,
    profile: { simulations: 8, temperature: 1, maxValueGap: .1 }, budgetMs: 5000 });
  assert.equal(searched.code, 0, searched.stderr);
  const result = searched.messages[0].result;
  const job = { command: 'exploration-record', partition: 'development', kind: 'exploration-screen',
    id: 'fixed-screen-slot', state, result, seed: 108, recipe, budgetMs: 5000 };
  const recorded = await run(job);
  assert.equal(recorded.code, 0, recorded.stderr); assert.equal(recorded.evaluations, 0);
  const proof = recorded.messages[0].proof;
  assert.equal(recorded.messages[0].type, 'exploration-recorded');
  assert.equal(proof.trainingData, false); assert.equal(proof.partition, 'development');
  assert.equal(proof.record.policyMask, true); assert.equal(proof.replay.passed, true);
  assert.deepEqual(proof.nextState, result.nextState);
  assert.equal(proof.record.rootExploration.applied, true);
  assert.equal(proof.record.actionIndex, result.actionIndex);
  assert.equal(proof.record.id, 'fixed-screen-slot');
  for (const change of [{ partition: 'train' }, { seed: 109 }, { recipe: trainingRecipe() },
    { result: { ...result, nextState: { ...result.nextState, turnIndex: result.nextState.turnIndex + 1 } } }]) {
    const rejected = await run({ ...job, ...change });
    assert.equal(rejected.code, 1); assert.equal(rejected.evaluations, 0);
    assert.equal(rejected.messages[0].type, 'error');
  }
});

test('E-I03 training worker binds selected recipe to a terminal game and each decision', async () => {
  const { readFileSync } = await import('node:fs');
  const { catalogActions } = await import('../../../packages/computer-player/tests/catalog-helper.mjs');
  const { transition, terminalValue } = await import('../../../packages/computer-player/src/index.ts');
  const catalog = JSON.parse(readFileSync(new URL('../../../apps/web/scenarios/catalog.json', import.meta.url)));
  const scenario = catalog.scenarios.find(item => item.title === 'Commander surrounded loss of supply');
  let state = resolveToStability(structuredClone(scenario.initialState)), winning;
  for (const action of catalogActions(scenario)) {
    const next = transition(state, action);
    if (terminalValue(next) === (state.sideToMove === 'P1' ? 1 : -1)) { winning = state; break; }
    state = next;
  }
  assert.ok(winning);
  const binding = { path: '/fixture/six/recipe-adoption.json', sha256: 'a'.repeat(64) };
  for (const name of ['baseline-v1', 'root-dirichlet-v1']) {
    const recipe = trainingRecipe(name);
    const job = { command: 'generate', partition: 'train', kind: 'normal', id: 'new-game', familyId: 'fixture',
      seed: 107, modelVersion: 'fixture-model', initialState: winning, budgetMs: 5000,
      trainingRecipe: recipe, explorationAdoption: binding, rootExploration: { purpose: 'self-play', recipe } };
    const generated = await run(job);
    assert.equal(generated.code, 0, generated.stderr);
    const game = generated.messages.find(message => message.type === 'game')?.game;
    assert.ok(game, JSON.stringify(generated.messages));
    assert.equal(game.termination, 'terminal'); assert.equal(game.decisions.length, 1);
    assert.deepEqual(game.trainingRecipe, recipe); assert.deepEqual(game.explorationAdoption, binding);
    assert.deepEqual(game.decisions[0].trainingRecipe, recipe);
    assert.deepEqual(game.decisions[0].explorationAdoption, binding);
    const replayed = await run({ command: 'replay', game, budgetMs: 5000 });
    assert.equal(replayed.code, 0, replayed.stderr); assert.equal(replayed.messages[0].type, 'replayed');
    const rejected = await run({ ...job, command: 'arena' });
    assert.equal(rejected.code, 1); assert.equal(rejected.evaluations, 0);
  }
});
