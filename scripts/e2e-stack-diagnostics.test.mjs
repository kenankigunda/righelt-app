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
    const { process, path, os, mkdtemp, installProxyDiagnostics, createE2ePersistRoot } = dependencies;
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
    installProxyDiagnostics: () => { installed(); return installation; },
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

test('general stack captures each service exit before shutdown and preserves an unexpected exit during cleanup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'general-exit-test-'));
  try {
    const privateLogs = path.join(root, 'private');
    let launchOptions, unexpected = 0, shutdownCode;
    const child = new EventEmitter(); child.pid = 123;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    const run = new Function('dependencies', `
      const { path, observeAuthService, repoRoot, privateLogs, spawn, recordUnexpectedExit, shutdown } = dependencies;
      const cliPath = 'supervisor';
      const managedChildren = new Set(), intentionalStops = new Set(), serviceReceipts = [];
      let shuttingDown = false, diagnosticsFailed = false, serviceSequence = 0;
      ${launcher}
      return { spawnLogged, serviceReceipts, beginCleanup: () => { shuttingDown = true; } };
    `)({ path, observeAuthService, repoRoot: root, privateLogs,
      spawn: (_command, _args, options) => { launchOptions = options; return child; },
      recordUnexpectedExit: (label, code) => { assert.equal(label, 'pages'); assert.equal(code, 1); unexpected++; },
      shutdown: code => { shutdownCode = code; },
    });
    run.spawnLogged('pages', 'pnpm', [], { cwd: root });
    assert.equal(launchOptions.env.WRANGLER_LOG_PATH, path.join(privateLogs, 'web-1'));
    await mkdir(launchOptions.env.WRANGLER_LOG_PATH, { recursive: true });
    await writeFile(path.join(launchOptions.env.WRANGLER_LOG_PATH, 'wrangler-2026-10-12_09-01-40_000.log'),
      'private-binding\nError in ProxyController: Error inside ProxyWorker\nNetwork connection lost.');
    child.emit('exit', 1, null);
    assert.equal(unexpected, 1);
    assert.equal(shutdownCode, undefined);
    run.beginCleanup();
    child.emit('close', 1, null);
    const [result] = await Promise.all(run.serviceReceipts);
    assert.deepEqual(result, { expected: false, diagnosticsFailed: false });
    assert.equal(shutdownCode, 1);
    const bytes = await readFile(path.join(root, 'test-results/e2e-stack-diagnostics/private/web-1.json'), 'utf8');
    assert.ok(!bytes.includes('private-binding'));
    const receipt = JSON.parse(bytes);
    assert.equal(receipt.expected, false);
    assert.equal(receipt.logs[0].proxyControllerError, true);
    assert.equal(receipt.logs[0].networkConnectionLost, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
