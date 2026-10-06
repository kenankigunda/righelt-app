import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { localHttpsEnvironment } from './local-https.mjs';

// Deliberately has no .env files: reproduces a newly-created validation checkout.
const temporary = await mkdtemp(path.join(os.tmpdir(), 'righelt-https-smoke-'));
const root = path.resolve(import.meta.dirname, '..');
let server;
try {
  await writeFile(path.join(temporary, 'wrangler.toml'), 'name = "righelt-https-smoke"\ncompatibility_date = "2026-03-12"\npages_build_output_dir = "."\n');
  await writeFile(path.join(temporary, 'index.html'), '<!doctype html><title>Righelt HTTPS smoke</title><h1>Trusted local HTTPS</h1>');
  const port = await new Promise(resolve => {
    const socket = createServer();
    socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
  });
  const env = localHttpsEnvironment({ cwd: temporary });
  server = spawn(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'pages', 'dev', '.', '--port', String(port), '--ip', '::', '--local-protocol', 'https', '--inspector-port', '0'], { cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', data => { output += data; });
  server.stderr.on('data', data => { output += data; });
  server.on('error', error => { output += error.message; });
  const ready = await new Promise(resolve => {
    const interval = setInterval(() => {
      if (/Ready on/.test(output)) { clearInterval(interval); clearTimeout(timeout); resolve(true); }
      else if (server.exitCode !== null) { clearInterval(interval); clearTimeout(timeout); resolve(false); }
    }, 100);
    const timeout = setTimeout(() => { clearInterval(interval); resolve(false); }, 30000);
  });
  if (!ready) throw Error(`Wrangler HTTPS startup failed: ${output}`);
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'scripts/check-local-https.mjs'), `https://${host}:${port}`], { cwd: temporary, env, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(Error(`Strict browser check failed for ${host}`)));
    });
  }
} finally {
  if (server && server.exitCode === null) {
    await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); const timer = setTimeout(() => server.kill('SIGKILL'), 5000); timer.unref(); });
  }
  await rm(temporary, { recursive: true, force: true });
}
