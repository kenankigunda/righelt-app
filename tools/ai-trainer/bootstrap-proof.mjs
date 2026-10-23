// Fixed corpus and browser collectors for the supervised bootstrap worker.
// Numeric bounds and tactical near-tie rules match the existing benchmark proof.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareSearchParity } from '../ai-benchmark/search-proof.mjs';

const read = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value), { flag: 'wx' });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function verifyCurrentCorpus(corpus, engine) {
  const { deterministicStateHash, encodeState, legalActionMap } = engine ?? {
    ...await import('../../packages/game-engine/src/index.ts'),
    ...await import('../../packages/computer-player/src/index.ts'),
  };
  assert.equal(corpus.kind, 'export-validation'); assert.equal(corpus.states.length, 1000);
  const ids = new Set(), hashes = new Set();
  for (const row of corpus.states) {
    assert.ok(!ids.has(row.id) && !hashes.has(row.hash), 'Duplicate frozen state');
    ids.add(row.id); hashes.add(row.hash);
    assert.equal(row.partition, 'validation');
    const bucket = parseInt(sha(row.familyId).slice(0, 8), 16) % 100;
    assert.ok(bucket >= 80 && bucket < 90, 'Corpus family is not validation');
    assert.equal(deterministicStateHash(row.state), row.hash, `${row.id}: state hash changed`);
    assert.deepEqual(Array.from(encodeState(row.state)), row.encoded, `${row.id}: encoding changed`);
    assert.deepEqual([...legalActionMap(row.state).keys()], row.legal, `${row.id}: legal mask changed`);
  }
  return { passed: true, states: corpus.states.length };
}

export function compareNumeric(reference, actual) {
  assert.equal(reference.referenceDevice, 'mps');
  assert.equal(actual.modelVersion, reference.modelSha256);
  assert.equal(reference.states.length, 1000); assert.equal(actual.results.length, 1000);
  assert.equal(actual.threads, 1);
  let policyMaxAbs = 0, valueMaxAbs = 0;
  for (let i = 0; i < 1000; i++) {
    const expected = reference.states[i], observed = actual.results[i];
    assert.equal(observed.id, expected.id); assert.deepEqual(observed.legal, expected.legal);
    assert.equal(expected.policyLogits.length, 2801); assert.equal(observed.policyLogits.length, 2801);
    for (const [j, a] of [...expected.policyLogits, expected.value].entries()) {
      const b = j === 2801 ? observed.value : observed.policyLogits[j], delta = Math.abs(a-b);
      assert.ok(Number.isFinite(a) && Number.isFinite(b) && delta <= 1e-5 + 1e-4 * Math.abs(a),
        `${observed.id}: numeric parity outside bound`);
      if (j === 2801) valueMaxAbs = Math.max(valueMaxAbs, delta);
      else policyMaxAbs = Math.max(policyMaxAbs, delta);
    }
  }
  return { numericParityPassed: true, legalMasksIdentical: true, states: 1000,
    modelSha256: actual.modelVersion, corpusSha256: reference.corpusSha256,
    referenceDevice: 'mps', backend: 'wasm', threads: 1, policyMaxAbs, valueMaxAbs, actualPhone: false };
}

async function browser(attempt) {
  const { chromium } = await import('@playwright/test');
  const directory = path.join(attempt, 'benchmark');
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = path.resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(directory + path.sep)) throw Error('invalid asset path');
      response.setHeader('content-type', /\.(js|mjs)$/.test(file) ? 'text/javascript' : file.endsWith('.wasm') ?
        'application/wasm' : file.endsWith('.html') ? 'text/html' : 'application/json');
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#device').fill('Desktop Chromium bootstrap proof');
    await page.locator('#network').fill('Loopback; not phone acceptance');
    await page.evaluate(() => window.benchmark.prepare({ mode: 'cold' }));
    const raw = await page.evaluate(() => window.benchmark.rawParity({ count: 1000 }));
    await save(path.join(attempt, 'browser-raw.json'), raw);
    const numeric = compareNumeric(await read(path.join(attempt, 'native-raw.json')), raw);
    await save(path.join(attempt, 'browser-numeric.json'), { ...numeric, browserVersion: browser.version() });
    const reference = await read(path.join(attempt, 'native-search.json'));
    assert.equal(reference.complete, true); assert.equal(reference.states.length, 1000);
    const actual = await page.evaluate(({ states, profile }) => window.benchmark.searchParity({ rows: states, profile }), reference);
    await save(path.join(attempt, 'browser-search.json'), actual);
    const proof = compareSearchParity(reference, actual);
    assert.equal(proof.states, 1000); assert.equal(proof.tacticalOutcomesVerified, true);
    await save(path.join(attempt, 'browser-search-proof.json'), { ...proof, browserVersion: browser.version() });
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function main() {
  const [command, location, ...rest] = process.argv.slice(2);
  assert.ok(['corpus', 'browser'].includes(command) && location && !rest.length, 'Expected corpus|browser ATTEMPT');
  const attempt = path.resolve(location), plan = await read(path.join(attempt, 'plan.json'));
  assert.equal(plan.runtime.command, 'bootstrap-proof');
  assert.ok(attempt.startsWith(path.resolve(plan.runDirectory, 'bootstrap') + path.sep));
  if (command === 'browser') return browser(attempt);
  const bytes = await readFile(plan.identity.corpus.path);
  assert.equal(sha(bytes), plan.identity.corpus.sha256);
  const proof = await verifyCurrentCorpus(JSON.parse(bytes));
  await save(path.join(attempt, 'corpus-check.json'), { ...proof, corpusSha256: sha(bytes) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
