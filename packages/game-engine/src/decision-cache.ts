import { checkEngineComputation } from './computation-guard';
import type { GameState } from './types';

export const DECISION_CACHE_LIMITS = { maxEntries: 512, maxEstimatedBytes: 4 * 1024 * 1024 } as const;
export type DecisionCacheStats = { hits: number; misses: number; stores: number; evictions: number; oversized: number;
  entries: number; estimatedBytes: number; peakEstimatedBytes: number };

/** Experimental completed-rule cache. Own one per decision; never across games or turns. */
export class DecisionRuleCache {
  private entries = new Map<string, { value: boolean; bytes: number }>();
  readonly stats: DecisionCacheStats = { hits: 0, misses: 0, stores: 0, evictions: 0, oversized: 0,
    entries: 0, estimatedBytes: 0, peakEstimatedBytes: 0 };
  constructor(readonly limits: { maxEntries: number; maxEstimatedBytes: number } = DECISION_CACHE_LIMITS) {
    if (![limits.maxEntries, limits.maxEstimatedBytes].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid decision cache limits');
  }
  read(key: string): boolean | undefined {
    const found = this.entries.get(key);
    if (!found) { this.stats.misses++; return undefined; }
    this.stats.hits++;
    this.entries.delete(key); this.entries.set(key, found);
    return found.value;
  }
  store(key: string, value: boolean): void {
    // UTF-16 key storage plus a conservative fixed entry allowance, not a claim
    // to measure VM heap bytes. The independent entry bound also limits overhead.
    const bytes = key.length * 2 + 128;
    if (bytes > this.limits.maxEstimatedBytes) { this.stats.oversized++; return; }
    const previous = this.entries.get(key);
    if (previous) { this.entries.delete(key); this.stats.estimatedBytes -= previous.bytes; }
    while (this.entries.size >= this.limits.maxEntries || this.stats.estimatedBytes + bytes > this.limits.maxEstimatedBytes) {
      const first = this.entries.keys().next().value!;
      this.stats.estimatedBytes -= this.entries.get(first)!.bytes;
      this.entries.delete(first); this.stats.evictions++;
    }
    this.entries.set(key, { value, bytes }); this.stats.stores++;
    this.stats.entries = this.entries.size; this.stats.estimatedBytes += bytes;
    this.stats.peakEstimatedBytes = Math.max(this.stats.peakEstimatedBytes, this.stats.estimatedBytes);
  }
}
let current: DecisionRuleCache | undefined;

/** Install only around synchronous rules; never leave a global context across inference awaits. */
export function withDecisionRuleCache<T>(cache: DecisionRuleCache | undefined, operation: () => T): T {
  const previous = current; current = cache;
  try {
    const result = operation();
    if (result && typeof (result as { then?: unknown }).then === 'function') throw new TypeError('Decision cache scopes require synchronous operations');
    return result;
  } finally { current = previous; }
}

export function completedDecisionRule(rule: string, state: GameState, operation: () => boolean): boolean {
  const cache = current;
  if (!cache) return operation();
  checkEngineComputation();
  // Preserve all rule inputs, including frozen supply/command, flags, identities,
  // array ordering, controllers and counters. Only derived UI artifacts are omitted.
  const key = rule + ':' + JSON.stringify({ ...state, artifacts: undefined });
  const stored = cache.read(key);
  if (stored !== undefined) return stored;
  const result = operation();
  checkEngineComputation();
  cache.store(key, result); // Exceptions/interruptions never become negative answers.
  return result;
}
