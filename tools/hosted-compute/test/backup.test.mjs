import test from 'node:test';
import assert from 'node:assert/strict';
import {BackupVault} from '../backup.mjs';
import {MemoryBucket,MemoryStorage} from './helpers.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
import {operatorAttestation,validateOperatorAttestation} from '../operator-attestation.mjs';
import {backupCollection,restoreBackup} from '../backup-client.mjs';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function point(n){
 const data=new Map();
 const file=async(name,path,raw)=>{const bytes=encode(raw),hash=await sha256(bytes);data.set(hash,bytes);return {name,path,sha256:hash,bytes:bytes.length};};
 const cp=await file('cp',`.ai-runs/a/checkpoints/${n}.pt`,`checkpoint-${n}`),meta=await file('meta',`.ai-runs/a/checkpoints/${n}.json`,'{}'),cursor=await file('cursor',`.ai-runs/a/checkpoints/${n}.runner.json`,'{}'),latest=await file('latest','.ai-runs/a/latest.json',`{"sha256":"${cp.sha256}"}`);
 const files=[cp,meta,cursor,latest];
 const inventory={id:'a',manifest:{inputs:[]},manifestSha256:'m',recoveryPoints:[{id:`s${n}`,files,capturedAt:n}],claims:{uncertain:{generation:1}},counters:{next:17},attempts:[],missingUploads:{},fileHistory:[]};
 return {inventory,selection:{snapshotId:`s${n}`,paths:files.map(f=>f.path),checkpointPath:cp.path,checkpointSha256:cp.sha256},collection:{verified:true,manifestSha256:'m',inventorySha256:await sha256(encode(canonical(inventory)))},data};
}
async function stage(v,p){const root=await v.begin(p.inventory,p.collection,p.selection);for(const a of root.objects)await v.copy(a.sha256,async a=>p.data.get(a.sha256));await v.seal();return root;}
async function restore(v,root){for(const a of root.objects)await v.download(root.id,a.sha256);return v.confirmRestore(root.id,{backupId:root.id,manifestSha256:root.manifestSha256,checkpointSha256:root.checkpointSha256,controlSha256:root.control.sha256,allocationResumed:false,...(root.lineage?{lineageCiphertextSha256:root.lineage.sha256,lineageBindingSha256:(await v.state()).lineageVerified[root.lineage.sha256].lineageBindingSha256}:{})});}

test('backup rotation waits for cloud restoration and keeps exactly two recovery roots',async()=>{
 const bucket=new MemoryBucket(),v=new BackupVault({storage:new MemoryStorage(),bucket});
 const first=await stage(v,await point(1));await assert.rejects(v.permitsClear('a',first.inventorySha256),/backup/);await restore(v,first);
 const second=await stage(v,await point(2));await restore(v,second);
 const third=await stage(v,await point(3));
 assert.deepEqual((await v.state()).roots,[second.id,first.id]);await assert.rejects(v.prune(),/unfinished/);
 await restore(v,third);assert.deepEqual((await v.state()).roots,[third.id,second.id]);
 await v.prune();assert.equal(await bucket.get(`roots/${first.id}`),null);assert((await v.root(second.id)).checkpointSha256);
 await v.permitsClear('a',third.inventorySha256);
});
test('failed copy or interrupted catalog publication never destroys the existing backup',async()=>{
 const storage=new MemoryStorage(),bucket=new MemoryBucket(),v=new BackupVault({storage,bucket});
 const first=await stage(v,await point(1));await restore(v,first);
 const p=await point(2),pending=await v.begin(p.inventory,p.collection,p.selection);
 await assert.rejects(v.copy(pending.files[0].sha256,async()=>encode('corrupt')),/changed/);
 await assert.rejects(v.seal(),/incomplete/);assert.equal((await v.root(first.id)).id,first.id);
 for(const a of pending.objects)await v.copy(a.sha256,async a=>p.data.get(a.sha256));await v.seal();
 const put=bucket.put.bind(bucket);let fail=true;bucket.put=async(k,b)=>{if(k==='index.json'&&fail){fail=false;throw Error('index interrupted');}return put(k,b);};
 await assert.rejects(restore(v,pending),/interrupted/);
 const restarted=new BackupVault({storage,bucket});assert.equal((await restarted.state()).roots[0],pending.id);
 assert((await restarted.root(first.id)).id);await restarted.prune();
});
test('accepted model essentials survive rotation without pinning the old replay bundle',async()=>{
 const bucket=new MemoryBucket(),v=new BackupVault({storage:new MemoryStorage(),bucket}),p=await point(1);
 const bytes=encode('accepted-model'),model={name:'model.onnx',path:'.ai-runs/a/model.onnx',sha256:await sha256(bytes),bytes:bytes.length};
 p.data.set(model.sha256,bytes);p.inventory.fileHistory=[{files:[model]}];
 p.selection.acceptedFiles=[model,p.inventory.recoveryPoints[0].files[1]];
 p.collection.inventorySha256=await sha256(encode(canonical(p.inventory)));
 const first=await stage(v,p);await restore(v,first);
 for(const i of [2,3]){const root=await stage(v,await point(i));await restore(v,root);}
 await v.prune();assert.equal(await bucket.get(`roots/${first.id}`),null);
 assert.deepEqual(await v.downloadAccepted(model.sha256),bytes);
 await assert.rejects(v.downloadAccepted(first.checkpointSha256),/accepted model/);
 assert(await bucket.get(`objects/${model.sha256}`));assert.equal(await bucket.get(`objects/${first.checkpointSha256}`),null);
});

test('re-verifying a retained point does not block resuming another pending backup',async()=>{
 const v=new BackupVault({storage:new MemoryStorage(),bucket:new MemoryBucket()});
 const first=await stage(v,await point(1));await restore(v,first);
 const p=await point(2),pending=await stage(v,p);
 await restore(v,first);assert.equal((await v.pending()).id,pending.id);
 await restore(v,pending);assert.equal((await v.state()).roots[0],pending.id);
});
test('recovery file paths use snapshot bytes while original inputs remain auditable',async()=>{
 const p=await point(1),old=encode('initial-runtime'),newer=encode('recovered-runtime');
 const input={name:'runtime',path:'.ai-runs/a/runtime.json',sha256:await sha256(old),bytes:old.length};
 const updated={...input,sha256:await sha256(newer),bytes:newer.length};
 p.inventory.manifest.inputs=[input];p.inventory.recoveryPoints[0].files.push(updated);p.selection.paths.push(updated.path);
 p.data.set(input.sha256,old);p.data.set(updated.sha256,newer);p.collection.inventorySha256=await sha256(encode(canonical(p.inventory)));
 const v=new BackupVault({storage:new MemoryStorage(),bucket:new MemoryBucket()}),root=await stage(v,p);
 assert.equal(root.files.find(f=>f.path===input.path).sha256,updated.sha256);
 assert(root.objects.some(a=>a.sha256===input.sha256));await restore(v,root);
});

test('operator attestation binds exact inventory and both retained recovery points',async()=>{
 const v=new BackupVault({storage:new MemoryStorage(),bucket:new MemoryBucket()}),p=await point(1);
 const root=await stage(v,p);await restore(v,root);const attestation=await operatorAttestation(v,p.inventory);
 assert.equal(attestation.allocationResumed,false);assert.equal(attestation.roots[0].snapshotId,'s1');
 const expected={campaign:'a',manifestSha256:'m',inventorySha256:p.collection.inventorySha256,recoveryPoints:p.inventory.recoveryPoints};
 assert.equal(validateOperatorAttestation(attestation,expected),attestation);
 for(const changed of [{campaign:'other'},{inventorySha256:'0'.repeat(64)},{allocationResumed:true},{roots:[]},{roots:[{...attestation.roots[0],restoreProofSha256:'incomplete'}]}])assert.throws(()=>validateOperatorAttestation({...attestation,...changed},expected));
 assert.throws(()=>validateOperatorAttestation(attestation,{...expected,recoveryPoints:[...p.inventory.recoveryPoints,{id:'s2'}]}),/omits/);
});

test('accepted lineage remains pinned after its replay root rotates out',async()=>{
 const v=new BackupVault({storage:new MemoryStorage(),bucket:new MemoryBucket()}),p=await point(1),ciphertext=encode('opaque-ciphertext-fixture');
 const ref={schema:1,sha256:await sha256(ciphertext),bytes:ciphertext.length};await v.verifiedPut(`lineage/${ref.sha256}`,ciphertext);
 await v.confirmLineage(ref,{schema:1,ciphertextSha256:ref.sha256,lineageBindingSha256:'c'.repeat(64),cloudRead:true,decrypted:true,relationshipsVerified:true,outsideOriginalMachine:true,recoveryEvidenceSha256:'b'.repeat(64)});
 p.selection.lineage=ref;p.selection.acceptedFiles=[p.inventory.recoveryPoints[0].files[1]];
 const first=await stage(v,p);await restore(v,first);
 const proof=(await v.state()).restored[first.id];await assert.rejects(v.confirmRestore(first.id,{...proof,lineageBindingSha256:'d'.repeat(64)}),/lineage/);
 for(const i of [2,3]){const r=await stage(v,await point(i));await restore(v,r);}
 await v.prune();assert.equal(await v.bucket.get(`roots/${first.id}`),null);assert(await v.bucket.get(`lineage/${ref.sha256}`));
 assert.equal((await v.catalog()).accepted.lineage.sha256,ref.sha256);
});

test('operator client restores solely from cloud after the original collection is removed',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-backup-client-'));
 try{
  const p=await point(1),v=new BackupVault({storage:new MemoryStorage(),bucket:new MemoryBucket()}),collection=path.join(directory,'collection');
  await fs.mkdir(path.join(collection,'objects'),{recursive:true,mode:0o700});
  for(const [hash,bytes] of p.data)await fs.writeFile(path.join(collection,'objects',hash),bytes);
  await fs.writeFile(path.join(collection,'inventory.json'),canonical(p.inventory));
  // Focused wiring proof. Actual Torch/model/RNG restoration is covered by the
  // full workflow integration test; here independently verify fresh bytes.
  const inspector=async args=>{
   if(args[0]==='--collection')return [p.selection];
   const dir=args[1],root=JSON.parse(await fs.readFile(path.join(dir,'backup-root.json'))),out=args[3];
   assert.equal(await fs.stat(out).then(()=>true,()=>false),false);await fs.mkdir(out);
   for(const a of root.objects){const bytes=await fs.readFile(path.join(dir,'objects',a.sha256));assert.equal(bytes.length,a.bytes);assert.equal(await sha256(bytes),a.sha256);}
   return {backupId:root.id,manifestSha256:root.manifestSha256,checkpointSha256:root.checkpointSha256,controlSha256:root.control.sha256,allocationResumed:false};
  };
  const a=await backupCollection(v,collection,p.collection,{inspect:inspector});assert.equal(a.verified,true);
  await fs.rm(collection,{recursive:true});p.data.clear();
  const proof=await restoreBackup(v,a.roots[0].id,path.join(directory,'cloud'),path.join(directory,'empty'),{inspect:inspector});assert.equal(proof.allocationResumed,false);
  const stored=await v.root(a.roots[0].id);await v.bucket.delete(`objects/${stored.checkpointSha256}`);
  await assert.rejects(restoreBackup(v,stored.id,path.join(directory,'bad-download'),path.join(directory,'bad-out'),{inspect:inspector}),/missing/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
