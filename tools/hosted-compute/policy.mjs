// Operational limits are independent of model/search configuration.
import policy from './policy.json' with { type: 'json' };
export const POLICY = Object.freeze(policy);
export const reserveCents = (cap) => Math.min(POLICY.shutdownReserveCents, Math.ceil(cap * POLICY.reserveBasisPoints / 10000));
export const TERMINAL = new Set(['complete', 'failed', 'cancelled', 'cleared']);
export const safeName = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(s);
export const safeRunPath = (s) => typeof s === 'string' && s.startsWith('.ai-runs/') && s.split('/').every(p => /^[a-zA-Z0-9_.-]+$/.test(p) && p !== '.' && p !== '..');
export const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
export const encode = (s) => new TextEncoder().encode(s);
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(v => canonical(v) ?? 'null').join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export class ContractError extends Error {}
export function assert(condition, message) { if (!condition) throw new ContractError(message); }
export function artifact(a) {
  assert(a && safeName(a.name) && /^[a-f0-9]{64}$/.test(a.sha256), 'invalid artifact identity');
  assert(Number.isSafeInteger(a.bytes) && a.bytes >= 0 && a.bytes <= POLICY.maxObjectBytes, 'invalid artifact size');
  return { name: a.name, sha256: a.sha256, bytes: a.bytes };
}
export function validateManifest(m) {
  assert(m?.schema === 1 && safeName(m.id) && m.id.length <= 40, 'invalid campaign identity');
  for (const key of ['sourceRevision', 'dependencySha256', 'checkpointSha256', 'corpusSha256', 'recipeSha256']) {
    assert(new RegExp(key === 'sourceRevision' ? '^[a-f0-9]{40}$' : '^[a-f0-9]{64}$').test(m[key]), `missing ${key}`);
  }
  assert(typeof m.authorizationReference === 'string' && m.authorizationReference.length >= 8, 'explicit spending authorization reference required');
  assert(Number.isSafeInteger(m.seed) && m.purpose === 'reliability-pilot', 'only the fixed-recipe reliability pilot is enabled');
  assert(Number.isSafeInteger(m.maxCents) && m.maxCents > 0 && m.maxCents <= POLICY.pilotCents, 'invalid pilot cap');
  assert(Number.isSafeInteger(m.deadline) && m.deadline > 0, 'absolute deadline required');
  assert(Array.isArray(m.inputs) && m.inputs.length && m.inputs.length <= POLICY.maxArtifacts, 'input inventory required');
  m.inputs.forEach(a => { artifact(a); assert(safeRunPath(a.path), 'input must have an explicit run-relative path'); });
  assert(new Set(m.inputs.map(a => a.path)).size === m.inputs.length, 'duplicate input path');
  assert(new Set(m.inputs.map(a => a.name)).size === m.inputs.length, 'duplicate input name');
  assert(m.inputs.some(a => a.sha256 === m.checkpointSha256) && m.inputs.some(a => a.sha256 === m.corpusSha256) && m.inputs.some(a => a.sha256 === m.recipeSha256), 'checkpoint, corpus and recipe must be in input inventory');
  assert(Array.isArray(m.phases) && m.phases.length > 0 && m.phases.length <= 12, 'bounded phases required');
  assert(new Set(m.phases.map(p => p.id)).size === m.phases.length, 'duplicate phase');
  for (const p of m.phases) {
    assert(safeName(p.id) && ['rehearsal', 'training', 'evaluation', 'export', 'benchmark'].includes(p.kind), 'invalid phase');
    assert(['cpu', 'cuda'].includes(p.device), 'hosted device must be explicit');
    assert(Number.isSafeInteger(p.seconds) && p.seconds > 0 && p.seconds <= 86400, 'invalid phase runtime');
    for (const argv of [p.argv, p.resumeArgv]) assert(Array.isArray(argv) && argv.length && argv.every(v => typeof v === 'string' && v.length < 4096 && !v.includes('\0')), 'explicit command and recovery argv required');
    assert(Array.isArray(p.outputs) && p.outputs.length && p.outputs.every(safeName), 'required phase evidence outputs missing');
    assert(safeRunPath(p.runDir), 'phase run directory required');
    for (const name of p.outputs) {
      assert(safeRunPath(p.outputPaths?.[name]) && p.outputPaths[name].startsWith(p.runDir + '/'), 'output path outside phase run');
      assert(p.expect?.[name] && Object.keys(p.expect[name]).length > 0, 'output acceptance predicates required');
    }
    const h = p.host;
    assert(h && ['hetzner', 'runpod'].includes(h.provider), 'unsupported provider');
    assert(typeof h.image === 'string' && /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(h.image), 'container image must be digest-pinned');
    assert(Number.isSafeInteger(h.hourlyCents) && h.hourlyCents > 0 && h.hourlyCents <= 500, 'all-in hourly quote required');
    assert(Number.isSafeInteger(h.quoteExpires) && Number.isSafeInteger(h.diskGb) && h.diskGb >= 80, 'fresh quote and disk required');
    if (h.provider === 'hetzner') assert(p.device === 'cpu' && /^ccx\d+$/.test(h.serverType) && /^[a-z0-9-]+$/.test(h.location), 'dedicated x86 Hetzner configuration required');
    else assert(p.device === 'cuda' && typeof h.gpu === 'string' && Number.isSafeInteger(h.minVcpu) && h.minVcpu >= 8 && Number.isSafeInteger(h.minRamGb) && h.minRamGb >= 48, 'CPU-rich Runpod configuration required');
  }
  return structuredClone(m);
}
