import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildRulesWorker, assertRulesWorkerClosure, RULES_WORKER_ENTRY, RULES_WORKER_OUTPUT } from '../../../scripts/build-web-engine.mjs';
import { RulesRuntime } from '../board/rules-runtime.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('importing actual build helpers cannot run the CLI build or erase generated output', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'righelt-build-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scripts = path.join(directory, 'scripts'), generated = path.join(directory, 'apps/web/generated');
  await mkdir(scripts, { recursive: true }); await mkdir(generated, { recursive: true });
  await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  const file = path.join(scripts, 'build-web-engine.mjs'), sentinel = path.join(generated, 'owned-sentinel');
  const source = await readFile(new URL('../../../scripts/build-web-engine.mjs', import.meta.url), 'utf8');
  const guard = "if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await buildWebEngine();";
  assert.equal(source.split(guard).length - 1, 1);
  const importActualCopy = () => spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(file).href)})`], { cwd: directory, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  await writeFile(file, source); await writeFile(sentinel, 'owned fixture');
  const imported = importActualCopy(); assert.equal(imported.error, undefined); assert.equal(imported.status, 0, imported.stderr);
  assert.equal(await readFile(sentinel, 'utf8'), 'owned fixture');
  // Actual CLI body without its guard is the counterexample: it erases only
  // this owned fixture, then refuses its deliberately absent package sources.
  await writeFile(file, source.replace(guard, 'await buildWebEngine();'));
  const unguarded = importActualCopy(); assert.equal(unguarded.error, undefined); assert.notEqual(unguarded.status, 0);
  assert.match(unguarded.stderr, /ENOENT/);
  await assert.rejects(readFile(sentinel), { code: 'ENOENT' });
});

test('the generated rules worker is deterministic, self-contained and current', async () => {
  const first = await buildRulesWorker({ root, write: false });
  const second = await buildRulesWorker({ root, write: false });
  assert.deepEqual(first.metafile, second.metafile);
  assert.equal(hash(first.outputFiles[0].contents), hash(second.outputFiles[0].contents));
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents), await readFile(new URL('../generated/rules-worker.js', import.meta.url)));
  assert.equal(Object.values(first.metafile.outputs)[0].entryPoint, RULES_WORKER_ENTRY);
  assert.deepEqual(Object.values(first.metafile.outputs)[0].imports, []);
  assert.equal(first.outputFiles[0].path, fileURLToPath(new URL('../generated/rules-worker.js', import.meta.url)));
  assert.equal(RULES_WORKER_OUTPUT, 'apps/web/generated/rules-worker.js');
});

test('rules build rejects a runtime import, extra output and foreign dependency', () => {
  const valid = { metafile: { inputs: { [RULES_WORKER_ENTRY]: { imports: [] } }, outputs: { [RULES_WORKER_OUTPUT]: { entryPoint: RULES_WORKER_ENTRY, imports: [], exports: [] } } }, outputFiles: [{}] };
  assert.equal(assertRulesWorkerClosure(valid), valid);
  for (const change of [
    value => { value.metafile.outputs[RULES_WORKER_OUTPUT].imports.push({ path: './late.js', kind: 'import-statement', external: true }); },
    value => { value.metafile.outputs['second.js'] = {}; },
    value => { value.outputFiles.push({}); },
    value => { value.metafile.inputs['node_modules/foreign/index.js'] = { imports: [] }; },
    value => { value.metafile.inputs[RULES_WORKER_ENTRY].imports.push({ path: 'foreign', external: true }); },
    value => { value.metafile.outputs[RULES_WORKER_OUTPUT].exports.push('alternateHandler'); },
  ]) {
    const changed = structuredClone(valid); change(changed);
    assert.throws(() => assertRulesWorkerClosure(changed));
  }
});

test('default browser execution uses the self-contained entry without changing worker type', async t => {
  const original = globalThis.Worker, calls = [];
  globalThis.Worker = class {
    constructor(url, options) { calls.push({ url, options, worker: this }); }
    postMessage(message) { queueMicrotask(() => this.onmessage({ data: { ...message, result: 'complete' } })); }
    terminate() { this.terminated = true; }
  };
  t.after(() => { globalThis.Worker = original; });
  const runtime = new RulesRuntime(); t.after(() => runtime.cancelAll());
  assert.equal(await runtime.project('default-entry', {}), 'complete');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.href, new URL('../generated/rules-worker.js', import.meta.url).href);
  assert.deepEqual(calls[0].options, { type: 'module' });
  assert.equal(calls[0].worker.terminated, true);
});
