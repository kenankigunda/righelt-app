import { cliPath } from '../resources/supervisor.mjs';
import {candidateCapabilities} from './capabilities.mjs';
// Versioned validation fixture. Runs candidate code; never rewrites candidate scripts.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { get } from 'node:https';
import { mkdir, mkdtemp, readFile, writeFile, rm, chmod, lstat, readdir, rename } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PORTS = Object.freeze({ web: 9988, api: 9987, control: 10088, apiInspector: 9997, webInspector: 9998 });
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
function replaceOne(source, pattern, replacement, label) {
  if ([...source.matchAll(new RegExp(pattern.source, 'gm'))].length !== 1) throw new Error(`Unsupported candidate config: ${label}`);
  return source.replace(pattern, replacement);
}
export function candidateConfig(source, { root, folder, role, secret }) {
  const names = { api: 'righelt-validation-account-api', auth: 'righelt-validation-account-admission', 'auth-hash': 'righelt-validation-account-hash' };
  const tableStart = source.search(/^\s*\[/m);
  const prefix = tableStart < 0 ? source : source.slice(0, tableStart);
  const tables = tableStart < 0 ? '' : source.slice(tableStart);
  let result = replaceOne(prefix, /^name\s*=\s*"[^"]+"/m, `name = ${JSON.stringify(names[folder])}`, 'worker name') + tables;
  result = replaceOne(result, /^main\s*=\s*"([^"\n]+)"/m, (_, entry) => `main = ${JSON.stringify(path.resolve(root, 'apps', folder, entry))}`, 'entrypoint');
  result = result.replace(/^service\s*=\s*"righelt-auth-hash"/gm, `service = "${names['auth-hash']}"`).replace(/^service\s*=\s*"righelt-auth"/gm, `service = "${names.auth}"`);
  if (role === 'api') {
    // Preserve the binding's local namespace across the guest -> account upgrade.
    // Every D1 invocation below is explicitly --local.
    result = replaceOne(result, /^database_id\s*=\s*"[^"]+"/m, match => match, 'D1 database');
    result = replaceOne(result, /^migrations_dir\s*=\s*"[^"]+"/m, `migrations_dir = ${JSON.stringify(path.join(root, 'db/migrations'))}`, 'migration path');
    // Early account UI stages predate deployment wiring. Match their checked-in
    // e2e-auth-stack overlay, while preserving the retained local D1 namespace.
    if (!/^AUTH_ENABLED\s*=/m.test(result)) {
      if (/^\[vars\]|HASH_SERVICE|AUTH_HMAC_SECRET|AUTH_ALLOWED_ORIGINS/m.test(result)) throw new Error('Unsupported partial account config');
      result += `\n[vars]\nAUTH_ENABLED = "false"\n\n[[services]]\nbinding = "HASH_SERVICE"\nservice = "${names.auth}"\n`;
    }
    result = replaceOne(result, /^AUTH_ENABLED\s*=\s*"false"/m, 'AUTH_ENABLED = "true"', 'auth flag');
    if (/^AUTH_(HMAC_SECRET|ALLOWED_ORIGINS)\s*=/m.test(result)) throw new Error('Candidate embeds auth fixture credentials');
    result = replaceOne(result, /^\[vars\]/m, `[vars]\nAUTH_ALLOWED_ORIGINS = "https://127.0.0.1:${PORTS.web}"\nAUTH_HMAC_SECRET = ${JSON.stringify(secret)}`, 'vars table');
  }
  return result;
}
// Caller must fully stop the guest stack before invoking this helper.
export async function initializeAccountUpgrade({ sourcePersistRoot, accountPersistRoot }) {
  if (![sourcePersistRoot, accountPersistRoot].every(value => value && path.isAbsolute(value))) throw new Error('Upgrade persistence paths must be absolute');
  const source = path.join(sourcePersistRoot, 'v3', 'd1');
  await mkdir(accountPersistRoot, { recursive: true, mode: 0o700 });
  await chmod(accountPersistRoot, 0o700);
  const lock = path.join(accountPersistRoot, '.clone-lock');
  await mkdir(lock);
  let staging;
  try {
    const target = path.join(accountPersistRoot, 'state');
    try {
      const prior = JSON.parse(await readFile(path.join(target, 'upgrade-provenance.json'), 'utf8'));
      if (prior.version !== 1 || prior.source !== source) throw new Error('Account upgrade provenance does not match source');
      return { initialized: false, provenance: prior };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await lstat(target); throw new Error('Refusing to overwrite existing account state without upgrade provenance'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const files = [];
    const walk = async (directory, relative = '') => {
      if (!(await lstat(directory)).isDirectory()) throw new Error('Local D1 source must be a real directory');
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const next = path.join(relative, item.name), absolute = path.join(directory, item.name);
        if (item.isDirectory()) await walk(absolute, next);
        else if (item.isFile() && /^[a-f0-9]+\.sqlite(?:-wal|-shm)?$/.test(item.name)) files.push(next);
        else throw new Error(`Unexpected local D1 entry: ${next}`);
      }
    };
    await walk(source);
    if (!files.some(file => file.endsWith('.sqlite'))) throw new Error('No retained local D1 database found');
    staging = await mkdtemp(path.join(accountPersistRoot, '.upgrade-'));
    const entries = [];
    for (const file of files.sort()) {
      const bytes = await readFile(path.join(source, file));
      const dest = path.join(staging, 'v3', 'd1', file);
      await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
      await writeFile(dest, bytes, { mode: 0o600 });
      entries.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    for (const entry of entries) {
      const digest = createHash('sha256').update(await readFile(path.join(source, entry.file))).digest('hex');
      if (digest !== entry.sha256) throw new Error('Guest database changed during account upgrade copy; stop its stack first');
    }
    const provenance = { version: 1, source, copiedAt: new Date().toISOString(), files: entries };
    await writeFile(path.join(staging, 'upgrade-provenance.json'), JSON.stringify(provenance, null, 2), { mode: 0o600 });
    await rename(staging, target); staging = null;
    return { initialized: true, provenance };
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
export async function prepareAccountState(persistRoot) {
  if (!persistRoot || !path.isAbsolute(persistRoot)) throw new Error('RIGHELT_ACCOUNT_PERSIST_ROOT must be an absolute private path');
  await mkdir(persistRoot, { recursive: true, mode: 0o700 });
  await chmod(persistRoot, 0o700);
  const keyPath = path.join(persistRoot, 'hmac-v1.key');
  try { await writeFile(keyPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await chmod(keyPath, 0o600);
  const secret = (await readFile(keyPath, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid persisted account fixture key; refusing session invalidation');
  const persist = path.join(persistRoot, 'state');
  await mkdir(persist, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(path.join(persistRoot, 'config-'));
  return { secret, persist, temporary, cleanup: () => rm(temporary, { recursive: true, force: true }) };
}
export function legacySeedSql({ fixture, columns, cutover = null }) {
  if (cutover?.activated_at != null || cutover?.maintenance === 1) return '';
  const values = { game_id: fixture.id, created_at: fixture.createdAt, updated_at: fixture.updatedAt, latest_activity_at: fixture.updatedAt, state_json: JSON.stringify(fixture), event_seq: 0 };
  const keys = Object.keys(values).filter(key => columns.includes(key));
  for (const key of ['game_id', 'created_at', 'updated_at', 'state_json']) if (!keys.includes(key)) throw new Error(`Unsupported legacy schema: ${key}`);
  return `INSERT INTO live_games(${keys.join(',')}) SELECT ${keys.map(key => quote(values[key])).join(',')} WHERE NOT EXISTS(SELECT 1 FROM live_games WHERE game_id=${quote(fixture.id)});\nINSERT INTO live_invites(token,game_id,shared_by_role) SELECT 'cutover-legacy-invite',${quote(fixture.id)},'Player 1' WHERE NOT EXISTS(SELECT 1 FROM live_invites WHERE token='cutover-legacy-invite');`;
}
export function selectAccountControl({ method, url, origin, hasCutover, simplifiedAccounts = false }) {
  if (method !== 'POST' || origin !== undefined) return { status: 404 };
  if (url === '/reset-limits') return { status: 200, sql: 'DELETE FROM account_rate_limits' };
  if (!['/activate-cutover', '/maintenance-off'].includes(url)) return { status: 404 };
  if (!hasCutover) return { status: 409, message: 'Cutover schema unavailable' };
  const acknowledgment = simplifiedAccounts ? '' : ' AND recovery_acknowledged=1';
  if (url === '/activate-cutover') return { status: 200, sql: `UPDATE account_cutover SET activated_at=COALESCE(activated_at,CAST(unixepoch('subsec')*1000 AS INTEGER)),maintenance=1,canary_account_id=COALESCE(canary_account_id,(SELECT account_id FROM accounts WHERE username_canonical='validation_canary'${acknowledgment})) WHERE singleton=1 AND EXISTS(SELECT 1 FROM accounts WHERE username_canonical='validation_canary'${acknowledgment} AND (account_cutover.canary_account_id IS NULL OR account_cutover.canary_account_id=accounts.account_id))` };
  return { status: 200, sql: `UPDATE account_cutover SET maintenance=0 WHERE singleton=1 AND activated_at IS NOT NULL AND canary_account_id=(SELECT account_id FROM accounts WHERE username_canonical='validation_canary'${acknowledgment})` };
}
export async function assertPortsFree(ports = Object.values(PORTS)) {
  const held = [];
  try {
    for (const port of ports) {
      const server = createSocketServer(); held.push(server);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve); });
    }
  } finally { await Promise.all(held.map(server => new Promise(resolve => server.close(resolve)))); }
}
export function resolveCandidateRoot(env = process.env, cwd = process.cwd()) {
  const account = env.RIGHELT_ACCOUNT_CANDIDATE_ROOT;
  const target = env.RIGHELT_VALIDATION_TARGET_ROOT;
  if (account && target && path.resolve(account) !== path.resolve(target)) throw new Error('Conflicting account and validation candidate roots');
  return path.resolve(account || target || cwd);
}
export function assertRunning(stopping) {
  if (stopping) throw new Error('Account fixture shutdown requested');
}
// Wait for the process group, not merely pnpm's leader. A child may outlive it.
export async function terminateProcessGroup(pid, { kill = process.kill, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), graceMs = 5000, now = Date.now } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const send = signal => { try { kill(-pid, signal); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
  if (!send('SIGTERM')) return;
  const deadline = now() + graceMs;
  while (send(0)) {
    if (now() >= deadline) {
      send('SIGKILL');
      // Keep the lock until the kernel reports the group gone.
      const killedDeadline = now() + 5000;
      while (send(0)) { if (now() >= killedDeadline) throw new Error(`Account fixture process group ${pid} did not exit`); await pause(25); }
      return;
    }
    await pause(25);
  }
}
export async function startAccountStack({ root = resolveCandidateRoot(), persistRoot = process.env.RIGHELT_ACCOUNT_PERSIST_ROOT, onStopReady = () => {} } = {}) {
  root = path.resolve(root);
  const {simplifiedAccounts} = await candidateCapabilities(root);
  // Read capabilities from the candidate, rather than assuming the harness has account code.
  const sources = await Promise.all(['api', 'auth', 'auth-hash'].map(folder => readFile(path.join(root, 'apps', folder, 'wrangler.toml'), 'utf8')));
  await readFile(path.join(root, 'apps/web/shell/account-controller.js'));
  const ports = await import(pathToFileURL(path.join(root, 'apps/web/local-dev-ports.js')));
  if (!ports.LOCAL_DEV_PORT_VARIANTS.some(item => item.suffix === 'auth-e2e' && item.webPort === PORTS.web && item.apiPort === PORTS.api)) throw new Error('Candidate lacks supported auth-e2e port mapping');
  const lock = path.join(os.tmpdir(), 'righelt-validation-account-9988.lock');
  await mkdir(lock); // Existing lock is never stolen, including stale locks.
  let state, control, stopping = false;
  const children = new Set();
  const groups = new Set();
  let stopPromise;
  const stop = () => stopPromise ||= (async () => {
    stopping = true;
    if (control) { control.closeAllConnections(); await new Promise(resolve => control.close(resolve)); }
    await Promise.all([...groups].map(pid => terminateProcessGroup(pid)));
    await state?.cleanup();
    await rm(lock, { recursive: true, force: true });
  })();
  onStopReady(stop);
  const run = (args, { cwd = root, service = false, capture = false } = {}) => {
    assertRunning(stopping);
    const child = spawn(process.execPath, [cliPath, 'run', '--kind', service ? 'preview' : 'heavy', '--', 'pnpm', ...args], { cwd, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', detached: true });
    children.add(child);
    if (child.pid) groups.add(child.pid);
    let output = '', errors = '';
    child.stdout?.on('data', data => { output += data; }); child.stderr?.on('data', data => { errors += data; });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => { children.delete(child); if (!service && child.pid) groups.delete(child.pid); code === 0 ? resolve(output) : reject(new Error(`Account fixture command exited ${code}: ${errors}`)); });
    });
    if (service) { done.then(() => { if (!stopping) void stop().then(() => { process.exitCode = 1; }); }, error => { if (!stopping) { console.error(error); void stop().then(() => { process.exitCode = 1; }); } }); return child; }
    return done;
  };
  const ready = async url => {
    const deadline = Date.now() + 120000;
    while (!stopping && Date.now() < deadline) {
      try {
        const ok = url.startsWith('https:') ? await new Promise(resolve => { const request = get(url, { rejectUnauthorized: false }, response => { response.resume(); resolve(response.statusCode === 200); }); request.on('error', () => resolve(false)); request.setTimeout(1000, () => request.destroy()); }) : (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
        assertRunning(stopping);
        if (ok) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Account fixture not ready: ${url}`);
  };
  try {
    assertRunning(stopping);
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, root, persistRoot }), { mode: 0o600 });
    await assertPortsFree();
    state = await prepareAccountState(persistRoot);
    if (stopping) { await state.cleanup(); throw new Error('Account fixture shutdown requested'); }
    const configs = [];
    const snapshot = path.join(persistRoot, 'private-config');
    await mkdir(snapshot, { recursive: true, mode: 0o700 });
    for (const [index, folder] of ['api', 'auth', 'auth-hash'].entries()) {
      const file = path.join(state.temporary, `${folder}.toml`);
      await writeFile(file, candidateConfig(sources[index], { root, folder, role: index === 0 ? 'api' : 'service', secret: state.secret }), { mode: 0o600 }); configs.push(file);
      await writeFile(path.join(snapshot, `${folder}.toml`), await readFile(file), { mode: 0o600 });
    }
    const d1 = ['exec', 'wrangler', 'd1'];
    const dbArgs = ['DB', '--config', configs[0], '--local', '--persist-to', state.persist];
    await run([...d1, 'migrations', 'apply', ...dbArgs]);
    const query = async sql => {
      const output = await run([...d1, 'execute', ...dbArgs, '--command', sql, '--json'], { capture: true });
      return JSON.parse(output).flatMap(result => result.results || []);
    };
    const columns = (await query('PRAGMA table_info(live_games)')).map(row => row.name);
    const hasCutover = (await query("SELECT name FROM sqlite_master WHERE type='table' AND name='account_cutover'")).length > 0;
    const cutover = hasCutover ? (await query('SELECT activated_at,maintenance FROM account_cutover WHERE singleton=1'))[0] : null;
    const { tsImport } = await import('tsx/esm/api');
    const { createInitialGame } = await tsImport(path.join(root, 'packages/api-handler/src/shell-live-core.ts'), import.meta.url);
    const fixture = createInitialGame({ gameId: 'cutover-legacy-fixture', identityId: 'cutover-legacy-owner', selfPlayMode: true });
    fixture.inviteTokens.player1 = 'cutover-legacy-invite';
    const seed = legacySeedSql({ fixture, columns, cutover });
    if (seed) { const file = path.join(state.temporary, 'legacy.sql'); await writeFile(file, seed, { mode: 0o600 }); await run([...d1, 'execute', ...dbArgs, '--file', file]); }
    run(['exec', 'wrangler', 'dev', ...configs.flatMap(file => ['--config', file]), '--local', '--port', String(PORTS.api), '--inspector-port', String(PORTS.apiInspector), '--persist-to', state.persist], { service: true });
    await ready(`http://127.0.0.1:${PORTS.api}/api/health`);
    assertRunning(stopping);
    let busy = false;
    control = createServer(async (request, response) => {
      const operation = selectAccountControl({ method: request.method, url: request.url, origin: request.headers.origin, hasCutover, simplifiedAccounts });
      if (!operation.sql) { response.writeHead(operation.status).end(operation.message); return; }
      if (busy) { response.writeHead(409).end(); return; }
      busy = true;
      try {
        await query(operation.sql);
        if (request.url !== '/reset-limits') {
          const row = (await query("SELECT activated_at,maintenance,(SELECT username_canonical FROM accounts WHERE account_id=canary_account_id) AS canary FROM account_cutover WHERE singleton=1"))[0];
          if (!row || row.activated_at == null || row.canary !== 'validation_canary' || row.maintenance !== (request.url === '/activate-cutover' ? 1 : 0)) { response.writeHead(409).end('Acknowledged validation canary required'); return; }
        }
        response.writeHead(200).end('done');
      }
      catch { response.writeHead(500).end('Local fixture operation failed'); }
      finally { busy = false; }
    });
    await new Promise((resolve, reject) => { control.once('error', reject); control.listen(PORTS.control, '127.0.0.1', resolve); });
    run(['exec', 'wrangler', 'pages', 'dev', '.', '--port', String(PORTS.web), '--local-protocol', 'https', '--inspector-port', String(PORTS.webInspector)], { cwd: path.join(root, 'apps/web'), service: true });
    await ready(`https://127.0.0.1:${PORTS.web}`);
    assertRunning(stopping);
    return { stop, origin: `https://127.0.0.1:${PORTS.web}`, persist: state.persist };
  } catch (error) { await stop(); await state?.cleanup(); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let stack, stop, signalled = false;
  const shutdown = () => { signalled = true; void stop?.(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  try { stack = await startAccountStack({ onStopReady(value) { stop = value; if (signalled) void stop(); } }); if (signalled) await stack.stop(); else console.log(`[validation-account] Ready at ${stack.origin}`); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
