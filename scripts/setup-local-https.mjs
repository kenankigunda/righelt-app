import { execFileSync } from 'node:child_process';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const START = '# BEGIN Righelt local HTTPS';
const END = '# END Righelt local HTTPS';
const VARIABLES = ['WRANGLER_HTTPS_CERT_PATH', 'WRANGLER_HTTPS_KEY_PATH'];
export const defaultCertificateDirectory = () => path.join(os.homedir(), '.config', 'righelt', 'https');

export function validateCertificate(certPem, keyPem, now = Date.now()) {
  const cert = new X509Certificate(certPem);
  if (Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) < now + 30 * 86400_000) {
    throw Error('Local certificate is not valid for the next 30 days. Run setup:https --renew.');
  }
  if (!cert.checkHost('localhost') || !cert.checkIP('127.0.0.1') || !cert.checkIP('::1')) {
    throw Error('Local certificate must cover localhost, 127.0.0.1 and ::1. Run setup:https --renew.');
  }
  if (!cert.checkPrivateKey(createPrivateKey(keyPem))) throw Error('Local certificate and private key do not match.');
  return cert;
}

export function updateEnvironment(source, certDirectory) {
  // Keep dotenv expansion unambiguous, including on Windows and paths with spaces.
  const values = ['localhost.pem', 'localhost-key.pem'].map(name => path.join(certDirectory, name).replaceAll('\\', '/'));
  if (values.some(value => /[\r\n"$`]/.test(value))) throw Error('Certificate path contains unsupported dotenv characters.');
  const starts = source.split(START).length - 1;
  const ends = source.split(END).length - 1;
  if (starts !== ends || starts > 1 || (starts && source.indexOf(END) < source.indexOf(START))) {
    throw Error('Malformed Righelt HTTPS block; refusing to change the environment file.');
  }
  const outside = starts ? source.slice(0, source.indexOf(START)) + source.slice(source.indexOf(END) + END.length) : source;
  if (VARIABLES.some(name => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`, 'm').test(outside))) {
    throw Error('An existing custom HTTPS certificate is configured; refusing to replace it.');
  }
  const block = [START, ...VARIABLES.map((name, index) => `${name}="${values[index]}"`), END].join('\n');
  if (starts) return source.slice(0, source.indexOf(START)) + block + source.slice(source.indexOf(END) + END.length);
  return source + (source && !source.endsWith('\n') ? '\n' : '') + block + '\n';
}

export function configureCheckout(root, certDirectory) {
  const folders = [root, path.join(root, 'apps', 'web'), path.join(root, 'apps', 'api')];
  // Preflight all files before writing any of them. Never follow an environment-file symlink.
  const changes = folders.filter(folder => existsSync(path.join(folder, folder === root ? 'package.json' : 'wrangler.toml'))).map(folder => {
    const file = path.join(folder, '.env.local');
    const defaults = path.join(folder, '.env');
    if (existsSync(defaults)) {
      const source = readFileSync(defaults, 'utf8');
      if (VARIABLES.some(name => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`, 'm').test(source))) {
        throw Error(`An existing custom HTTPS certificate is configured in ${defaults}; refusing to override it.`);
      }
    }
    let source = '';
    try {
      if (!lstatSync(file).isFile()) throw Error(`Refusing non-regular environment file: ${file}`);
      source = readFileSync(file, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const tracked = execFileSync('git', ['ls-files', '--', file], { cwd: root, encoding: 'utf8' }).trim();
    if (tracked) throw Error(`Refusing tracked environment file: ${file}`);
    execFileSync('git', ['check-ignore', '--quiet', file], { cwd: root });
    return { file, source, next: updateEnvironment(source, certDirectory) };
  });
  for (const { file, source, next } of changes) {
    if (source !== next) writeFileSync(file, next, { mode: 0o600 });
  }
  return changes.map(change => change.file);
}

export function setupLocalHttps(args = process.argv.slice(2)) {
  let root = path.resolve(import.meta.dirname, '..');
  let certDirectory = defaultCertificateDirectory();
  let allWorktrees = false;
  let renew = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--all-worktrees') allWorktrees = true;
    else if (arg === '--renew') renew = true;
    else if (arg === '--root' || arg === '--cert-dir') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw Error(`${arg} requires a path.`);
      if (arg === '--root') root = path.resolve(value);
      else certDirectory = path.resolve(value);
    } else if (arg === '--help') {
      console.log('Usage: pnpm setup:https [--all-worktrees] [--renew] [--root PATH] [--cert-dir PATH]\nCreates/reuses a local certificate and configures ignored Wrangler .env.local files.\nDoes not install trust, restart servers, or enable HTTPS on existing HTTP servers.');
      return;
    } else throw Error(`Unknown argument: ${arg}`);
  }
  const certFile = path.join(certDirectory, 'localhost.pem');
  const keyFile = path.join(certDirectory, 'localhost-key.pem');
  if (renew || (!existsSync(certFile) && !existsSync(keyFile))) {
    mkdirSync(certDirectory, { recursive: true, mode: 0o700 });
    execFileSync('mkcert', ['-cert-file', certFile, '-key-file', keyFile, 'localhost', '127.0.0.1', '::1'], { stdio: 'inherit' });
  }
  if (!existsSync(certFile) || !existsSync(keyFile)) throw Error('Incomplete certificate pair. Run setup:https --renew.');
  const cert = validateCertificate(readFileSync(certFile), readFileSync(keyFile));
  chmodSync(keyFile, 0o600);
  const roots = allWorktrees
    ? execFileSync('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(field => field.startsWith('worktree ')).map(field => field.slice(9))
    : [root];
  let failed = false;
  for (const checkout of roots) {
    // The released validation installation is managed separately and stays pinned.
    if (path.basename(checkout) === 'righelt-validation-tools') continue;
    try {
      configureCheckout(checkout, certDirectory);
      console.log(`Configured local HTTPS: ${checkout}`);
    } catch (error) { failed = true; console.error(`${checkout}: ${error.message}`); }
  }
  console.log(`Certificate expires: ${cert.validTo}\nTrust the mkcert CA once on this computer, then restart local HTTPS servers.\nNew worktrees: rerun setup:https --all-worktrees. HTTP and hosted deployments are unchanged.`);
  if (failed) throw Error('Some checkouts could not be configured; existing custom settings were preserved.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { setupLocalHttps(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
