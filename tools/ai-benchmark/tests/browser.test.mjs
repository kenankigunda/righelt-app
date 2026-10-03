import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { compareSearchParity } from '../search-proof.mjs';

// Build with scripts/build-ai-benchmark.mjs before this integration suite.
const directory = process.env.AI_BENCHMARK_DIR;
const enabled = !!directory;
test('real browser WASM, cache, computation, parity and corrupt assets', { skip: !enabled, timeout: process.env.AI_BENCHMARK_SEARCH_REFERENCE ? 1_800_000 : 120_000 }, async () => {
  let corrupt = false;
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = path.resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(path.resolve(directory) + path.sep)) throw new Error('bad path');
      let bytes = await readFile(file);
      if (corrupt && pathname === '/model.onnx') bytes = Buffer.alloc(bytes.length);
      response.setHeader('content-type', file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.html') ? 'text/html' : 'application/json');
      response.end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const browser = await chromium.launch({ headless: true, channel: process.env.AI_BENCHMARK_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#device').fill('Desktop Chromium integration test');
    await page.locator('#network').fill('Loopback; not cellular acceptance');
    await page.evaluate(() => window.benchmark.prepare({ mode: 'cold' }));
    const parityCount = process.env.AI_BENCHMARK_REFERENCE ? 1000 : 3;
    const parity = await page.evaluate(count => window.benchmark.rawParity({ count }), parityCount);
    assert.equal(parity.results.length, parityCount); assert.equal(parity.threads, 1);
    assert.equal(parity.results[0].policyLogits.length, 2801);
    assert.ok(parity.results[0].legal.length > 0);
    if (process.env.AI_BENCHMARK_REFERENCE) {
      const reference = JSON.parse(await readFile(process.env.AI_BENCHMARK_REFERENCE, 'utf8'));
      assert.equal(parity.modelVersion, reference.modelSha256);
      let policyMaxAbs = 0, valueMaxAbs = 0;
      for (let i = 0; i < parityCount; i++) {
        const expected = reference.states[i], actual = parity.results[i];
        assert.equal(actual.id, expected.id); assert.deepEqual(actual.legal, expected.legal);
        const delta = Math.abs(actual.value - expected.value);
        valueMaxAbs = Math.max(valueMaxAbs, delta);
        assert.ok(delta <= 1e-5 + 1e-4 * Math.abs(expected.value), `${actual.id}: value mismatch`);
        for (let j = 0; j < 2801; j++) {
          const delta = Math.abs(actual.policyLogits[j] - expected.policyLogits[j]);
          policyMaxAbs = Math.max(policyMaxAbs, delta);
          assert.ok(delta <= 1e-5 + 1e-4 * Math.abs(expected.policyLogits[j]), `${actual.id}: policy ${j} mismatch`);
        }
      }
      const proof = { schema: 1, modelSha256: parity.modelVersion, corpusSha256: reference.corpusSha256,
        browserVersion: browser.version(), userAgent: parity.userAgent, referenceDevice: reference.referenceDevice,
        backend: 'wasm', threads: 1, states: parityCount, policyMaxAbs, valueMaxAbs,
        numericParityPassed: true, legalMasksIdentical: true, actualPhone: false, tacticalOutcomesVerified: false };
      if (process.env.AI_BENCHMARK_REPORT) await writeFile(process.env.AI_BENCHMARK_REPORT, JSON.stringify(proof, null, 2));
    }
    if (process.env.AI_BENCHMARK_SEARCH_REFERENCE) {
      const reference = JSON.parse(await readFile(process.env.AI_BENCHMARK_SEARCH_REFERENCE, 'utf8'));
      assert.equal(reference.complete, true);
      const actual = await page.evaluate(({ states, profile }) => window.benchmark.searchParity({ rows: states, profile }), reference);
      if (process.env.AI_BENCHMARK_SEARCH_REPORT) await writeFile(process.env.AI_BENCHMARK_SEARCH_REPORT + '.observed.json', JSON.stringify(actual));
      const searchProof = compareSearchParity(reference, actual);
      if (process.env.AI_BENCHMARK_SEARCH_REPORT) await writeFile(process.env.AI_BENCHMARK_SEARCH_REPORT, JSON.stringify({
        ...searchProof, browserVersion: browser.version(),
      }, null, 2));
    }
    const report = await page.evaluate(() => window.benchmark.measure({ profile: 'Babs', steps: 2, sequences: 1 }));
    assert.equal(report.measurements.filter(row => row.kind === 'step').length >= 3, true);
    assert.equal(report.measurements.filter(row => row.kind === 'sequence').length, 1);
    assert.ok(report.measurements.filter(row => row.kind === 'step').every(row => row.status === 'completed'));
    assert.equal(report.measurements.find(row => row.kind === 'sequence').reason, 'terminal-or-human-decision');
    assert.equal(report.productionApproved, false);
    await page.evaluate(() => window.benchmark.prepare({ mode: 'warm' }));
    const cached = await page.evaluate(() => window.benchmark.report.preparationAssets.slice(-4));
    assert.ok(cached.every(asset => asset.source === 'cache'));
    corrupt = true;
    const error = await page.evaluate(() => window.benchmark.prepare({ mode: 'cold' }).then(() => null, error => error.message));
    assert.match(error, /checksum/);
    assert.equal(await page.locator('#run').isDisabled(), true);
    // A blocked actual worker cannot process cancellation messages. Termination
    // must end it, and a replacement must remain usable on the same page.
    const termination = await page.evaluate(async () => {
      const client = window.benchmark.client;
      client.cancel('test');
      const url = URL.createObjectURL(new Blob(['self.onmessage=()=>{while(true){}}'], { type: 'text/javascript' }));
      client.url = url;
      const began = performance.now();
      const error = await client.request({ type: 'initialize' }, 30).then(() => '', e => e.message);
      URL.revokeObjectURL(url);
      return { error, elapsed: performance.now() - began, terminated: client.worker === null };
    });
    assert.match(termination.error, /watchdog/); assert.equal(termination.terminated, true);
    assert.ok(termination.elapsed < 2000);
    corrupt = false;
    await page.evaluate(() => window.benchmark.prepare({ mode: 'warm' }));
    const background = await page.evaluate(async () => {
      const client = window.benchmark.client;
      client.cancel('background test');
      const url = URL.createObjectURL(new Blob(['self.onmessage=()=>{while(true){}}'], { type: 'text/javascript' }));
      client.url = url;
      const pending = client.request({ type: 'initialize' }, 10_000).catch(error => error.message);
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden; URL.revokeObjectURL(url);
      return { reason: await pending, terminated: client.worker === null, interruptions: window.benchmark.report.interruptions.length };
    });
    assert.match(background.reason, /Backgrounded/); assert.equal(background.terminated, true);
    assert.ok(background.interruptions > 0);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
