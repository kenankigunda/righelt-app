import test from 'node:test';
import assert from 'node:assert/strict';
import { experimentConfig } from '../../../packages/computer-player/src/index.ts';
import { jobBudgetMs } from '../worker-budget.mjs';

test('only the validation follow-up arena workload admits its frozen longer game bound', () => {
  const job = { command: 'arena', partition: 'validation', evaluationWorkload: 'followup-exploratory-8-v1', budgetMs: 1_800_000 };
  assert.equal(jobBudgetMs(job), 1_800_000);
  assert.throws(() => jobBudgetMs({ ...job, budgetMs: 1_800_001 }), /Invalid job bound/);
  for (const changed of [{ partition: 'final' }, { partition: 'train' }, { command: 'search' }, { evaluationWorkload: 'unregistered' }]) {
    assert.throws(() => jobBudgetMs({ ...job, ...changed }), /Invalid job bound/);
  }
});

test('worker budget retains the default and accepts explicit admitted training windows', () => {
  const maximum = Math.max(experimentConfig.resources.initialSeconds, experimentConfig.resources.overnightSeconds) * 1000;
  assert.equal(jobBudgetMs({ command: 'generate', partition: 'train' }), 600_000);
  assert.equal(jobBudgetMs({ command: 'generate', partition: 'train', budgetMs: 718463.3723970037 }), 718463.3723970037);
  assert.equal(jobBudgetMs({ command: 'generate', partition: 'train', budgetMs: maximum }), maximum);
  assert.throws(() => jobBudgetMs({ command: 'generate', partition: 'train', budgetMs: maximum + 1 }), /Invalid job bound/);
});

test('worker budget rejects malformed bounds and keeps other command limits', () => {
  for (const budgetMs of [null, false, true, 0, -1, '718000', NaN, Infinity, -Infinity]) {
    assert.throws(() => jobBudgetMs({ command: 'generate', partition: 'train', budgetMs }), /Invalid job bound/);
  }
  for (const command of ['search', 'replay', 'inventory', 'arena', 'prepare', 'fingerprint', 'generate-opening', 'validate-opening', 'exploration-record']) {
    assert.equal(jobBudgetMs({ command }), 600_000);
    assert.equal(jobBudgetMs({ command, budgetMs: 600_000 }), 600_000);
    assert.throws(() => jobBudgetMs({ command, budgetMs: 600_001 }), /Invalid job bound/);
  }
  for (const partition of [undefined, 'development', 'validation', 'final']) {
    assert.throws(() => jobBudgetMs({ command: 'generate', partition, budgetMs: 718000 }), /Invalid job bound/);
  }
});
