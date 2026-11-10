// Run with node --import tsx. Reads a prepared export, never a database.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { productionCorpus, HELD_OUT_GAMES, digest } from '../ai-trainer/production-corpus.mjs';
import { assert } from './policy.mjs';

export function minimizeCorpus(verified, { salt, maxPerGameCategory = 20 } = {}) {
  assert(typeof salt === 'string' && salt.length >= 32, 'private curation salt required');
  const pseudonym = value => createHash('sha256').update(`${salt}:${value}`).digest('hex');
  const eligible = new Set(verified.reports.filter(r => r.partition === 'train' && r.currentStateVerified && r.verifiedDecisions > 0 && r.excluded.length === 0).map(r => r.gameId));
  const counts = new Map(), included = [], excluded = [];
  const positions = verified.positions.filter(p => {
    if (p.partition !== 'train') return true; // Preserve exclusion guards.
    if (!eligible.has(p.gameId)) return false;
    const key = `${p.gameId}:${p.category}`, n = counts.get(key) ?? 0;
    if (n >= maxPerGameCategory) return false;
    counts.set(key, n + 1); return true;
  }).map(p => Object.fromEntries(['revision', 'state', 'stateHash', 'partition', 'encodingHash', 'sharedOpening', 'category'].map(k => [k, p[k]]).concat([
    ['gameId', pseudonym(p.gameId)], ['decisionId', pseudonym(p.decisionId)],
  ])));
  for (const r of verified.reports) {
    const selected = positions.filter(p => p.gameId === pseudonym(r.gameId) && p.partition === 'train').length;
    (selected ? included : excluded).push({ sourceGameId: r.gameId, corpusGameId: pseudonym(r.gameId), selectedPositions: selected,
      reason: selected ? 'verified-training-only-starts' : r.partition !== 'train' ? 'held-out' : !eligible.has(r.gameId) ? 'replay-or-lineage-incomplete' : 'no-eligible-positions' });
  }
  assert(positions.some(p => p.partition === 'train'), 'no verified training positions remain');
  const corpus = { schema: 1, kind: 'production-starts-v1', heldOut: verified.heldOut.map(pseudonym), positions,
    reports: verified.reports.map(r => ({ gameId: pseudonym(r.gameId), partition: r.partition, currentStateVerified: r.currentStateVerified, verifiedDecisions: r.verifiedDecisions })),
    rawHistoricalPolicyTargets: false, curation: { maxPerGameCategory, sourceCorpusSha256: verified.sha256 } };
  return { corpus: { ...corpus, sha256: digest(corpus) }, inclusion: { included, excluded } };
}
export function curate(directory, heldOut) {
  assert(Array.isArray(heldOut) && heldOut.length && heldOut.every(x => typeof x === 'string'), 'declared held-out game list required');
  const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`));
  for (const name of ['games', 'decisions']) assert(createHash('sha256').update(readFileSync(`${directory}/${name}.json`)).digest('hex') === manifest.files[name]?.sha256, 'prepared export checksum mismatch');
  const verified = productionCorpus(JSON.parse(readFileSync(`${directory}/games.json`)), JSON.parse(readFileSync(`${directory}/decisions.json`)), { heldOut: [...new Set([...HELD_OUT_GAMES, ...heldOut])] });
  return minimizeCorpus(verified, { salt: randomBytes(32).toString('hex') });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, heldOutPath, corpusPath, inclusionPath] = process.argv.slice(2);
  assert(directory && heldOutPath && corpusPath && inclusionPath, 'Usage: curate.mjs PREPARED_EXPORT HELD_OUT_JSON CORPUS_OUT PRIVATE_INCLUSION_OUT');
  const result = curate(directory, JSON.parse(readFileSync(heldOutPath)));
  writeFileSync(corpusPath, JSON.stringify(result.corpus) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(inclusionPath, JSON.stringify(result.inclusion, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ includedGames: result.inclusion.included.length, positions: result.corpus.positions.length }) + '\n');
}
