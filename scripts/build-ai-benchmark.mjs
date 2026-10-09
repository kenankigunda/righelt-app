import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--out', '--model', '--corpus'].includes(args[i]) || !args[i+1]) throw new Error('Usage: --out DIR --model FILE --corpus FILE');
  options[args[i].slice(2)] = path.resolve(args[i+1]);
}
if (!options.out || !options.model || !options.corpus) throw new Error('Output, model and corpus are required');
const corpus = JSON.parse(await readFile(options.corpus, 'utf8'));
if (corpus.schema !== 1 || !Array.isArray(corpus.states) || !corpus.states.length) throw new Error('Invalid parity corpus');
await mkdir(path.join(options.out, 'runtime'), { recursive: true });
await build({ entryPoints: [path.join(root, 'tools/ai-benchmark/page.mjs'), path.join(root, 'tools/ai-benchmark/worker.mjs')],
  bundle: true, format: 'esm', platform: 'browser', target: ['safari17', 'chrome120'], outdir: options.out,
  entryNames: '[name]', sourcemap: false, minify: false });
await copyFile(path.join(root, 'tools/ai-benchmark/index.html'), path.join(options.out, 'index.html'));
await copyFile(options.model, path.join(options.out, 'model.onnx'));
await copyFile(options.corpus, path.join(options.out, 'corpus.json'));
for (const suffix of ['mjs', 'wasm']) {
  await copyFile(path.join(root, `node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.${suffix}`),
    path.join(options.out, `runtime/ort-wasm-simd-threaded.${suffix}`));
}
const config = JSON.parse(await readFile(path.join(root, 'packages/computer-player/config/experiment-v1.json'), 'utf8'));
const assets = {};
for (const [key, assetPath] of Object.entries({ worker: 'worker.js', model: 'model.onnx', corpus: 'corpus.json',
  runtimeMjs: 'runtime/ort-wasm-simd-threaded.mjs', runtimeWasm: 'runtime/ort-wasm-simd-threaded.wasm' })) {
  const bytes = await readFile(path.join(options.out, assetPath));
  assets[key] = { path: assetPath, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}
const runtimePackage = JSON.parse(await readFile(path.join(root, 'node_modules/onnxruntime-web/package.json'), 'utf8'));
const manifest = { schema: 1, encodingVersion: config.encodingVersion, runtimeVersion: runtimePackage.version,
  modelVersion: assets.model.sha256, testOnly: true, profilesCalibrated: false, assets };
await writeFile(path.join(options.out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ output: options.out, modelVersion: manifest.modelVersion, corpusStates: corpus.states.length, testOnly: true }));
