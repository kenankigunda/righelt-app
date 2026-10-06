import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { waitForAccountStartup } from '../../../e2e/auth/helpers.mjs';

test('startup wait cannot combine observations from connecting and retry renders into readiness', async () => {
  let phase = 'connecting', observedRetry;
  const retryObserved = new Promise(resolve => { observedRetry = resolve; });
  // Playwright's locator matcher protocol, with asynchronous reads that model
  // the real render transition found in CI. DOM evaluation is one observation.
  class Locator {
    constructor(kind) { this.kind = kind; }
    async _expect() { return { matches: true }; }
    filter() { return this; }
    async count() {
      if (this.kind === 'retry') { const count = phase === 'retry' ? 1 : 0; phase = 'retry'; return count; }
      return phase === 'connecting' ? 1 : 0;
    }
  }
  const page = {
    getByRole: role => new Locator(role),
    locator: () => new Locator('retry'),
    evaluate: async callback => {
      const current = phase;
      const document = {
        querySelector: selector => selector === '.shell-header' || current === 'retry' ? {} : null,
        querySelectorAll: () => current === 'connecting' ? [{ textContent: 'Connecting…' }] : [],
      };
      const value = vm.runInNewContext(`(${callback.toString()})()`, { document });
      if (current === 'retry') observedRetry('pending');
      if (current === 'connecting') phase = 'retry';
      return value;
    },
  };
  const waiting = waitForAccountStartup(page);
  try {
    assert.equal(await Promise.race([waiting.then(() => 'ready'), retryObserved]), 'pending');
  } finally { phase = 'ready'; await waiting; }
});
