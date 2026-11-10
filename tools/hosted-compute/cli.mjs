import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recommend } from './report.mjs';
import { Client } from './client.mjs';
import { containedFile } from './worker.mjs';
import { POLICY, assert, canonical, encode, safeName, sha256, validateManifest } from './policy.mjs';

async function durableWrite(target, bytes) {
  const file = await fs.open(target, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
async function syncDirectory(target) {
  const directory = await fs.open(target, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
export async function collect(client, out) {
  const inventory = await client.json('inventory');
  await fs.mkdir(out, { recursive: false, mode: 0o700 });
  await fs.mkdir(path.join(out, 'objects'), { mode: 0o700 });
  // Only publish a receipt after every object has been downloaded and re-read.
  for (const a of inventory.objects) {
    const bytes = await client.download(a), target = path.join(out, 'objects', a.sha256);
    await durableWrite(target, bytes);
    assert(await sha256(await fs.readFile(target)) === a.sha256, 'local collection verification failed');
  }
  await syncDirectory(path.join(out, 'objects'));
  await durableWrite(path.join(out, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
  const receipt = { verified: true, manifestSha256: inventory.manifestSha256, inventorySha256: await sha256(encode(canonical(inventory))) };
  await durableWrite(path.join(out, 'collection.json'), JSON.stringify(receipt) + '\n');
  await syncDirectory(out); await syncDirectory(path.dirname(out));
  return { directory: out, objects: inventory.objects.length, ...receipt };
}
export async function verifyCollection(out) {
  const st = await fs.lstat(out); assert(st.isDirectory() && !st.isSymbolicLink(), 'collection directory must be real');
  for (const name of ['objects', 'inventory.json', 'collection.json']) assert(!(await fs.lstat(path.join(out, name))).isSymbolicLink(), 'collection contains a symlink');
  const inventory = JSON.parse(await fs.readFile(path.join(out, 'inventory.json')));
  const receipt = JSON.parse(await fs.readFile(path.join(out, 'collection.json')));
  assert(receipt.inventorySha256 === await sha256(encode(canonical(inventory))), 'local inventory changed');
  for (const a of inventory.objects) {
    assert(/^[a-f0-9]{64}$/.test(a.sha256), 'unsafe inventory hash');
    const target = path.join(out, 'objects', a.sha256), info = await fs.lstat(target);
    assert(info.isFile() && !info.isSymbolicLink() && info.size === a.bytes && await sha256(await fs.readFile(target)) === a.sha256, 'local artifact changed');
  }
  return receipt;
}
export async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, subject, ...rest] = argv, options = {};
  assert(rest.length % 2 === 0, 'options require values');
  for (let i = 0; i < rest.length; i += 2) options[rest[i]] = rest[i + 1];
  if (command === 'compare') {
    assert(options['--against'], '--against report required');
    return recommend([JSON.parse(await fs.readFile(subject)), JSON.parse(await fs.readFile(options['--against']))]);
  }
  if (command === 'plan') {
    const manifest = validateManifest(JSON.parse(await fs.readFile(subject)));
    return { manifest, manifestSha256: await sha256(encode(canonical(manifest))), spendingAuthorized: false,
      pilotCapCents: POLICY.pilotCents, monthlyCeilingCents: POLICY.monthlyCents };
  }
  const manifest = command === 'submit' ? validateManifest(JSON.parse(await fs.readFile(subject))) : null;
  const id = manifest?.id ?? subject; assert(safeName(id), 'campaign ID required');
  const client = new Client({ id, url: env.COMPUTE_URL, token: env.COMPUTE_ADMIN_TOKEN });
  if (command === 'submit') {
    assert(options['--inputs'], '--inputs checkout directory required');
    const root = await fs.realpath(options['--inputs']);
    // Validate all local inputs before staging anything remotely.
    for (const a of manifest.inputs) {
      const bytes = await fs.readFile(await containedFile(root, a.path));
      assert(bytes.length === a.bytes && await sha256(bytes) === a.sha256, 'prepared input identity mismatch');
    }
    await client.request('manifest', 'PUT', manifest);
    for (const a of manifest.inputs) await client.upload(await fs.readFile(await containedFile(root, a.path)));
    return client.json('start', {});
  }
  if (command === 'logs') {
    const status = await client.json('logs');
    return { ...status, logTail: status.latestLog ? new TextDecoder().decode(await client.download(status.latestLog)) : '' };
  }
  if (command === 'status') return client.json('status');
  if (command === 'cancel') return client.json('cancel', {});
  if (command === 'collect') { assert(options['--out'], '--out new directory required'); return collect(client, path.resolve(options['--out'])); }
  if (command === 'clear') { assert(options['--collection'], '--collection directory required'); return client.json('clear', await verifyCollection(path.resolve(options['--collection']))); }
  throw Error('Usage: plan MANIFEST | submit MANIFEST --inputs CHECKOUT | status ID | logs ID | cancel ID | collect ID --out DIR | clear ID --collection DIR');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n')).catch(error => {
    process.stderr.write(`${error.message}\n`); process.exitCode = 1;
  });
}
