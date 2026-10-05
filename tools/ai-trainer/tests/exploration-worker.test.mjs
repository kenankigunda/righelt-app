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
