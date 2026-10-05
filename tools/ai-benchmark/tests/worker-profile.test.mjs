import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('browser worker excludes exploration from adversarial profile and top-level request fields', async () => {
  const source = readFileSync(new URL('../worker.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  const requests = [], messages = [];
  const self = { postMessage: message => messages.push(message) };
  const ort = { env: { versions: { web: 'fixture' }, wasm: {} }, InferenceSession: {
    create: async () => ({ inputNames: ['state'], outputNames: ['policy', 'value'] }),
  } };
  runInNewContext(source, { self, ort, Blob, URL, performance, experimentConfig: { search: { maxNodes: 2048 } },
    deterministicStateHash: () => 'root', selectMove: async request => { requests.push(request); return { status: 'ready', nextState: {} }; } });
  await self.onmessage({ data: { id: 1, generation: 1, type: 'initialize', runtimeVersion: 'fixture', modelVersion: 'fixture', runtimeMjsBytes: '', runtimeWasmBytes: [] } });
  const rootExploration = { purpose: 'self-play', recipe: { id: 'root-dirichlet-v1', sha256: 'injected' } };
  const metadata = { gameId: 'game', gameplayRevision: 1, fingerprint: 'root', generation: 1,
    modelVersion: 'fixture', profileVersion: 'fixture', seed: 7 };
  await self.onmessage({ data: { id: 2, type: 'compute', generation: 1, metadata, state: {}, softMs: 1000,
    rootExploration, profile: { simulations: 8, temperature: .5, maxValueGap: .1, rootExploration } } });
  assert.equal(messages.at(-1).type, 'computed');
  assert.equal(requests.length, 1);
  assert.equal(Object.hasOwn(requests[0], 'rootExploration'), false);
  assert.equal(requests[0].simulations, 8);
  assert.equal(requests[0].temperature, .5);
  assert.equal(requests[0].maxValueGap, .1);
});
