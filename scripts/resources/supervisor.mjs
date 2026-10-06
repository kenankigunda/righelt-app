import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { POLICY, pressureState, advancePressure } from './policy.mjs';
import { memorySample, processTable, sameProcess, live } from './system.mjs';
import { saveRecord, pruneRecords, records, cleanupRecord } from './registry.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const workerPath = fileURLToPath(new URL('./worker.mjs', import.meta.url));
export const cliPath = fileURLToPath(new URL('./cli.mjs', import.meta.url));
// Validation already supervised as one command does not need another outer wrapper.
export function supervisedArgv(argv, env = process.env, { kind = 'heavy', keep = false } = {}) {
  return env.RIGHELT_RESOURCE_RUN ? argv : [process.execPath, cliPath, 'run', '--kind', kind, ...(keep ? ['--keep'] : []), '--', ...argv];
}
export async function supervise(argv, { kind = 'heavy', keep = false, timeoutMs = 0, platform = process.platform, policy = POLICY, sample = memorySample, table = processTable, notify = message => console.error(`[resources] ${message}`) } = {}) {
  if (!argv.length || !['heavy', 'preview', 'idle'].includes(kind)) throw Error('Provide a command and a valid resource kind');
  keep ||= process.env.RIGHELT_RESOURCE_KEEP === '1';
  const unix = platform !== 'win32';
  if (!unix) notify('Process-group cleanup is unavailable on Windows. Direct-child cleanup remains enabled.');
  const id = randomUUID();
  let state = pressureState(), lastLevel, lastSwap, lastMemory = 0, child, stopping, cancelReason, wakeWait;
  let members = [], lastRows = [], snapshotUnavailable = false;
  const ownerPid = process.ppid;
  let initialRows = [];
  if (unix) { try { initialRows = await table(); } catch (error) { throw Error(`Cannot establish resource ownership: ${error.message}. Run with scoped process-table access.`); } }
  const supervisor = initialRows.find(r => r.pid === process.pid);
  if (unix && !supervisor) throw Error('Cannot verify supervisor identity. Command was not launched.');
  const owner = initialRows.find(r => r.pid === ownerPid);
  const cwd = await realpath(process.cwd());
  const record = { id, parentRun: process.env.RIGHELT_RESOURCE_RUN || null, cwd, kind, keep, supervisor, owner, members, status: 'waiting', startedAt: new Date().toISOString() };
  const persist = async () => { record.members = members; record.pressure = state.level; record.updatedAt = new Date().toISOString(); await saveRecord(record); };
  const checkMemory = async () => {
    const current = await sample();
    state = advancePressure(state, current, Date.now(), policy);
    if (lastLevel !== current.level) {
      notify(current.level === 'unknown' ? `Memory monitoring unavailable: ${current.reason}` : `Memory pressure: ${current.level}${state.blocked ? '. New heavy jobs are deferred.' : ''}`);
      lastLevel = current.level;
    }
    record.swapBytes = current.swapBytes ?? null;
    record.swapDeltaBytes = current.swapBytes != null && lastSwap != null ? current.swapBytes - lastSwap : null;
    if (current.swapBytes != null) lastSwap = current.swapBytes;
    lastMemory = Date.now();
  };
  const snapshot = async () => {
    if (!unix) return;
    try {
      lastRows = await table();
      const group = lastRows.filter(r => r.pgid === child.pid);
      const anchored = members.length ? group.some(r => members.some(m => sameProcess(r, m))) : group.some(r => r.pid === child.pid && child.exitCode === null);
      if (anchored) for (const row of group) if (!members.some(m => sameProcess(row, m))) members.push(row);
      snapshotUnavailable = false;
    } catch (error) { if (!snapshotUnavailable) notify(`Ownership inspection unavailable: ${error.message}`); snapshotUnavailable = true; }
  };
  const ownedLive = () => lastRows.filter(r => r.pgid === child.pid && live(r) && members.some(m => sameProcess(r, m)));
  const stop = async reason => {
    if (stopping) return stopping;
    cancelReason = reason;
    stopping = (async () => {
      record.status = 'stopping'; record.reason = reason; wakeWait?.();
      // Explicit nested guardians may own separate groups (Playwright web servers and restartable APIs).
      // Their parent-run IDs establish task ownership. Let them verify their groups before stopping ours.
      const nested = unix ? (await records()).filter(r => r.parentRun === id && r.id !== id) : [];
      const nestedCleanup = await Promise.all(nested.map(r => cleanupRecord(r)));
      let nestedIncomplete = nestedCleanup.some(result => result === 'incomplete');
      if (child) {
        await snapshot();
        if (unix && ownedLive().length) { try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
        else if (!unix && child.exitCode === null) child.kill('SIGTERM');
        const deadline = Date.now() + policy.graceMs;
        while (unix && ownedLive().length && Date.now() < deadline) { await sleep(50); await snapshot(); }
        if (unix && ownedLive().length) { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
        else if (!unix && child.exitCode === null) {
          const deadline = Date.now() + policy.graceMs;
          while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(50);
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }
        const verifyDeadline = Date.now() + 2000;
        do { await snapshot(); if (!ownedLive().length) break; await sleep(50); } while (Date.now() < verifyDeadline);
        record.cleanup = !unix ? (child.exitCode !== null || child.signalCode !== null ? 'direct-child-verified' : 'incomplete') : snapshotUnavailable ? 'unverified' : ownedLive().length ? 'incomplete' : 'verified';
      } else record.cleanup = 'verified';
      // Catch guardians created while the first cleanup pass was running. Their launcher is now stopped.
      const lateNested = unix ? (await records()).filter(r => r.parentRun === id && r.id !== id) : [];
      const lateCleanup = await Promise.all(lateNested.map(r => cleanupRecord(r)));
      nestedIncomplete ||= lateCleanup.some(result => result === 'incomplete');
      if (nestedIncomplete) record.cleanup = 'incomplete';
      record.status = ['verified', 'direct-child-verified'].includes(record.cleanup) ? 'finished' : 'cleanup-incomplete';
      await persist();
    })();
    return stopping;
  };
  const onInt = () => { void stop('SIGINT'); };
  const onTerm = () => { void stop('SIGTERM'); };
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  let timer;
  try {
    if (unix && record.parentRun) {
      const parent = (await records()).find(r => r.id === record.parentRun);
      const parentAlive = parent && initialRows.some(r => sameProcess(r, parent.supervisor) && live(r));
      if (!parentAlive || !['running', 'waiting'].includes(parent.status)) {
        await stop('parent-run-exited'); return { code: 130, reason: cancelReason, id };
      }
    }
    await checkMemory(); await persist();
    // Existing normal jobs start immediately. After a pressure event four normal samples are required.
    while (kind === 'heavy' && state.blocked && !stopping) {
      await new Promise(resolve => {
        const timeout = setTimeout(() => { wakeWait = undefined; resolve(); }, policy.sampleMs);
        wakeWait = () => { clearTimeout(timeout); wakeWait = undefined; resolve(); };
      });
      if (stopping) break;
      await checkMemory(); await persist();
      if (owner && !(await table()).some(r => sameProcess(r, owner) && live(r))) await stop('launcher-exited');
    }
    if (stopping) { await stopping; return { code: 130, reason: cancelReason, id }; }
    child = unix ? spawn(process.execPath, [workerPath], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'], detached: true, env: { ...process.env, RIGHELT_RESOURCE_RUN: id, RIGHELT_RESOURCE_KEEP: keep ? '1' : '' } }) : spawn(argv[0], argv.slice(1), { stdio: 'inherit', env: { ...process.env, RIGHELT_RESOURCE_RUN: id, RIGHELT_RESOURCE_KEEP: keep ? '1' : '' } });
    record.pgid = child.pid; record.status = 'running';
    let exitResult;
    const exited = new Promise(resolve => { child.once('error', error => resolve({ code: 1, error: error.message })); child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal })); child.on('message', message => { if (message?.type === 'result') resolve(message); }); });
    await snapshot();
    if (unix && !members.some(m => m.pid === child.pid)) { await stop('ownership-unavailable'); throw Error('Could not verify process-group leader. Command was not launched.'); }
    await persist();
    if (unix) child.send({ type: 'launch', argv });
    let polling = false;
    const started = Date.now();
    timer = setInterval(async () => {
      if (polling || stopping) return;
      polling = true;
      try {
        await snapshot();
        if (owner && !lastRows.some(r => sameProcess(r, owner) && live(r))) await stop('launcher-exited');
        if (timeoutMs && Date.now() - started >= timeoutMs) await stop('timeout');
        if (Date.now() - lastMemory >= policy.sampleMs) {
          await checkMemory(); await persist();
          if (state.cancel && kind === 'heavy') { notify('Critical pressure persisted for 60 seconds. Cancelling this heavy job as incomplete.'); await stop('memory-pressure'); }
          else if (state.releaseIdle && !keep && kind !== 'heavy') { notify('Sustained pressure. Releasing this disposable service.'); await stop('memory-pressure'); }
        }
      } catch (error) { notify(error.message); await stop('monitor-error'); }
      finally { polling = false; }
    }, policy.ownershipSampleMs);
    exitResult = await exited;
    clearInterval(timer);
    await stop(cancelReason || (exitResult.error ? 'spawn-error' : 'command-exited'));
    const interrupted = !['command-exited', 'spawn-error'].includes(cancelReason);
    return { ...exitResult, code: !['verified', 'direct-child-verified'].includes(record.cleanup) ? 1 : interrupted ? (cancelReason === 'memory-pressure' ? 75 : 130) : exitResult.code, reason: cancelReason, id, cleanup: record.cleanup };
  } finally {
    clearInterval(timer);
    process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
    if (child && !stopping) await stop('supervisor-error');
    // Retain bounded private diagnostic receipts without pruning active or incomplete cleanup.
    await pruneRecords();
  }
}
