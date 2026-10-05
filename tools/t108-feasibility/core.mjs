import { scryptSync, timingSafeEqual } from 'node:crypto';

export const PARAMETERS = Object.freeze({ N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 });
export const FIXTURES = Object.freeze({
  ascii: 'synthetic-password-for-T108',
  unicode: 'synthetic-🦉-cafe\u0301-密碼',
  long: '🦉'.repeat(128),
});
export const SALT = '00112233445566778899aabbccddeeff'; // Public known-answer test salt only.
export function derive(fixture, salt = SALT, incorrect = false) {
  if (!Object.hasOwn(FIXTURES, fixture)) throw new Error('Unknown synthetic fixture');
  return scryptSync((FIXTURES[fixture].normalize('NFC') + (incorrect ? '-wrong' : '')), Buffer.from(salt, 'hex'), 32, PARAMETERS);
}
export function equal(actual, expected) {
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Admission lives in a different DO from synchronous hashing. Its event loop stays
// available to reject overload while the hasher is busy. Never spawn extra hashers.
export class Admission {
  #active = false;
  #waiting = [];
  constructor(run) { this.run = run; }
  async submit(input) {
    if (this.#active) {
      if (this.#waiting.length >= 4) return { rejected: true };
      await new Promise(resolve => this.#waiting.push(resolve));
    } else this.#active = true;
    try { return { rejected: false, value: await this.run(input) }; }
    finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#active = false;
    }
  }
}
export function percentile95(values) {
  if (!Array.isArray(values) || !values.length || Array.from(values).some(v => !Number.isFinite(v) || v < 0)) return null;
  return [...values].sort((a,b) => a-b)[Math.ceil(values.length * .95)-1];
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const elapsed = value => Number.isFinite(value) && value >= 0;
const successful = row => record(row) && row.status === 200 && row.correct === true && row.incorrectRejected === true && elapsed(row.elapsedMs);
const rows = (value, count) => Array.isArray(value) && value.length === count && Array.from(value).every(record);

export function evaluate(report, provider) {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  // Treat malformed JSON shapes as failing evidence rather than throwing or
  // allowing Array.every's skipped holes to stand in for measurements.
  const reportShape = record(report);
  report = reportShape ? report : {};
  provider = record(provider) ? provider : {};
  const start = typeof report.startedAt === 'string' ? Date.parse(report.startedAt) : NaN;
  const finish = typeof report.finishedAt === 'string' ? Date.parse(report.finishedAt) : NaN;
  check(reportShape && report.schemaVersion === 1 && nonempty(report.runId) && Number.isFinite(start) && Number.isFinite(finish) && finish >= start, 'Valid report schema, run identifier and interval required');
  check(report.runtime === 'deployed', 'Actual deployed runtime evidence missing');
  check(rows(report.vectors, 3) && report.vectors.every(successful) && Object.keys(FIXTURES).every(fixture => report.vectors.filter(row => row.fixture === fixture).length === 1), 'Exactly one successful ASCII, Unicode and long-password vector required');
  check(rows(report.sequential, 100) && report.sequential.every(row => row.fixture === 'ascii' && successful(row)), '100 sequential correct and incorrect-password checks required');
  const p95 = Array.isArray(report.sequential) ? percentile95(Array.from(report.sequential, row => record(row) ? row.elapsedMs : undefined)) : null;
  check(p95 !== null && p95 < 5000, 'Sequential end-to-end p95 must be below 5 seconds');
  check(rows(report.burst, 20) && report.burst.some(row => row.status === 200) && report.burst.some(row => row.status === 429) && report.burst.every(row => row.fixture === 'ascii' && elapsed(row.elapsedMs) && (row.status === 429 ? row.retryAfter === '1' : successful(row))), '20-request burst must validate successful hashes and predictably reject overload');
  check(nonempty(report.runId) && provider.runId === report.runId && nonempty(provider.source), 'Provider evidence must identify this run and its source');
  check(provider?.plan === 'free', 'Verified Free plan required');
  check(Number.isFinite(provider?.hashCpuP95Ms) && provider.hashCpuP95Ms >= 0 && provider.hashCpuP95Ms < 1000, 'Measured provider hash CPU p95 below 1 second required');
  check(Number.isFinite(provider?.memoryBytes) && provider.memoryBytes > 0 && provider.memoryBytes < 128 * 1024 * 1024 && ['peak','p999'].includes(provider?.memoryStatistic) && nonempty(provider.memorySource), 'Measured memory below 128 MiB with statistic/source required');
  check(nonempty(provider.cpuSource) && Number.isInteger(provider?.cpuSamples) && provider.cpuSamples >= 103, 'CPU source and at least 103 invocation samples required');
  check(provider?.startedAt === report.startedAt && provider?.finishedAt === report.finishedAt && Array.isArray(provider?.resourceNames) && ['righelt-t108-hash-engine','righelt-t108-hash-feasibility'].every(name => provider.resourceNames.includes(name)), 'Provider evidence must cover exact run interval and isolated resources');
  check(provider?.resourceLimitFailures === 0, 'Provider resource-limit failure count required');
  check(provider?.coldStartMeasured === true, 'Measured cold-start evidence required');
  check(Number.isFinite(provider?.requestsConsumed) && provider.requestsConsumed > 0 && Number.isFinite(provider?.durationGbSeconds) && provider.durationGbSeconds >= 0 && provider?.withinFreeAllowance === true, 'Measured free-tier consumption and allowance proof required');
  return { passed: failures.length === 0, failures, sequentialP95Ms: p95 };
}
