// A stable process-group leader establishes ownership before the command starts.
// It also survives command completion until its guardian finishes cleanup.
import { spawn } from 'node:child_process';
let started = false, orphaned = false;
const sendResult = message => { if (process.connected) process.send(message, () => {}); };
process.on('message', message => {
  if (started || message?.type !== 'launch' || !Array.isArray(message.argv)) return;
  started = true;
  const child = spawn(message.argv[0], message.argv.slice(1), { stdio: 'inherit' });
  child.once('error', error => sendResult({ type: 'result', code: 1, error: error.message }));
  child.once('exit', (code, signal) => sendResult({ type: 'result', code: code ?? 1, signal }));
});
process.on('SIGTERM', () => { if (!orphaned) process.exit(0); });
process.on('disconnect', () => {
  orphaned = true;
  // The leader remains alive until escalation, so its group ID cannot be reused.
  if (process.platform !== 'win32') {
    try { process.kill(-process.pid, 'SIGTERM'); } catch {}
    setTimeout(() => { try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(1); } }, 5000);
  } else process.exit(1);
});
