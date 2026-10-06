import { realpath } from 'node:fs/promises';
import { supervise } from './supervisor.mjs';
import { records, cleanupRecord } from './registry.mjs';
import { processTable, sameProcess, live } from './system.mjs';
const args = process.argv.slice(2), mode = args.shift();
try {
  if (mode === 'run') {
    const split = args.indexOf('--');
    if (split < 0) throw Error('Usage: run [--kind heavy|preview|idle] [--keep] [--timeout-ms N] -- COMMAND ARGS');
    let kind = 'heavy', keep = false, timeoutMs = 0;
    for (let i = 0; i < split; i++) {
      if (args[i] === '--kind') kind = args[++i];
      else if (args[i] === '--keep') keep = true;
      else if (args[i] === '--timeout-ms') { timeoutMs = Number(args[++i]); if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw Error('Invalid timeout'); }
      else throw Error(`Unknown option: ${args[i]}`);
    }
    const argv = args.slice(split + 1);
    process.exitCode = (await supervise(argv, { kind, keep, timeoutMs })).code;
  } else if (mode === 'status' || mode === 'cleanup') {
    const index = args.indexOf('--run'), id = index >= 0 ? args[index + 1] : undefined;
    const cwd = await realpath(process.cwd());
    const selected = (await records()).filter(r => r.cwd === cwd && (!id || r.id === id) && (mode === 'cleanup' || id || args.includes('--all') || r.status !== 'finished'));
    if (mode === 'cleanup' && !id) throw Error('Cleanup requires --run ID from status. It never stops every checkout resource.');
    const rows = await processTable();
    for (const record of selected) {
      if (mode === 'cleanup') { const cleanup = await cleanupRecord(record); console.log(JSON.stringify({ id: record.id, cleanup })); if (cleanup === 'incomplete') process.exitCode = 1; }
      else console.log(JSON.stringify({ id: record.id, parentRun: record.parentRun, cwd: record.cwd, kind: record.kind, keep: record.keep, status: record.status, pressure: record.pressure, swapBytes: record.swapBytes, swapDeltaBytes: record.swapDeltaBytes, cleanup: record.cleanup, reason: record.reason, updatedAt: record.updatedAt, supervisorLive: rows.some(r => sameProcess(r, record.supervisor) && live(r)) }));
    }
    if (id && !selected.length) throw Error('Run not found in this checkout');
  } else throw Error('Commands: run, status, cleanup. See docs/ai/RESOURCE_MANAGEMENT.md.');
} catch (error) { console.error(`[resources] ${error.message}`); process.exitCode = 1; }
