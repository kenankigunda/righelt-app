import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {AgeEncryption,validateLineage,preserveLineage,backupLineage,verifyLineageRecovery} from '../lineage-backup.mjs';
import {BackupVault} from '../backup.mjs';
import {MemoryBucket,MemoryStorage} from './helpers.mjs';
import {backupCollection} from '../backup-client.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const exec=promisify(execFile);
const scope=()=>({schema:1,lineageVersion:'lineage-1',entries:[{sourceId:'original-game',familyId:'original-family',sanitizedSourceIds:['salt-one-source'],sanitizedFamilyIds:['salt-one-family'],ancestorSourceIds:[],exposure:'final'},{sourceId:'original-branch',familyId:'original-family',sanitizedSourceIds:['salt-one-branch'],sanitizedFamilyIds:['salt-one-family'],ancestorSourceIds:['original-game'],exposure:'final'}]});
const recoveryEvidence={schema:1,outsideOriginalMachine:true,keyRecovered:true,reference:'owner-recovery-verification'};

test('minimal lineage rejects metadata creep, missing ancestry, exposure upgrades and new-salt independence',()=>{
 const original=scope();validateLineage(original);
 const updated=structuredClone(original);updated.lineageVersion='lineage-2';updated.entries[0].sanitizedSourceIds.push('salt-two-source');updated.entries[0].sanitizedFamilyIds.push('salt-two-family');preserveLineage(original,updated);
 for(const mutate of [s=>s.accountEmail='private@example',s=>s.entries[0].modelWeights=[1],s=>s.entries[1].familyId='new-independent-family',s=>s.entries[1].ancestorSourceIds=['lost-source'],s=>s.entries[1].exposure='training']){
  const changed=scope();mutate(changed);assert.throws(()=>validateLineage(changed));
 }
 const changed=scope();changed.entries[0].exposure='unknown';changed.entries[1].exposure='training';assert.throws(()=>validateLineage(changed),/whole-family|unknown/);
 const siblings=scope();siblings.entries[1].ancestorSourceIds=[];siblings.entries[1].exposure='training';assert.throws(()=>validateLineage(siblings),/whole-family/);
 const split=scope();split.entries.forEach(e=>e.familyId='new-salt-family');assert.throws(()=>preserveLineage(original,split),/independence/);
});

test('age adapter fails closed without an established encryption executable',async()=>{
 const encryption=new AgeEncryption({binary:'/nonexistent/righelt-age',recipient:'age1test'});
 await assert.rejects(encryption.encrypt(new TextEncoder().encode('sensitive-original-id')),e=>!e.message.includes('sensitive')&&/unavailable/.test(e.message));
});

test('real age cloud recovery rejects wrong key, tamper and stale lineage version',async t=>{
 const binary=process.env.COMPUTE_AGE_BINARY??'age',keygen=process.env.COMPUTE_AGE_KEYGEN_BINARY??'age-keygen';
 try{await exec(binary,['--version']);await exec(keygen,['--version']);}catch{t.skip('age/age-keygen installation is an explicit launch prerequisite');return;}
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-age-test-'));
 try{
  const identity=path.join(directory,'recovered-key'),wrong=path.join(directory,'wrong-key');
  await exec(keygen,['-o',identity]);await exec(keygen,['-o',wrong]);await fs.chmod(identity,0o600);await fs.chmod(wrong,0o600);
  const {stdout}=await exec(keygen,['-y',identity]);const encryption=new AgeEncryption({binary,recipient:stdout.trim(),identityBytes:new Uint8Array(await fs.readFile(identity))});
  const run=encryption.run.bind(encryption);let temporaryIdentity;
  encryption.run=async(args,bytes)=>{if(args[0]==='--decrypt'){temporaryIdentity=args.at(-1);assert.equal((await fs.stat(temporaryIdentity)).mode&0o077,0);}return run(args,bytes);};
  const bucket=new MemoryBucket(),vault=new BackupVault({storage:new MemoryStorage(),bucket});
  const reference=await backupLineage(vault,scope(),encryption,{recoveryEvidence});
  const raw=new Uint8Array(await (await bucket.get(`lineage/${reference.sha256}`)).arrayBuffer());assert(!new TextDecoder().decode(raw).includes('original-game'));
  const recovered=await verifyLineageRecovery(vault,reference,encryption,{expectedVersion:'lineage-1',recoveryEvidence});assert.equal(recovered.scope.entries[0].sourceId,'original-game');
  await assert.rejects(fs.stat(temporaryIdentity),{code:'ENOENT'});
  await assert.rejects(verifyLineageRecovery(vault,reference,new AgeEncryption({binary,identityFile:wrong}),{expectedVersion:'lineage-1',recoveryEvidence}),/failed/);
  await assert.rejects(verifyLineageRecovery(vault,reference,encryption,{expectedVersion:'lineage-2',recoveryEvidence}),/version/);
  raw[raw.length-1]^=1;await bucket.put(`lineage/${reference.sha256}`,raw);
  await assert.rejects(verifyLineageRecovery(vault,reference,encryption,{expectedVersion:'lineage-1',recoveryEvidence}),/changed/);
  // Verify production orchestration holds the same operator lock from the
  // encrypted upload through root restore and pruning. No original map is
  // needed by the empty restore inspector.
  const directory2=path.join(directory,'collection');await fs.mkdir(path.join(directory2,'objects'),{recursive:true});
  const inventory={id:'audit',manifestSha256:'a'.repeat(64),manifest:{inputs:[]},recoveryPoints:[],claims:{},counters:{},attempts:[],missingUploads:{},fileHistory:[],status:{outputs:{}}};
  await fs.writeFile(path.join(directory2,'inventory.json'),canonical(inventory));
  const collection={verified:true,manifestSha256:inventory.manifestSha256,inventorySha256:await sha256(encode(canonical(inventory)))};
  const vault2=new BackupVault({storage:new MemoryStorage(),bucket:new MemoryBucket()});let held=false,lineageWrites=0;
  vault2.exclusive=async fn=>{assert.equal(held,false);held=true;try{return await fn();}finally{held=false;}};
  const put=vault2.bucket.put.bind(vault2.bucket);vault2.bucket.put=async(key,bytes)=>{if(key.startsWith('lineage/')){assert(held);lineageWrites++;}return put(key,bytes);};
  const inspect=async args=>{if(args[0]==='--collection')return [{snapshotId:null,paths:[]}];const root=JSON.parse(await fs.readFile(path.join(args[1],'backup-root.json')));await fs.mkdir(args[3]);return {backupId:root.id,manifestSha256:root.manifestSha256,checkpointSha256:null,controlSha256:root.control.sha256,allocationResumed:false};};
  const options={lineageScope:scope(),lineageEncryption:encryption,lineageRecovery:{recoveryEvidence},inspect};
  const attestation=await backupCollection(vault2,directory2,collection,options);assert(!JSON.stringify(attestation).includes('original-game'));assert.equal(lineageWrites,1);
  await backupCollection(vault2,directory2,collection,options);assert.equal(lineageWrites,1,'retry reuses freshly reverified ciphertext');
  const changed=scope();changed.lineageVersion='different-version';await assert.rejects(backupCollection(vault2,directory2,collection,{...options,lineageScope:changed}),/version/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
