import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
const execute = promisify(execFile);
export async function processTable() {
  const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,lstart='], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
  const rows = [];
  for (const line of stdout.trim().split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    const row = { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), state: match[4], start: match[5] };
    if (process.platform === 'linux') {
      try { const stat = await readFile(`/proc/${row.pid}/stat`, 'utf8'); row.start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]; } catch { continue; }
    }
    rows.push(row);
  }
  return rows;
}
export const sameProcess = (row, identity) => Boolean(row && identity && row.pid === identity.pid && row.start === identity.start);
export const live = row => row && !row.state.startsWith('Z');
export async function memorySample({ platform = process.platform, run = execute } = {}) {
  if (platform !== 'darwin') return { level: 'unknown', reason: 'Pressure monitoring is macOS-only', at: Date.now() };
  try {
    const { stdout } = await run('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 3000 });
    const levels = { 1: 'normal', 2: 'warning', 4: 'critical' };
    const level = levels[stdout.trim()];
    if (!level) throw Error('Unrecognized memory-pressure level');
    let swapBytes = null;
    try { const result = await run('/usr/sbin/sysctl', ['vm.swapusage'], { timeout: 3000 }); const m = result.stdout.match(/used\s*=\s*([\d.]+)([KMG])/); if (m) swapBytes = Number(m[1]) * ({ K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2]]); } catch { /* Pressure is still usable if swap is unavailable. */ }
    return { level, swapBytes, at: Date.now() };
  } catch (error) { return { level: 'unknown', reason: error.message, at: Date.now() }; }
}
