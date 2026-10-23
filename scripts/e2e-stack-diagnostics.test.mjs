import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { observeAuthService } from './auth-stack-diagnostics.mjs';

const source = await readFile(new URL('./e2e-stack.mjs', import.meta.url), 'utf8');
const launcher = source.slice(source.indexOf('const spawnLogged ='), source.indexOf('const runBlocking ='));

test('cancellation waits for an in-flight diagnostic installation and restores before exiting', async () => {
  const shutdown = source.slice(source.indexOf('const shutdown ='), source.indexOf('const run ='));
  const startup = source.slice(source.indexOf('const run ='), source.indexOf("if (!process.env.RIGHELT_RESOURCE_RUN)"));
  let releaseInstallation, installed, stopped;
  const installationStarted = new Promise(resolve => { installed = resolve; });
  const installation = new Promise(resolve => { releaseInstallation = resolve; });
  const shutdownFinished = new Promise(resolve => { stopped = resolve; });
  const events = new EventEmitter();
  const order = [];
  events.exit = code => { order.push(`exit:${code}`); stopped(); };
  const run = new Function('dependencies', `
    const { process, path, os, mkdtemp, installProxyConnectionIsolation, createE2ePersistRoot } = dependencies;
    let shuttingDown = false, privateLogs, proxyDiagnosticsInstallation, controlServer, diagnosticsFailed = false, tempRoot = '';
    const managedChildren = new Set(), serviceReceipts = [];
    const stopChild = () => { throw Error('No service should have launched'); };
    ${shutdown}
    ${startup}
    return run;
  `)({ process: events, path, os,
    mkdtemp: async () => {
      assert.equal(events.listenerCount('SIGTERM'), 1);
      assert.equal(events.listenerCount('SIGINT'), 1);
      return '/private/test-only';
    },
    installProxyConnectionIsolation: () => { installed(); return installation; },
    createE2ePersistRoot: () => { throw Error('Startup continued after cancellation'); },
  });
  const pendingRun = run();
  await installationStarted;
  events.emit('SIGTERM');
  await Promise.resolve();
  assert.deepEqual(order, []);
  releaseInstallation(async () => { order.push('restored'); });
  await pendingRun; await shutdownFinished;
  assert.deepEqual(order, ['restored', 'exit:0']);
});

for (const guardianStops of [false, true]) {
test(`general service exit preserves the observed guardian stop state: ${guardianStops}`, async () => {
  let guardianStopping = guardianStops, guardianReads = 0;
  const root = await mkdtemp(path.join(os.tmpdir(), 'general-exit-test-'));
  try {
    const privateLogs = path.join(root, 'private');
    let launchOptions, unexpected = 0, shutdownCode;
    const child = new EventEmitter(); child.pid = 123;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    const run = new Function('dependencies', `
      const { path, observeAuthService, repoRoot, privateLogs, spawn, recordUnexpectedExit, shutdown } = dependencies;
      const { isStackStopping } = dependencies;
      const cliPath = 'supervisor';
      const managedChildren = new Set(), intentionalStops = new Set(), serviceReceipts = [];
      let shuttingDown = false, diagnosticsFailed = false, serviceSequence = 0;
      ${launcher}
      return { spawnLogged, serviceReceipts, beginCleanup: () => { shuttingDown = true; } };
    `)({ path, observeAuthService, repoRoot: root, privateLogs,
      isStackStopping: () => { guardianReads++; return guardianStopping; },
      spawn: (_command, _args, options) => { launchOptions = options; return child; },
      recordUnexpectedExit: (label, code, signal, state) => {
        assert.equal(label, 'pages'); assert.equal(code, 1); assert.equal(signal, null);
        assert.deepEqual(state, { stopping: false }); unexpected++;
      },
      shutdown: code => { shutdownCode = code; },
    });
    run.spawnLogged('pages', 'pnpm', [], { cwd: root });
    assert.equal(launchOptions.env.RIGHELT_AUTH_FRESH_CONNECTIONS, '1');
    assert.equal(launchOptions.env.WRANGLER_LOG_PATH, path.join(privateLogs, 'web-1'));
    await mkdir(launchOptions.env.WRANGLER_LOG_PATH, { recursive: true });
    await writeFile(path.join(launchOptions.env.WRANGLER_LOG_PATH, 'wrangler-2026-10-12_09-01-40_000.log'),
      'private-binding\nError in ProxyController: Error inside ProxyWorker\nNetwork connection lost.');
    const code = guardianStops ? 130 : 1;
    child.emit('exit', code, null);
    assert.equal(unexpected, guardianStops ? 0 : 1);
    assert.equal(shutdownCode, undefined);
    assert.equal(guardianReads, 1);
    guardianStopping = !guardianStops;
    run.beginCleanup();
    // A pending startup/reset may resume after its asynchronous migration.
    assert.throws(() => run.spawnLogged('api', 'pnpm', [], {cwd: root}), /refusing a late service launch/);
    assert.equal(run.serviceReceipts.length, 1);
    child.emit('close', code, null);
    const [result] = await Promise.all(run.serviceReceipts);
    assert.deepEqual(result, { expected: guardianStops, diagnosticsFailed: false });
    assert.equal(shutdownCode, guardianStops ? undefined : 1);
    assert.equal(guardianReads, 1);
    const bytes = await readFile(path.join(root, 'test-results/e2e-stack-diagnostics/private/web-1.json'), 'utf8');
    assert.ok(!bytes.includes('private-binding'));
    const receipt = JSON.parse(bytes);
    assert.equal(receipt.expected, guardianStops);
    assert.equal(receipt.logs[0].proxyControllerError, true);
    assert.equal(receipt.logs[0].networkConnectionLost, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
}


test('shutdown restores diagnostic source before waiting for service cleanup', async () => {
  const shutdown = source.slice(source.indexOf('const shutdown ='), source.indexOf('const run ='));
  let release;
  const stopped = new Promise(resolve => { release = resolve; });
  const order = [];
  const run = new Function('dependencies', `
    const {stopChild, proxyDiagnosticsInstallation, process} = dependencies;
    let shuttingDown = false, controlServer, diagnosticsFailed = false, tempRoot = '';
    const managedChildren = new Set([{}]), serviceReceipts = [];
    ${shutdown}
    return shutdown;
  `)({stopChild: () => stopped, proxyDiagnosticsInstallation: Promise.resolve(async () => order.push('restored')),
    process: {exit: code => order.push('exit:' + code)}});
  const pending = run();
  await new Promise(resolve => setImmediate(resolve));
  try { assert.deepEqual(order, ['restored']); }
  finally { release(); await pending; }
  assert.deepEqual(order, ['restored', 'exit:0']);
});

for (const stopping of [false, true]) test(`runtime preparation respects migration cancellation: ${stopping}`, async () => {
  const boundary = source.slice(source.indexOf('  await migrate();'), source.indexOf('  const startApi ='));
  const calls = [];
  const run = new Function('migrate', 'runBlocking', 'process', 'repoRoot', 'shuttingDown', `return async () => {${boundary}}`);
  await run(async () => calls.push('migrated'), async (label, command, args) => calls.push([label, command, args]), { execPath: 'node22' }, '/candidate', stopping)();
  assert.deepEqual(calls, stopping ? ['migrated'] : ['migrated', ['computer runtime', 'node22', ['scripts/build-computer-player.mjs']]]);
});
