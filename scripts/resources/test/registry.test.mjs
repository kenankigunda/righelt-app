import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveRecord, recordPath } from '../registry.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'righelt-registry-test-'));
  const previous = process.env.RIGHELT_RESOURCE_REGISTRY;
  process.env.RIGHELT_RESOURCE_REGISTRY = path.join(dir, 'registry');
  t.after(async () => {
    if (previous === undefined) delete process.env.RIGHELT_RESOURCE_REGISTRY;
    else process.env.RIGHELT_RESOURCE_REGISTRY = previous;
    await rm(dir, { recursive: true, force: true });
  });
  return process.env.RIGHELT_RESOURCE_REGISTRY;
}

test('record persistence snapshots nested mutable state before yielding', async t => {
  await fixture(t);
  const record = { id: 'snapshot', status: 'running', members: [{ pid: 1 }] };
  const saved = saveRecord(record);
  record.status = 'finished';
  record.members[0].pid = 2;
  await saved;
  assert.deepEqual(JSON.parse(await readFile(recordPath(record.id), 'utf8')),
    { id: 'snapshot', status: 'running', members: [{ pid: 1 }] });
});

test('concurrent monitoring and shutdown writes all succeed and preserve call order', async t => {
  const root = await fixture(t);
  const writes = [];
  for (let sequence = 0; sequence < 100; sequence++) {
    writes.push(saveRecord({ id: 'overlap', sequence, status: 'running' }));
  }
  writes.push(saveRecord({ id: 'overlap', sequence: 100, status: 'finished', cleanup: 'verified' }));
  await Promise.all(writes);
  assert.deepEqual(JSON.parse(await readFile(recordPath('overlap'), 'utf8')),
    { id: 'overlap', sequence: 100, status: 'finished', cleanup: 'verified' });
  assert.deepEqual(await readdir(root), ['overlap.json']);
});

test('failed persistence rejects its caller without poisoning later writes', async t => {
  const root = await fixture(t);
  await writeFile(root, 'not a directory');
  await assert.rejects(saveRecord({ id: 'recovery', status: 'running' }),
    error => ['EEXIST', 'ENOTDIR'].includes(error.code));
  await rm(root);
  await saveRecord({ id: 'recovery', status: 'finished' });
  assert.equal(JSON.parse(await readFile(recordPath('recovery'), 'utf8')).status, 'finished');
});
