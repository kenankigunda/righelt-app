import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'apps/web/computer/runtime');
await mkdir(out, { recursive: true });
await build({ entryPoints: [path.join(root, 'apps/web/computer/worker.mjs')], outfile: path.join(out, 'worker.js'), bundle: true, format: 'esm', platform: 'browser', target: ['safari17', 'chrome120'], minify: true });
for (const suffix of ['mjs', 'wasm']) await copyFile(path.join(root, `node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.${suffix}`), path.join(out, `ort-wasm-simd-threaded.${suffix}`));
const assets = {};
for (const [name, file] of Object.entries({ worker: 'worker.js', runtimeMjs: 'ort-wasm-simd-threaded.mjs', runtimeWasm: 'ort-wasm-simd-threaded.wasm' })) {
  const bytes = await readFile(path.join(out, file));
  assets[name] = { url: `/computer/runtime/${file}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const { version: runtimeVersion } = JSON.parse(await readFile(path.join(root, 'node_modules/onnxruntime-web/package.json'), 'utf8'));
await writeFile(path.join(out, 'manifest.json'), JSON.stringify({ schema: 1, runtimeVersion, assets }));
