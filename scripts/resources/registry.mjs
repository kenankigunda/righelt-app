import { POLICY } from './policy.mjs';
import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { processTable, sameProcess, live } from './system.mjs';
export const registryRoot = () => process.env.RIGHELT_RESOURCE_REGISTRY || path.join(os.homedir(), '.local', 'state', 'righelt', 'resources');
export function recordPath(id) { if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw Error('Invalid resource run ID'); return path.join(registryRoot(), `${id}.json`); }
export async function saveRecord(record) {
  const file = recordPath(record.id);
  await mkdir(registryRoot(), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(record) + '\n', { mode: 0o600 });
  await rename(tmp, file);
}
export async function records() {
  let names; try { names = await readdir(registryRoot()); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const result = [];
  for (const name of names.filter(n => /^[a-zA-Z0-9-]+\.json$/.test(n))) {
    try { result.push(JSON.parse(await readFile(path.join(registryRoot(), name), 'utf8'))); } catch { /* Partial/corrupt records never authorize a signal. */ }
  }
  return result;
}
export async function cleanupRecord(record, { table = processTable, signal = process.kill, graceMs = 7000 } = {}) {
  const matches = rows => rows.filter(row => live(row) && (sameProcess(row, record.supervisor) || ((record.members ?? []).some(identity => sameProcess(row, identity)) && row.pgid === record.pgid)));
  let rows = await table();
  const owner = rows.find(row => sameProcess(row, record.supervisor));
  const send = (pid, value) => { try { signal(pid, value); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  if (live(owner)) send(owner.pid, 'SIGTERM');
  else for (const row of matches(rows)) send(row.pid, 'SIGTERM');
  if (!matches(rows).length) return 'stale';
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    rows = await table();
    if (!matches(rows).length) return 'verified';
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  // Revalidate every exact saved identity before escalating. Never signal a stale group.
  rows = await table();
  for (const row of matches(rows)) send(row.pid, 'SIGKILL');
  const verifyDeadline = Date.now() + 2000;
  do {
    rows = await table();
    if (!matches(rows).length) return 'verified';
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < verifyDeadline);
  return 'incomplete';
}

export async function removeRecord(id) { await rm(recordPath(id), { force: true }); }

export async function pruneRecords(now = Date.now()) {
  const finished = (await records()).filter(r => r.status === 'finished').sort((a,b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  for (const [index, record] of finished.entries()) {
    if (index >= POLICY.auditMax || now - Date.parse(record.updatedAt) > POLICY.auditAgeMs) await removeRecord(record.id);
  }
}
