import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isStackStopping, recordUnexpectedExit } from '../stack-status.mjs';

test('only the owned guardian stopping record establishes expected service teardown', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'stack-stop-state-'));
  const keys = ['RIGHELT_RESOURCE_REGISTRY', 'RIGHELT_RESOURCE_RUN', 'RIGHELT_TEST_STACK_STATUS'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.RIGHELT_RESOURCE_REGISTRY = directory;
    process.env.RIGHELT_RESOURCE_RUN = 'owned-run';
    process.env.RIGHELT_TEST_STACK_STATUS = path.join(directory, 'stack.json');
    assert.equal(isStackStopping(), false);
    const file = path.join(directory, 'owned-run.json');
    for (const status of ['running', 'waiting', 'finished', 'stopping']) {
      await writeFile(file, JSON.stringify({ status }));
      assert.equal(isStackStopping(), status === 'stopping');
    }
    recordUnexpectedExit('pages', 130, null);
    await assert.rejects(readFile(process.env.RIGHELT_TEST_STACK_STATUS), { code: 'ENOENT' });
    await writeFile(file, JSON.stringify({ status: 'running' }));
    const stopping = isStackStopping();
    await writeFile(file, JSON.stringify({ status: 'stopping' }));
    recordUnexpectedExit('pages', 1, null, { stopping });
    const first = JSON.parse(await readFile(process.env.RIGHELT_TEST_STACK_STATUS, 'utf8'));
    assert.equal(first.unexpectedExit, true); assert.equal(first.code, 1);
    await writeFile(file, '{'); assert.equal(isStackStopping(), false);
    recordUnexpectedExit('api', 130, null);
    assert.deepEqual(JSON.parse(await readFile(process.env.RIGHELT_TEST_STACK_STATUS, 'utf8')), first);
    delete process.env.RIGHELT_RESOURCE_RUN; assert.equal(isStackStopping(), false);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
