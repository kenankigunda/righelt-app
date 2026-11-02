import { RulesRuntime } from './rules-runtime.js';

export const RUSH_GUIDANCE_TIMEOUT_MS = 2000;
export const rushActionKey = action => `${action.actorId}:${action.to?.row},${action.to?.col}`;

/** Dedicated worker ownership: guidance never queues ahead of gameplay work. */
export function createRushSupplyGuidanceClient({ executor = new RulesRuntime(), timeoutMs = RUSH_GUIDANCE_TIMEOUT_MS } = {}) {
  const cache = new Map();
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; executor.cancelAll(); };
  return {
    cancel,
    analyze(snapshot) {
      cancel();
      const key = JSON.stringify(snapshot);
      if (cache.has(key)) return Promise.resolve(cache.get(key));
      const pending = executor.rushGuidance('rush-guidance', snapshot);
      const jobTimer = setTimeout(() => executor.cancelAll(), timeoutMs);
      timer = jobTimer;
      return pending.then(result => {
        cache.set(key, result);
        if (cache.size > 8) cache.delete(cache.keys().next().value);
        return result;
      }).finally(() => { clearTimeout(jobTimer); if (timer === jobTimer) timer = null; });
    },
    destroy() { cancel(); cache.clear(); },
  };
}
