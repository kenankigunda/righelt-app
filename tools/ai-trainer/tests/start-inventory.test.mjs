import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { createInitialState, deterministicStateHash } from '../../../packages/game-engine/src/index.ts';
import { transition, encodeState, legalActionMap, encodeAction } from '../../../packages/computer-player/src/index.ts';

function sourceGame() {
  const initialState = createInitialState(); let state = initialState;
  const decisions = [];
  for (let i = 0; i < 4; i++) {
    const action = { type: 'pass' }, next = transition(state, action);
    decisions.push({ id: `inventory:${i}`, action, controller: state.sideToMove,
      beforeHash: deterministicStateHash(state), afterHash: deterministicStateHash(next),
      encoded: Array.from(encodeState(state)), legal: [...legalActionMap(state).keys()],
      policy: [{ index: encodeAction(action), probability: 1 }], policyMask: true, fallback: null });
    state = next;
  }
  return { id: 'inventory', partition: 'train', initialState, decisions,
    finalHash: deterministicStateHash(state), outcome: state.outcome,
    termination: 'truncated', truncationReason: 'repetition' };
}
function run(game, indices) {
  return new Promise(resolve => {
    const process = execFile('node', ['--import', 'tsx', 'tools/ai-trainer/engine-worker.mjs'],
      { timeout: 10000 }, (error, stdout) => resolve({ error, output: JSON.parse(stdout.trim()) }));
    process.stdin.end(JSON.stringify({ command: 'inventory', game, indices, budgetMs: 8000 }) + '\n');
  });
}
test('inventory independently replays exact requested states without model evaluation', async () => {
  const game = sourceGame(), { error, output } = await run(game, [0, 2]);
  assert.equal(error, null); assert.equal(output.type, 'inventoried');
  assert.deepEqual(output.states.map(s => s.index), [0, 2]);
  for (const s of output.states) assert.equal(deterministicStateHash(s.state), game.decisions[s.index].beforeHash);
  assert.equal(output.hash, game.finalHash);
});
test('inventory rejects altered replay and final partition without returning snapshots', async () => {
  const game = sourceGame(); game.decisions[2].afterHash = 'altered';
  let result = await run(game, [0]);
  assert.ok(result.error); assert.equal(result.output.type, 'error'); assert.equal(result.output.states, undefined);
  result = await run({ ...sourceGame(), partition: 'final' }, [0]);
  assert.ok(result.error); assert.match(result.output.message, /Invalid training inventory/);
});
