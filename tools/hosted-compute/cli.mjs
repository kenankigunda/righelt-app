import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qualifyPilot } from './report.mjs';
import { validateScientificAdmission } from './experiment.mjs';
import { backupCollection,restoreBackup,collectAccepted } from './backup-client.mjs';
import { operatorVault,operatorEncryption,operatorSecret } from './operator-credentials.mjs';
import { Client } from './client.mjs';
import {manualStartupArgv} from './manual-start.mjs';
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
async function privateJson(file) {
  const parent=await fs.stat(path.dirname(file));
  assert((parent.mode&0o022)===0,'operator file directory cannot be writable by other users');
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const info=await handle.stat();assert(info.isFile()&&(info.mode&0o077)===0,'private regular operator file required');try{return JSON.parse(await handle.readFile());}catch{throw Error('invalid private operator JSON');}}
  finally{await handle.close();}
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
export async function main(argv = process.argv.slice(2), env = process.env, services = {}) {
  const [command, subject, ...rest] = argv, options = {};
  assert(rest.length % 2 === 0, 'options require values');
  for (let i = 0; i < rest.length; i += 2) options[rest[i]] = rest[i + 1];
  if(command==='qualify')return qualifyPilot(JSON.parse(await fs.readFile(subject)));
  if (command === 'plan') {
    const manifest = validateManifest(JSON.parse(await fs.readFile(subject)));
    return { manifest, manifestSha256: await sha256(encode(canonical(manifest))), spendingAuthorized: false,
      runpodCashCeilingCents: POLICY.pilotCents, cloudflareCashCeilingCents: POLICY.cloudflareCents };
  }
  const manifest = ['submit','manual-stage'].includes(command) ? validateManifest(JSON.parse(await fs.readFile(subject))) : null;
  const id = manifest?.id ?? subject; assert(safeName(id), 'campaign ID required');
  if(['backup','restore','accepted','backup-status','backup-abort'].includes(command)){
    const vault=await (services.operatorVault??operatorVault)(env);
    if(command==='backup-status')return vault.exclusive(()=>vault.catalog());
    if(command==='backup-abort')return vault.exclusive(()=>vault.abort());
    if(command==='accepted'){assert(options['--out'],'--out required');return collectAccepted(vault,path.resolve(options['--out']));}
    let encryption;
    try{
      let lineageRecovery,lineageScope;
      if(options['--lineage-scope']||options['--lineage-version']){
        assert(options['--recovery-evidence'],'--recovery-evidence required for off-Mac lineage recovery');
        encryption=await (services.operatorEncryption??operatorEncryption)(env);
        const recoveryEvidence=await privateJson(options['--recovery-evidence']);
        if(options['--lineage-scope'])lineageScope=await privateJson(options['--lineage-scope']);
        const expectedVersion=lineageScope?.lineageVersion??options['--lineage-version'];
        lineageRecovery={encryption:encryption.encryption,expectedVersion,recoveryEvidence};
      }
      if(command==='backup'){
        assert(options['--collection'],'--collection required');const directory=path.resolve(options['--collection']),receipt=await verifyCollection(directory);
        return await (services.backupCollection??backupCollection)(vault,directory,receipt,{acceptedOutput:options['--accepted-output'],lineageScope,lineageEncryption:encryption?.encryption,lineageRecovery});
      }
      assert(options['--root']&&options['--download']&&options['--out'],'--root, --download and --out required');
      return await (services.restoreBackup??restoreBackup)(vault,options['--root'],path.resolve(options['--download']),path.resolve(options['--out']),{lineageRecovery});
    }finally{encryption?.release();}
  }
  const adminBytes=env.COMPUTE_ADMIN_TOKEN?null:await (services.operatorSecret??operatorSecret)('admin-token');
  let client;
  try{client = new Client({ id, url: env.COMPUTE_URL, token: env.COMPUTE_ADMIN_TOKEN??adminBytes.toString(),...(services.fetcher?{fetcher:services.fetcher}:{}) });}
  finally{adminBytes?.fill(0);}
  if(command==='actual-spend-reconcile'){
    assert(options['--receipt'],'private --receipt reference required');
    return client.json('actual-spend-reconcile',await privateJson(path.resolve(options['--receipt'])));
  }
  if(command==='manual-prepare'){
    assert(options['--intent']&&options['--bootstrap'],'private --intent and exclusive --bootstrap required');
    const intent=await privateJson(path.resolve(options['--intent']));
    const out=path.resolve(options['--bootstrap']);
    const parent=await fs.lstat(path.dirname(out));assert(parent.isDirectory()&&!parent.isSymbolicLink()&&(parent.mode&0o077)===0,'private bootstrap directory required');
    const result=await client.json('manual-prepare',intent);
    assert(typeof result.workerToken==='string'&&/^[a-f0-9]{64}$/.test(result.workerToken),'manual bootstrap response invalid');
    await durableWrite(out,encode(canonical({intentSha256:result.intentSha256,workdir:'/workspace/righelt',argv:manualStartupArgv(),env:{COMPUTE_URL:env.COMPUTE_URL,COMPUTE_ID:id,COMPUTE_GENERATION:String(result.generation),COMPUTE_WORKER_TOKEN:result.workerToken,COMPUTE_MANUAL_READY_UNTIL:String(Math.min(intent.createdAt+300000,intent.expiresAt))}})+'\n'));
    await syncDirectory(path.dirname(out));
    return {intentSha256:result.intentSha256,generation:result.generation,bootstrapFile:out};
  }
  if(command==='manual-attach'){
    assert(options['--attachment'],'private --attachment required');return client.json('manual-attach',await privateJson(path.resolve(options['--attachment'])));
  }
  if (['submit','manual-stage'].includes(command)) {
    assert(options['--inputs'], '--inputs checkout directory required');
    const root = await fs.realpath(options['--inputs']);
    // Validate all local inputs before staging anything remotely.
    for (const a of manifest.inputs) {
      const bytes = await fs.readFile(await containedFile(root, a.path));
      assert(bytes.length === a.bytes && await sha256(bytes) === a.sha256, 'prepared input identity mismatch');
    }
    if(manifest.purpose==='scientific-comparison')await validateScientificAdmission(manifest,{read:async input=>fs.readFile(await containedFile(root,input.path))});
    await client.request('manifest', 'PUT', manifest);
    for (const a of manifest.inputs) await client.upload(await fs.readFile(await containedFile(root, a.path)));
    return command==='manual-stage'?client.json('status'):client.json('start', {});
  }
  if (command === 'logs') {
    const status = await client.json('logs');
    return { ...status, logTail: status.latestLog ? new TextDecoder().decode(await client.download(status.latestLog)) : '' };
  }
  if (command === 'status') return client.json('status');
  if (command === 'attempt-binding') return client.json('attempt-binding');
  if (command === 'actual-spend-binding') return client.json('actual-spend-binding');
  if (command === 'cancel') return client.json('cancel', {});
  if (command === 'collect') { assert(options['--out'], '--out new directory required'); return collect(client, path.resolve(options['--out'])); }
  if (command === 'clear') { assert(options['--collection']&&options['--backup-attestation'], '--collection and --backup-attestation required'); const receipt=await verifyCollection(path.resolve(options['--collection']));receipt.backup=JSON.parse(await fs.readFile(options['--backup-attestation']));return client.json('clear',receipt); }
  throw Error('Usage: plan MANIFEST | submit MANIFEST --inputs CHECKOUT | status ID | logs ID | cancel ID | collect ID --out DIR | clear ID --collection DIR');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n')).catch(error => {
    process.stderr.write(`${error.message}\n`); process.exitCode = 1;
  });
}
