import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { candidateConfig, prepareAccountState, legacySeedSql, assertPortsFree } from '../account-stack.mjs';

test('candidate config retains bindings and resolves paths without touching candidate source', () => {
  const source = 'name = "righelt-api"\nmain = "index.js"\n[vars]\nAUTH_ENABLED = "false"\n[[services]]\nbinding = "HASH_SERVICE"\nservice = "righelt-auth"\n[[d1_databases]]\nbinding = "DB"\ndatabase_id = "production"\nmigrations_dir = "../../db/migrations"\n';
  const result = candidateConfig(source, { root: '/candidate with spaces', folder: 'api', role: 'api', secret: 'secret' });
  assert.match(result, /main = "\/candidate with spaces\/apps\/api\/index.js"/);
  assert.match(result, /migrations_dir = "\/candidate with spaces\/db\/migrations"/);
  assert.match(result, /service = "righelt-validation-account-admission"/);
  assert.match(result, /database_id = "local-validation-account-v1"/);
  assert.match(result, /AUTH_ENABLED = "true"/);
  assert.match(result, /AUTH_ALLOWED_ORIGINS = "https:\/\/127.0.0.1:9988"/);
  assert.match(source, /AUTH_ENABLED = "false"/);
  assert.throws(() => candidateConfig(source.replace('AUTH_ENABLED = "false"', 'AUTH_ENABLED = "true"'), { root: '/x', folder: 'api', role: 'api' }), /Unsupported/);
});

test('key and database survive configuration cleanup and later stages with private permissions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'account-stack-test-'));
  try {
    const first = await prepareAccountState(root);
    await writeFile(path.join(first.persist, 'retained-db'), 'account-session-and-preferences');
    await first.cleanup();
    await assert.rejects(stat(first.temporary), { code: 'ENOENT' });
    const next = await prepareAccountState(root);
    assert.equal(next.secret, first.secret);
    assert.equal(await readFile(path.join(next.persist, 'retained-db'), 'utf8'), 'account-session-and-preferences');
    assert.equal((await stat(path.join(root, 'hmac-v1.key'))).mode & 0o777, 0o600);
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    await next.cleanup();
    await writeFile(path.join(root, 'hmac-v1.key'), 'corrupt');
    await assert.rejects(prepareAccountState(root), /refusing session invalidation/);
    await assert.rejects(prepareAccountState('relative'), /absolute private path/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy seed is schema-aware and repeatable without changing retained history or invites', () => {
  const fixture = { id: 'cutover-legacy-fixture', createdAt: 'before', updatedAt: 'before', name: "O'Brien" };
  const columns = ['game_id', 'created_at', 'updated_at', 'state_json'];
  const sql = legacySeedSql({ fixture, columns });
  assert.doesNotMatch(sql, /event_seq/);
  assert.equal(legacySeedSql({ fixture, columns, cutover: { activated_at: 1, maintenance: 0 } }), '');
  assert.equal(legacySeedSql({ fixture, columns, cutover: { activated_at: null, maintenance: 1 } }), '');
  assert.throws(() => legacySeedSql({ fixture, columns: [] }), /Unsupported legacy schema/);
  const script = `import sqlite3,sys,json\ndb=sqlite3.connect(':memory:')\ndb.executescript('CREATE TABLE live_games(game_id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, state_json TEXT); CREATE TABLE live_invites(token TEXT PRIMARY KEY,game_id TEXT,shared_by_role TEXT);')\nsql=sys.stdin.read()\ndb.executescript(sql)\ndb.execute("UPDATE live_games SET state_json='retained-history'")\ndb.executescript(sql)\nprint(json.dumps([db.execute('SELECT state_json FROM live_games').fetchall(),db.execute('SELECT count(*) FROM live_invites').fetchone()]))`;
  const result = spawnSync('python3', ['-c', script], { input: sql, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [[['retained-history']], [1]]);
});

test('occupied ports are rejected without closing the other service', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await assert.rejects(assertPortsFree([server.address().port]), { code: 'EADDRINUSE' }); assert.equal(server.listening, true); }
  finally { await new Promise(resolve => server.close(resolve)); }
});

test('candidate-root conflict is rejected and shared validation root is honored', async () => {
  const { resolveCandidateRoot } = await import('../account-stack.mjs');
  assert.equal(resolveCandidateRoot({ RIGHELT_VALIDATION_TARGET_ROOT: '/candidate' }), '/candidate');
  assert.equal(resolveCandidateRoot({ RIGHELT_VALIDATION_TARGET_ROOT: '/candidate', RIGHELT_ACCOUNT_CANDIDATE_ROOT: '/candidate/.' }), '/candidate');
  assert.throws(() => resolveCandidateRoot({ RIGHELT_VALIDATION_TARGET_ROOT: '/candidate', RIGHELT_ACCOUNT_CANDIDATE_ROOT: '/other' }), /Conflicting/);
});

test('late successful readiness cannot create resources after shutdown', async () => {
  const { assertRunning } = await import('../account-stack.mjs');
  let stopping = false, release, created = false;
  const readiness = new Promise(resolve => { release = resolve; });
  const pending = (async () => { await readiness; assertRunning(stopping); created = true; })();
  stopping = true; release(true);
  await assert.rejects(pending, /shutdown requested/);
  assert.equal(created, false);
});

test('cleanup escalates surviving group even when its leader has already exited', async () => {
  const { terminateProcessGroup } = await import('../account-stack.mjs');
  let clock = 0, alive = true;
  const signals = [];
  await terminateProcessGroup(123, {
    now: () => clock, graceMs: 50, pause: async ms => { clock += ms; },
    kill: (pid, signal) => {
      assert.equal(pid, -123); signals.push(signal);
      if (!alive) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      if (signal === 'SIGKILL') alive = false;
    },
  });
  assert.equal(signals[0], 'SIGTERM');
  assert.ok(signals.includes('SIGKILL'));
  assert.equal(signals.at(-1), 0);
});
