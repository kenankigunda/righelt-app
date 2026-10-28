// Read-only correctness proof for the exact production worker and model asset.
// Run under resources:run with --corpus FILE --reference FILE --out FILE [--model-id PUBLISHED_ID].
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium, firefox, webkit } from '@playwright/test';
import { CURRENT_COMPUTER_MODEL, COMPUTER_MODELS } from '../apps/web/generated/packages/shared-types/src/computer-play.js';
import { selectBrowserParityModel } from './computer-browser-parity-options.mjs';
const model = selectBrowserParityModel(process.argv.slice(2), {current: CURRENT_COMPUTER_MODEL, models: COMPUTER_MODELS});
const option = name => process.argv[process.argv.indexOf(name) + 1];
for (const name of ['--corpus', '--reference', '--out']) if (!process.argv.includes(name)) throw Error(`Missing ${name}`);
const root = path.resolve(import.meta.dirname, '../apps/web');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const corpusBytes = await readFile(option('--corpus')), corpus = JSON.parse(corpusBytes);
const referenceBytes = await readFile(option('--reference')), reference = JSON.parse(referenceBytes);
const modelBytes = await readFile(path.join(root, model.url));
if (digest(modelBytes) !== model.sha256 || reference.modelSha256 !== model.sha256 ||
    reference.corpusSha256 !== digest(corpusBytes) || reference.states.length !== corpus.states.length || corpus.states.length < 1000) throw Error('Parity input provenance mismatch');
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Production worker parity</title>'); return; }
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep)) throw Error('Invalid path');
    response.setHeader('Content-Type', file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const report = { schema: 1, modelId: model.id, modelSha256: digest(modelBytes), corpusSha256: digest(corpusBytes),
  referenceSha256: digest(referenceBytes), referenceDevice: reference.referenceDevice, atol: 1e-5, rtol: 1e-4, states: corpus.states.length,
  workerManifestSha256: digest(await readFile(path.join(root, 'computer/runtime/manifest.json'))), browsers: [], passed: false, strengthClaim: false };
try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    if (process.argv.includes('--browser') && option('--browser') !== name) continue;
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.evaluate(async id => {
        const { ComputerRuntime } = await import('/shell/computer-runtime.js');
        window.parityRuntime = new ComputerRuntime(); await window.parityRuntime.prepare(id);
      }, model.id);
      const result = { name, version: browser.version(), checked: 0, policyMaxAbsoluteError: 0, valueMaxAbsoluteError: 0, legalMasksEqual: true };
      for (let offset = 0; offset < corpus.states.length; offset += 32) {
        const rows = corpus.states.slice(offset, offset + 32);
        const actual = await page.evaluate(async ({ rows, sha }) => {
          const { deterministicStateHash } = await import('/generated/packages/game-engine/src/hash.js');
          return (await window.parityRuntime.request({ type: 'evaluateBatch', states: rows.map(row => ({ id: row.id, state: row.state, fingerprint: deterministicStateHash(row.state) })),
            metadata: { gameId: 'numeric-parity', gameplayRevision: 0, fingerprint: 'batch', modelVersion: sha, profileVersion: 'parity', seed: 107 } })).results;
        }, { rows: rows.map(({ id, state }) => ({ id, state })), sha: model.sha256 });
        if (actual.length !== rows.length) throw Error(`Incomplete evaluation batch: ${name} ${offset}`);
        for (let i = 0; i < actual.length; i++) {
          const expected = reference.states[offset + i], row = actual[i];
          if (row.id !== expected.id || JSON.stringify([...row.legal].sort((a,b)=>a-b)) !== JSON.stringify([...expected.legal].sort((a,b)=>a-b))) throw Error(`Legal mask mismatch: ${row.id}`);
          for (const [key, values, targets] of [['policyMaxAbsoluteError', row.policyLogits, expected.policyLogits], ['valueMaxAbsoluteError', [row.value], [expected.value]]]) {
            if (values.length !== targets.length) throw Error(`Output shape mismatch: ${row.id}`);
            for (let n = 0; n < values.length; n++) {
              const error = Math.abs(values[n] - targets[n]); result[key] = Math.max(result[key], error);
              if (!Number.isFinite(values[n]) || error > report.atol + report.rtol * Math.abs(targets[n])) throw Error(`Numeric mismatch: ${name} ${row.id} ${key} ${n}`);
            }
          }
          result.checked++;
        }
      }
      await page.evaluate(() => window.parityRuntime.cancel('proof-complete'));
      report.browsers.push(result); console.log(JSON.stringify(result));
    } finally { await browser.close(); }
  }
  report.passed = report.browsers.length > 0;
} catch (error) { report.error = error.message; throw error; }
finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(option('--out')), { recursive: true });
  await writeFile(option('--out'), JSON.stringify(report, null, 2) + '\n');
  await new Promise(resolve => server.close(resolve));
}
