import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'node:https';
import { configureCheckout, updateEnvironment, validateCertificate } from '../../../scripts/setup-local-https.mjs';
import { localHttpsEnvironment, validateIssuer, verifyLocalHttpsUrl } from '../../../scripts/local-https.mjs';

test('local HTTPS environment preserves unrelated settings and reruns without changes', () => {
  const initial = '# existing\nAPI_TOKEN=keep-me\n';
  const once = updateEnvironment(initial, '/private/certs with spaces');
  assert.ok(once.startsWith(initial));
  assert.match(once, /WRANGLER_HTTPS_CERT_PATH="\/private\/certs with spaces\/localhost.pem"/);
  assert.equal(updateEnvironment(once, '/private/certs with spaces'), once);
  const moved = updateEnvironment(once, '/private/renewed');
  assert.ok(!moved.includes('certs with spaces'));
  assert.ok(moved.startsWith(initial));
});

test('local HTTPS refuses custom certificates, malformed blocks and ambiguous paths', () => {
  for (const source of ['WRANGLER_HTTPS_CERT_PATH=custom', 'export WRANGLER_HTTPS_KEY_PATH=custom', '# BEGIN Righelt local HTTPS', '# END Righelt local HTTPS\n# BEGIN Righelt local HTTPS']) {
    assert.throws(() => updateEnvironment(source, '/tmp/certs'));
  }
  for (const value of ['/tmp/$HOME', '/tmp/new\nline', '/tmp/quote"']) {
    assert.throws(() => updateEnvironment('', value));
  }
});

test('local HTTPS configures separate checkout roots without tracking certificates or overwriting settings', t => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'righelt-https-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  for (const name of ['first', 'second']) {
    const root = path.join(temporary, name);
    mkdirSync(path.join(root, 'apps/web'), { recursive: true });
    mkdirSync(path.join(root, 'apps/api'), { recursive: true });
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(path.join(root, '.gitignore'), '.env.local\n');
    writeFileSync(path.join(root, 'package.json'), '{}');
    writeFileSync(path.join(root, 'apps/web/wrangler.toml'), '');
    writeFileSync(path.join(root, 'apps/api/wrangler.toml'), '');
    writeFileSync(path.join(root, 'apps/web/.env.local'), 'EXISTING=yes\n');
    const files = configureCheckout(root, '/shared/certificates');
    assert.equal(files.length, 3);
    for (const file of files) assert.match(readFileSync(file, 'utf8'), /WRANGLER_HTTPS_KEY_PATH="\/shared\/certificates\/localhost-key.pem"/);
    assert.match(readFileSync(files[1], 'utf8'), /^EXISTING=yes\n/);
    assert.ok(!execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).includes('.env.local'));
    const before = readFileSync(files[0], 'utf8');
    writeFileSync(files[2], 'WRANGLER_HTTPS_KEY_PATH=custom\n');
    assert.throws(() => configureCheckout(root, '/new/path'), /existing custom/);
    assert.equal(readFileSync(files[0], 'utf8'), before, 'preflight prevents partial changes within a checkout');
    rmSync(files[2]);
    writeFileSync(path.join(root, 'apps/api/.env'), 'WRANGLER_HTTPS_CERT_PATH=custom\n');
    assert.throws(() => configureCheckout(root, '/new/path'), /refusing to override/);
    assert.equal(readFileSync(files[0], 'utf8'), before);
    rmSync(path.join(root, 'apps/api/.env'));
    symlinkSync(files[0], files[2]);
    assert.throws(() => configureCheckout(root, '/new/path'), /non-regular/);
  }
});

test('local HTTPS validates all loopback names, lifetime and private-key match', async t => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'righelt-https-cert-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const generate = (name, san, ca = false) => {
    const config = path.join(temporary, `${name}.cnf`);
    const key = path.join(temporary, `${name}.key`);
    const cert = path.join(temporary, `${name}.pem`);
    writeFileSync(config, `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=${name}\n[ext]\nsubjectAltName=${san}\n${ca ? 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n' : ''}`);
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '90', '-config', config, '-keyout', key, '-out', cert], { stdio: 'ignore' });
    return [readFileSync(cert), readFileSync(key)];
  };
  const valid = generate('valid', 'DNS:localhost,IP:127.0.0.1,IP:::1');
  const missingIpv6 = generate('missing-ipv6', 'DNS:localhost,IP:127.0.0.1');
  assert.doesNotThrow(() => validateCertificate(...valid));
  assert.throws(() => validateCertificate(...valid, Date.now() + 80 * 86400_000), /30 days/);
  assert.throws(() => validateCertificate(...valid, Date.now() - 86400_000), /30 days/);
  assert.throws(() => validateCertificate(...missingIpv6), /must cover/);
  assert.throws(() => validateCertificate(valid[0], missingIpv6[1]), /do not match/);
  const root = path.join(temporary, 'fresh-checkout');
  mkdirSync(root);
  writeFileSync(path.join(temporary, 'localhost.pem'), valid[0]);
  writeFileSync(path.join(temporary, 'localhost-key.pem'), valid[1]);
  const resolve = (env = {}, extra = {}) => localHttpsEnvironment({ cwd: root, env, certDirectory: temporary, trustCheck: () => {}, ...extra });
  assert.equal(resolve().WRANGLER_HTTPS_CERT_PATH, path.join(temporary, 'localhost.pem'), 'fresh checkout inherits shared files without ignored env files');
  if (process.platform === 'darwin') {
    let checked;
    resolve({}, { trustCheck: file => { checked = file; } });
    assert.equal(checked, path.join(temporary, 'localhost.pem'));
    assert.throws(() => resolve({}, { trustCheck: () => { throw Error('untrusted'); } }), /trust verification failed/);
    assert.doesNotThrow(() => resolve({ CI: '1' }, { trustCheck: () => { throw Error('CI must not check personal trust'); } }));
  }
  assert.equal(resolve({ CI: 'true' }).WRANGLER_HTTPS_CERT_PATH, undefined, 'CI does not pick up personal certificates');
  assert.throws(() => resolve({ WRANGLER_HTTPS_CERT_PATH: 'missing.pem' }), /both/);
  assert.throws(() => resolve({}, { certDirectory: root }), /files are missing/);
  assert.equal(resolve({}, { certDirectory: root, required: false }).WRANGLER_HTTPS_CERT_PATH, undefined);
  writeFileSync(path.join(root, '.env'), 'WRANGLER_HTTPS_CERT_PATH=../missing-ipv6.pem\nWRANGLER_HTTPS_KEY_PATH=../missing-ipv6.key\n');
  writeFileSync(path.join(root, '.env.local'), 'WRANGLER_HTTPS_CERT_PATH=../valid.pem\nWRANGLER_HTTPS_KEY_PATH=../valid.key\nPRIVATE_VALUE=never-export\n');
  assert.equal(resolve().WRANGLER_HTTPS_KEY_PATH, path.join(temporary, 'valid.key'));
  assert.equal(resolve().PRIVATE_VALUE, undefined);
  writeFileSync(path.join(root, '.env'), 'CERT_DIR=..\n');
  writeFileSync(path.join(root, '.env.local'), 'CERT_DIR=..\nWRANGLER_HTTPS_CERT_PATH=${CERT_DIR}/valid.pem\nWRANGLER_HTTPS_KEY_PATH=$CERT_DIR/valid.key\n');
  assert.equal(resolve().WRANGLER_HTTPS_KEY_PATH, path.join(temporary, 'valid.key'));
  assert.equal(resolve().CERT_DIR, undefined);
  assert.throws(() => resolve({ WRANGLER_HTTPS_KEY_PATH: '../missing-ipv6.key' }), /do not match/);
  writeFileSync(path.join(root, '.env.preview.local'), 'WRANGLER_HTTPS_CERT_PATH=../missing-ipv6.pem\nWRANGLER_HTTPS_KEY_PATH=../missing-ipv6.key\n');
  assert.throws(() => resolve({ CLOUDFLARE_ENV: 'preview' }), /must cover/);
  assert.throws(() => validateIssuer(valid[0], missingIpv6[0]), /different CA/);
  const ca = generate('ca', 'DNS:ca', true);
  const otherCa = generate('other-ca', 'DNS:other-ca', true);
  execFileSync('openssl', ['req', '-new', '-key', path.join(temporary, 'valid.key'), '-subj', '/CN=localhost', '-out', path.join(temporary, 'leaf.csr')], { stdio: 'ignore' });
  const extensions = path.join(temporary, 'leaf.ext');
  writeFileSync(extensions, 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\nbasicConstraints=CA:FALSE\n');
  const signedFile = path.join(temporary, 'signed.pem');
  execFileSync('openssl', ['x509', '-req', '-in', path.join(temporary, 'leaf.csr'), '-CA', path.join(temporary, 'ca.pem'), '-CAkey', path.join(temporary, 'ca.key'), '-CAcreateserial', '-days', '90', '-extfile', extensions, '-out', signedFile], { stdio: 'ignore' });
  const signed = readFileSync(signedFile);
  assert.doesNotThrow(() => validateIssuer(signed, ca[0]));
  assert.throws(() => validateIssuer(signed, otherCa[0]), /different CA/);
  assert.throws(() => validateIssuer(signed, ca[0], Date.now() + 100 * 86400_000), /expired/);
  assert.throws(() => validateIssuer(signed, ca[0], Date.now() - 86400_000), /not yet valid/);
  const server = createServer({ cert: valid[0], key: valid[1] }, (_, response) => response.end('ok'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `https://127.0.0.1:${server.address().port}`;
  await assert.rejects(verifyLocalHttpsUrl(url, missingIpv6[0]), /different certificate/);
  await assert.rejects(verifyLocalHttpsUrl(url, valid[0]), /SSL certificate|self.signed|certificate verify/i, 'matching files alone must not pass when the CA is untrusted');
  const savedEnv = { HOME: process.env.HOME, CURL_CA_BUNDLE: process.env.CURL_CA_BUNDLE, SSL_CERT_FILE: process.env.SSL_CERT_FILE };
  writeFileSync(path.join(temporary, '.curlrc'), 'insecure\n');
  Object.assign(process.env, { HOME: temporary, CURL_CA_BUNDLE: path.join(temporary, 'valid.pem'), SSL_CERT_FILE: path.join(temporary, 'valid.pem') });
  try {
    await assert.rejects(verifyLocalHttpsUrl(url, valid[0]), /SSL certificate|self.signed|certificate verify/i, 'curl settings and CA overrides cannot turn an untrusted cert into a pass');
  } finally {
    for (const [name, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test('live HTTPS check rejects remote hosts and non-HTTPS URLs before connecting', async () => {
  for (const url of ['http://localhost:1234', 'https://example.com', 'https://user:secret@localhost:1234']) {
    await assert.rejects(verifyLocalHttpsUrl(url, ''), /loopback HTTPS URL/);
  }
});
