import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { configureCheckout, updateEnvironment, validateCertificate } from '../../../scripts/setup-local-https.mjs';

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

test('local HTTPS validates all loopback names, lifetime and private-key match', t => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'righelt-https-cert-test-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const generate = (name, san) => {
    const config = path.join(temporary, `${name}.cnf`);
    const key = path.join(temporary, `${name}.key`);
    const cert = path.join(temporary, `${name}.pem`);
    writeFileSync(config, `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=${san}\n`);
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
});
