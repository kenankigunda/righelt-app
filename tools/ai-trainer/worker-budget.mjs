import { readFileSync } from 'node:fs';
import { experimentConfig } from '../../packages/computer-player/src/index.ts';

const followupPolicy = JSON.parse(readFileSync(new URL('./followup-policy-v1.json', import.meta.url), 'utf8'));

const defaultBudgetMs = experimentConfig.training.generationSeconds * 1000;
// Protocol sanity ceiling only. The supervisor's remaining allocation and
// validation reserve, then the runner's anchored admission window, authorize
// the actual generation budget. The nominal round cadence cannot cap it.
const generationCeilingMs = Math.max(experimentConfig.resources.initialSeconds,
  experimentConfig.resources.overnightSeconds) * 1000;

export function jobBudgetMs(job) {
  const budgetMs = job.budgetMs === undefined ? defaultBudgetMs : job.budgetMs;
  const ceiling = job.command === 'generate' && job.partition === 'train'
    ? generationCeilingMs
    : job.command === 'arena' && job.partition === 'validation'
      && job.evaluationWorkload === followupPolicy.workload
      ? followupPolicy.gameSeconds * 1000 : defaultBudgetMs;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > ceiling) {
    throw new Error('Invalid job bound');
  }
  return budgetMs;
}
