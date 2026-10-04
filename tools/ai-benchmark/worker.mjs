import * as ort from 'onnxruntime-web/wasm';
import { encodeState, legalActionMap, selectMove, experimentConfig } from '../../packages/computer-player/src/index.ts';
import { deterministicStateHash } from '../../packages/game-engine/src/index.ts';
let session, modelVersion, busy = false;
const identityNames = ['gameId', 'gameplayRevision', 'fingerprint', 'generation', 'modelVersion', 'profileVersion', 'seed'];
async function evaluate(encoded) {
  if (!session) throw new Error('Model is not initialized');
  const outputs = await session.run({ state: new ort.Tensor('float32', encoded,
    [1, experimentConfig.inputPlanes, experimentConfig.boardSize, experimentConfig.boardSize]) });
  const policyLogits = outputs.policy.data, value = outputs.value.data[0];
  if (policyLogits.length !== experimentConfig.actionCount || !Number.isFinite(value) || Math.abs(value) > 1 ||
      !Array.from(policyLogits).every(Number.isFinite)) throw new Error(`Invalid model output: ${JSON.stringify({ value: String(value), policyLength: policyLogits.length, policyShape: outputs.policy.dims, valueShape: outputs.value.dims, policyType: outputs.policy.type, valueType: outputs.value.type, firstNonFiniteLogit: Array.from(policyLogits).findIndex(value => !Number.isFinite(value)), encoded: Array.from(encoded) })}`);
  return { policyLogits, value };
}
self.onmessage = async ({ data }) => {
  const { id, type, generation, metadata } = data;
  const send = result => self.postMessage({ id, generation, ...(metadata ? { metadata } : {}), ...result });
  if (busy) { send({ type: 'error', message: 'Worker is already computing' }); return; }
  busy = true;
  try {
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(generation)) throw new Error('Invalid correlation identity');
    if (type === 'initialize') {
      if (session) throw new Error('Model already initialized for this worker');
      if (data.runtimeVersion !== ort.env.versions.web) throw new Error('Runtime version mismatch');
      const moduleUrl = URL.createObjectURL(new Blob([data.runtimeMjsBytes], { type: 'text/javascript' }));
      try {
        ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
        ort.env.wasm.wasmPaths = { mjs: moduleUrl };
        ort.env.wasm.wasmBinary = data.runtimeWasmBytes;
        send({ type: 'progress', phase: 'initializing-verified-runtime' });
        session = await ort.InferenceSession.create(data.bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      } finally { URL.revokeObjectURL(moduleUrl); }
      if (session.inputNames.join(',') !== 'state' || session.outputNames.join(',') !== 'policy,value') throw new Error('Incompatible model interface');
      modelVersion = data.modelVersion;
      send({ type: 'initialized', modelVersion, threads: 1, backend: 'wasm' }); return;
    }
    if (!session || !metadata || identityNames.some(name => metadata[name] === undefined) ||
        metadata.modelVersion !== modelVersion || metadata.generation !== generation) throw new Error('Invalid request identity');
    if (type === 'evaluateBatch') {
      if (!Array.isArray(data.states) || !data.states.length || data.states.length > 32) throw new Error('Invalid evaluation batch');
      const results = [];
      for (const item of data.states) {
        const fingerprint = deterministicStateHash(item.state);
        if (fingerprint !== item.fingerprint) throw new Error('State fingerprint mismatch');
        const result = await evaluate(encodeState(item.state));
        results.push({ id: item.id, fingerprint, policyLogits: Array.from(result.policyLogits), value: result.value,
          legal: [...legalActionMap(item.state).keys()] });
        send({ type: 'progress', phase: 'evaluating', completed: results.length, total: data.states.length });
      }
      send({ type: 'evaluated-batch', results }); return;
    }
    if (type !== 'compute' || !Number.isFinite(data.softMs) || data.softMs <= 0) throw new Error('Invalid worker request');
    if (metadata.fingerprint !== deterministicStateHash(data.state)) throw new Error('State fingerprint mismatch');
    const result = await selectMove({ state: data.state, seed: metadata.seed, simulations: data.profile?.simulations,
      temperature: data.profile?.temperature, maxValueGap: data.profile?.maxValueGap,
      maxNodes: experimentConfig.search.maxNodes, deadlineMs: performance.now() + data.softMs }, evaluate);
    const nextState = result.status === 'ready' ? result.nextState : null;
    send({ type: 'computed', result, nextState });
  } catch (error) { send({ type: 'error', message: error.message }); }
  finally { busy = false; }
};
