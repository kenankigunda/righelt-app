import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm, mkdir, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { candidateConfig, prepareAccountState, legacySeedSql, assertPortsFree } from '../account-stack.mjs';

test('candidate config retains bindings and resolves paths without touching candidate source', () => {
  const source = 'name = "righelt-api"\nmain = "index.js"\n[vars]\nAUTH_ENABLED = "false"\n[[services]]\nbinding = "HASH_SERVICE"\nservice = "righelt-auth"\n[[d1_databases]]\nbinding = "DB"\ndatabase_id = "production"\nmigrations_dir = "../../db/migrations"\n[[durable_objects.bindings]]\nname = "GAME_ROOMS"\nclass_name = "GameRoomDO"\n';
  const result = candidateConfig(source, { root: '/candidate with spaces', folder: 'api', role: 'api', secret: 'secret' });
  assert.match(result, /main = "\/candidate with spaces\/apps\/api\/index.js"/);
  assert.match(result, /migrations_dir = "\/candidate with spaces\/db\/migrations"/);
  assert.match(result, /name = "GAME_ROOMS"/);
  assert.match(result, /name = "righelt-validation-account-api"/);
  assert.match(result, /service = "righelt-validation-account-admission"/);
  assert.match(result, /database_id = "production"/);
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


test('upgrade clones only local D1 once, retains WAL, and privately records source fingerprints', async () => {
  const { initializeAccountUpgrade } = await import('../account-stack.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'account-clone-test-'));
  const sourcePersistRoot = path.join(root, 'guest/api-state'), accountPersistRoot = path.join(root, 'account');
  const d1 = path.join(sourcePersistRoot, 'v3/d1/miniflare-D1DatabaseObject');
  try {
    await mkdir(d1, { recursive: true });
    await writeFile(path.join(d1, 'abc123.sqlite'), 'retained game and history');
    await writeFile(path.join(d1, 'abc123.sqlite-wal'), 'wal');
    await mkdir(path.join(sourcePersistRoot, 'v3/do'), { recursive: true });
    await writeFile(path.join(sourcePersistRoot, 'v3/do/remote-secret'), 'excluded');
    const result = await initializeAccountUpgrade({ sourcePersistRoot, accountPersistRoot });
    assert.equal(result.initialized, true);
    assert.equal(result.provenance.files.length, 2);
    assert.equal(await readFile(path.join(accountPersistRoot, 'state/v3/d1/miniflare-D1DatabaseObject/abc123.sqlite'), 'utf8'), 'retained game and history');
    await assert.rejects(stat(path.join(accountPersistRoot, 'state/v3/do')), { code: 'ENOENT' });
    assert.equal((await stat(path.join(accountPersistRoot, 'state/upgrade-provenance.json'))).mode & 0o777, 0o600);
    await writeFile(path.join(d1, 'abc123.sqlite'), 'later guest state');
    assert.equal((await initializeAccountUpgrade({ sourcePersistRoot, accountPersistRoot })).initialized, false);
    assert.equal(await readFile(path.join(accountPersistRoot, 'state/v3/d1/miniflare-D1DatabaseObject/abc123.sqlite'), 'utf8'), 'retained game and history');
    const badRoot = path.join(root, 'bad'); await mkdir(path.join(badRoot, 'state'), { recursive: true });
    await assert.rejects(initializeAccountUpgrade({ sourcePersistRoot, accountPersistRoot: badRoot }), /Refusing to overwrite/);
    await symlink(path.join(d1, 'abc123.sqlite'), path.join(d1, 'bad.sqlite'));
    await assert.rejects(initializeAccountUpgrade({ sourcePersistRoot, accountPersistRoot: path.join(root, 'symlink-target') }), /Unexpected/);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('cutover controls accept only fixed local POST operations with available schema', async () => {
  const { selectAccountControl } = await import('../account-stack.mjs');
  const choose = overrides => selectAccountControl({ method: 'POST', url: '/activate-cutover', hasCutover: true, ...overrides });
  assert.equal(choose({ origin: 'https://127.0.0.1:9988' }).status, 404);
  assert.equal(choose({ origin: '' }).status, 404);
  assert.equal(choose({ method: 'GET' }).status, 404);
  assert.equal(choose({ url: '/activate-cutover?canary=someone' }).status, 404);
  assert.equal(choose({ url: '/execute' }).status, 404);
  assert.equal(choose({ hasCutover: false }).status, 409);
  assert.equal(choose({ url: '/maintenance-off', hasCutover: false }).status, 409);
  assert.equal(choose({ url: '/reset-limits', hasCutover: false }).sql, 'DELETE FROM account_rate_limits');
  assert.match(choose({}).sql, /username_canonical='validation_canary' AND recovery_acknowledged=1/);
  assert.match(choose({}).sql, /activated_at=COALESCE\(activated_at,/);
  assert.match(choose({}).sql, /account_cutover.canary_account_id=accounts.account_id/);
  assert.match(choose({ url: '/maintenance-off' }).sql, /activated_at IS NOT NULL/);
  const script = `import sqlite3,sys,json\ndb=sqlite3.connect(':memory:')\ndb.executescript("CREATE TABLE accounts(account_id TEXT,username_canonical TEXT,recovery_acknowledged INTEGER); CREATE TABLE account_cutover(singleton INTEGER,activated_at INTEGER,maintenance INTEGER,canary_account_id TEXT); INSERT INTO account_cutover VALUES(1,NULL,0,NULL);")\nsql=sys.stdin.read()\ndb.executescript(sql)\nassert db.execute('SELECT activated_at FROM account_cutover').fetchone()[0] is None\ndb.execute("INSERT INTO accounts VALUES('canary','validation_canary',1)")\ndb.executescript(sql)\nfirst=db.execute('SELECT activated_at,canary_account_id FROM account_cutover').fetchone()\ndb.executescript(sql)\nassert first==db.execute('SELECT activated_at,canary_account_id FROM account_cutover').fetchone()\nprint(first[1])`;
  const result = spawnSync('python3', ['-c', script], { input: choose({}).sql.replace("CAST(unixepoch('subsec')*1000 AS INTEGER)", '12345'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'canary');
});
