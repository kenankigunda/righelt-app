import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';

const source = await readFile(new URL('./e2e-stack.mjs', import.meta.url), 'utf8');

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
    const { process, installProxyDiagnostics, createE2ePersistRoot } = dependencies;
    let shuttingDown = false, proxyDiagnosticsInstallation, controlServer, tempRoot = '';
    const managedChildren = new Set();
    const stopChild = () => { throw Error('No service should have launched'); };
    ${shutdown}
    ${startup}
    return run;
  `)({ process: events,
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
