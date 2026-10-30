import { equivalentGameStates } from '../generated/packages/game-engine/src/index.js';
import { projectOptimisticGame } from '../shell/optimistic-live.js';
import { buildPieceMoveResponse } from './client-move-generation.js';

const cancelled = () => Object.assign(new Error('rules_cancelled'), { code: 'rules_cancelled' });

/** One running job, with replaceable queued scopes. Termination stops blocked JS. */
export class RulesRuntime {
  asynchronous = true;
  constructor({ workerFactory = () => new Worker(new URL('./rules-worker.js', import.meta.url), { type: 'module' }) } = {}) {
    this.workerFactory = workerFactory;
    this.sequence = 0;
    this.jobs = new Map();
    this.running = null;
  }
  project(scope, input) { return this.request(scope, 'project', input); }
  equivalent(scope, input) { return this.request(scope, 'equivalent', input); }
  previews(scope, input) { return this.request(scope, 'previews', input); }
  request(scope, type, input) {
    const inputKey = type === 'previews' ? JSON.stringify(input) : null;
    const current = this.jobs.get(scope);
    if (type === 'previews' && current?.type === type && current.inputKey === inputKey) return current.promise;
    this.cancel(scope);
    let job;
    const promise = new Promise((resolve, reject) => {
      job = { id: ++this.sequence, scope, type, input, inputKey, resolve, reject };
    });
    job.promise = promise;
    this.jobs.set(scope, job);
    this.drain();
    return promise;
  }
  drain() {
    if (this.running || !this.jobs.size) return;
    const job = this.jobs.values().next().value;
    this.running = job;
    const finish = (error, result) => {
      if (this.running !== job) return;
      job.worker?.terminate();
      this.running = null;
      this.jobs.delete(job.scope);
      if (error) job.reject(error); else job.resolve(result);
      this.drain();
    };
    try {
      const worker = job.worker = this.workerFactory();
      worker.onmessage = ({ data }) => {
        if (data.id !== job.id || data.scope !== job.scope || data.type !== job.type) {
          finish(new Error('invalid_rules_response')); return;
        }
        finish(data.error ? Object.assign(new Error(data.error.message), { code: data.error.code }) : null, data.result);
      };
      worker.onerror = worker.onmessageerror = () => finish(new Error('rules_worker_failed'));
      worker.postMessage({ id: job.id, scope: job.scope, type: job.type, input: job.input });
    } catch (error) { finish(error); }
  }
  cancel(scope) {
    const job = this.jobs.get(scope);
    if (!job) return;
    this.jobs.delete(scope);
    if (this.running === job) { job.worker?.terminate(); this.running = null; }
    job.reject(cancelled());
    this.drain();
  }
  cancelAll() {
    // Clear before rejecting so cancellation cannot start another queued worker.
    const jobs = [...this.jobs.values()];
    this.jobs.clear();
    this.running?.worker?.terminate(); this.running = null;
    for (const job of jobs) job.reject(cancelled());
  }
}

export const createRulesExecutor = () => typeof Worker === 'function' ? new RulesRuntime() : {
  // Non-browser hosts use the same exact functions. Never fall back after a
  // browser worker failure, which would put the blocked work back on the UI.
  asynchronous: false,
  project: (_scope, input) => projectOptimisticGame(input),
  equivalent: (_scope, input) => equivalentGameStates(input.left, input.right),
  previews: (_scope, input) => buildPieceMoveResponse(input),
  cancel() {}, cancelAll() {},
};
