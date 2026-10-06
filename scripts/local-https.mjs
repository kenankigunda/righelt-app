import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { expand } from 'dotenv-expand';
import { X509Certificate } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { connect } from 'node:tls';
import { HTTPS_VARIABLES, defaultCertificateDirectory, validateCertificate } from './local-https-certificate.mjs';
export { HTTPS_VARIABLES } from './local-https-certificate.mjs';

// Match Wrangler's file order and process-environment precedence. Never export
// unrelated dotenv values or override a custom certificate with the shared pair.
export function localHttpsEnvironment({ cwd, env = process.env, certDirectory = defaultCertificateDirectory(), required = !env.CI, trustCheck = verifySystemTrust } = {}) {
  const files = ['.env', '.env.local'];
  if (env.CLOUDFLARE_ENV) files.push(`.env.${env.CLOUDFLARE_ENV}`, `.env.${env.CLOUDFLARE_ENV}.local`);
  const configured = {};
  for (const name of files) {
    const file = path.join(cwd, name);
    if (existsSync(file)) Object.assign(configured, parse(readFileSync(file, 'utf8')));
  }
  // Expand in a private environment so secrets never mutate process.env.
  const expanded = expand({ parsed: configured, processEnv: { ...env } }).parsed;
  Object.assign(configured, expanded, env);
  const hasCustom = HTTPS_VARIABLES.some(name => Object.hasOwn(configured, name));
  if (!hasCustom && env.CI) return { ...env };
  const values = hasCustom ? HTTPS_VARIABLES.map(name => configured[name]) :
    ['localhost.pem', 'localhost-key.pem'].map(name => path.join(certDirectory, name));
  if (!hasCustom && !required && values.every(file => !existsSync(file))) return { ...env };
  if (values.some(value => !value)) throw Error('Configure both WRANGLER_HTTPS_CERT_PATH and WRANGLER_HTTPS_KEY_PATH.');
  const paths = values.map(value => path.resolve(cwd, value));
  if (paths.some(file => !existsSync(file))) throw Error('Local HTTPS certificate files are missing. Run pnpm setup:https.');
  validateCertificate(...paths.map(file => readFileSync(file)));
  if (required && !env.CI && process.platform === 'darwin') {
    try { trustCheck(paths[0]); }
    catch (error) { throw Error('macOS certificate trust verification failed. Run pnpm setup:https --check; install the issuing CA trust (pnpm setup:https --install-trust for the shared mkcert certificate).', { cause: error }); }
  }
  return { ...env, ...Object.fromEntries(HTTPS_VARIABLES.map((name, index) => [name, paths[index]])) };
}

export function validateIssuer(certPem, caPem, now = Date.now()) {
  const cert = new X509Certificate(certPem);
  const ca = new X509Certificate(caPem);
  if (!ca.ca || !cert.checkIssued(ca) || !cert.verify(ca.publicKey)) {
    throw Error('The local certificate was issued by a different CA. Run pnpm setup:https --renew, then install trust for the current mkcert CA.');
  }
  if (Date.parse(ca.validFrom) > now || Date.parse(ca.validTo) < now) throw Error('The mkcert CA has expired or is not yet valid.');
  return cert;
}

export function verifySystemTrust(certFile, hostname = 'localhost') {
  if (process.platform === 'darwin') {
    execFileSync('security', ['verify-cert', '-c', certFile, '-p', 'ssl', '-s', hostname], { stdio: 'pipe' });
  } else {
    throw Error('System trust must be verified against a running server with setup:https --check --url URL on this platform.');
  }
}

export async function verifyLocalHttpsUrl(value, certPem) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw Error('HTTPS verification requires a loopback HTTPS URL without credentials.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  // Inspect the served certificate separately from the strict trust check below.
  const served = await new Promise((resolve, reject) => {
    const socket = connect({ host: hostname, port: Number(url.port || 443), servername: hostname === 'localhost' ? hostname : undefined, rejectUnauthorized: false });
    socket.setTimeout(5000, () => socket.destroy(Error('TLS inspection timed out.')));
    socket.once('error', reject);
    socket.once('secureConnect', () => { const raw = socket.getPeerCertificate().raw; socket.end(); resolve(raw); });
  });
  if (!served || new X509Certificate(served).fingerprint256 !== new X509Certificate(certPem).fingerprint256) {
    throw Error('The server is presenting a different certificate. Restart that HTTPS server with the current local HTTPS configuration.');
  }
  // curl uses the platform trust store; do not supply a CA or a bypass flag.
  const curlEnv = { ...process.env };
  for (const name of ['CURL_CA_BUNDLE', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) delete curlEnv[name];
  await promisify(execFile)('curl', ['--disable', '--noproxy', '*', '--silent', '--show-error', '--max-time', '10', '--output', process.platform === 'win32' ? 'NUL' : '/dev/null', url.href], { env: curlEnv });
}
