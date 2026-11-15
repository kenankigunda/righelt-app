import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {assert,sha256,canonical,encode} from './policy.mjs';
import {operatorAttestation} from './operator-attestation.mjs';
import {backupLineage,verifyLineageRecovery,validateLineage} from './lineage-backup.mjs';
const exec=promisify(execFile);
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
async function python(args){
 const {stdout}=await exec(path.join(source,'tools/ai-trainer/.venv/bin/python'),['-m','righelt_training.backup_closure',...args],{
  cwd:source,env:{PATH:process.env.PATH,PYTHONPATH:path.join(source,'tools/ai-trainer'),RIGHELT_HOSTED:'1'},timeout:60000,maxBuffer:8*1024*1024});
 return JSON.parse(stdout);
}
async function durableWrite(target,bytes){const f=await fs.open(target,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}}
const exclusive=(vault,fn)=>vault.exclusive?vault.exclusive(fn):fn();

async function restore(vault,id,downloadDirectory,restoreDirectory,{lineageRecovery,freshCache,inspect=python}={}){
 const root=await vault.root(id);
 await fs.mkdir(downloadDirectory,{mode:0o700});await fs.mkdir(path.join(downloadDirectory,'objects'),{mode:0o700});
 for(const a of root.objects){
  assert(/^[a-f0-9]{64}$/.test(a.sha256),'unsafe backup object hash');
  let raw;
  if(freshCache?.has(a.sha256))raw=await vault.verifyDownloaded(id,a.sha256,await fs.readFile(freshCache.get(a.sha256)));
  else raw=await vault.download(id,a.sha256);
  assert(raw.length===a.bytes&&await sha256(raw)===a.sha256,'cloud restore checksum mismatch');
  const target=path.join(downloadDirectory,'objects',a.sha256);await durableWrite(target,raw);freshCache?.set(a.sha256,target);
 }
 await durableWrite(path.join(downloadDirectory,'backup-root.json'),canonical(root));
 const proof=await inspect(['--backup',downloadDirectory,'--out',restoreDirectory]);
 if(root.lineage){assert(lineageRecovery,'encrypted lineage recovery configuration required');const recovered=await verifyLineageRecovery(vault,root.lineage,lineageRecovery.encryption,lineageRecovery);proof.lineageCiphertextSha256=root.lineage.sha256;proof.lineageBindingSha256=recovered.proof.lineageBindingSha256;}
 await vault.confirmRestore(id,proof);return proof;
}

export async function restoreBackup(vault,id,downloadDirectory,restoreDirectory,options){return exclusive(vault,()=>restore(vault,id,downloadDirectory,restoreDirectory,options));}

async function collectionInventory(directory,collection){
 const info=await fs.lstat(directory);assert(info.isDirectory()&&!info.isSymbolicLink(),'real collection directory required');
 for(const n of ['inventory.json','objects'])assert(!(await fs.lstat(path.join(directory,n))).isSymbolicLink(),'collection symlink forbidden');
 const inventory=JSON.parse(await fs.readFile(path.join(directory,'inventory.json')));
 assert(collection?.verified===true&&collection.manifestSha256===inventory.manifestSha256&&collection.inventorySha256===await sha256(encode(canonical(inventory))),'verified exact local collection required');
 return inventory;
}
async function localObject(directory,a){
 assert(/^[a-f0-9]{64}$/.test(a.sha256),'unsafe collection object hash');const target=path.join(directory,'objects',a.sha256),info=await fs.lstat(target);
 assert(info.isFile()&&!info.isSymbolicLink()&&info.size===a.bytes,'local collection object changed');const bytes=await fs.readFile(target);assert(await sha256(bytes)===a.sha256,'local collection object changed');return bytes;
}

export async function backupCollection(vault,directory,collection,{acceptedOutput,lineage,lineageScope,lineageEncryption,lineagePrevious,lineageRecovery,inspect=python}={}){
 return exclusive(vault,async()=>{
  const inventory=await collectionInventory(directory,collection),selections=await inspect(['--collection',directory]);
  if(lineageScope){
   validateLineage(lineageScope);assert(lineageEncryption&&lineageRecovery,'encrypted lineage configuration required');
   const status=await vault.catalog(),existing=[status.pending,...status.roots].find(r=>r?.inventorySha256===collection.inventorySha256&&r.lineage);
   if(existing){
    const recovered=await verifyLineageRecovery(vault,existing.lineage,lineageEncryption,{...lineageRecovery,expectedVersion:lineageScope.lineageVersion,previous:lineagePrevious});
    assert(canonical(recovered.scope)===canonical(lineageScope),'lineage scope differs from existing backup');lineage=existing.lineage;
   }else lineage=await backupLineage(vault,lineageScope,lineageEncryption,{...lineageRecovery,previous:lineagePrevious});
   lineageRecovery={...lineageRecovery,encryption:lineageEncryption,expectedVersion:lineageScope.lineageVersion};
  }else if(lineage){
   // A standalone opaque reference is usable only after a new cloud read and
   // decrypt in this operation, never solely from an old state flag.
   assert(lineageRecovery,'encrypted lineage recovery configuration required');
   await verifyLineageRecovery(vault,lineage,lineageRecovery.encryption,lineageRecovery);
  }
  let acceptedFiles,acceptedMetadata;
  if(acceptedOutput){
   const a=inventory.status.outputs[acceptedOutput];assert(a,'accepted output absent');const result=JSON.parse(new TextDecoder().decode(await localObject(directory,a)));
   assert(result.kind==='compute-result'&&result.disposition==='complete','accepted output not verified');
   const receiptFile=inventory.fileHistory.flatMap(h=>h.files).find(f=>f.sha256===a.sha256);assert(receiptFile,'accepted receipt file missing');
   acceptedFiles=[...result.artifacts,receiptFile];acceptedMetadata={manifest:inventory.manifest,output:acceptedOutput,receipt:a};
  }
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-cloud-restore-')),freshCache=new Map();
  try{
   for(let i=0;i<selections.length;i++){
    const selection={...selections[i],...(acceptedFiles?{acceptedFiles,acceptedMetadata}:{}),...(lineage?{lineage}:{})};
    const status=await vault.catalog();let root=status.roots.find(r=>r.inventorySha256===collection.inventorySha256&&r.snapshotId===selection.snapshotId&&canonical(r.lineage??null)===canonical(lineage??null));
    if(!root){
     if(status.pending){assert(status.pending.inventorySha256===collection.inventorySha256&&status.pending.snapshotId===selection.snapshotId&&canonical(status.pending.lineage??null)===canonical(lineage??null),'unfinished backup belongs to another recovery point or lineage');root=status.pending;}
     else root=await vault.begin(inventory,collection,selection);
     for(const a of root.objects)await vault.copy(a.sha256,a=>localObject(directory,a));await vault.seal();
    }
    const proof=await restore(vault,root.id,path.join(temporary,`download-${i}`),path.join(temporary,`empty-checkout-${i}`),{lineageRecovery,freshCache,inspect});
    await durableWrite(path.join(directory,`restore-${crypto.randomUUID()}.json`),canonical(proof)+'\n');
   }
   const attestation=await operatorAttestation(vault,inventory);await vault.prune();
   await durableWrite(path.join(directory,`backup-${crypto.randomUUID()}.json`),canonical(attestation)+'\n');return attestation;
  } finally{await fs.rm(temporary,{recursive:true,force:true});}
 });
}

export async function collectAccepted(vault,out){
 return exclusive(vault,async()=>{
  const {accepted}=await vault.catalog();assert(accepted,'no accepted model is retained');
  await fs.mkdir(out,{mode:0o700});await fs.mkdir(path.join(out,'objects'),{mode:0o700});
  for(const a of new Map(accepted.files.map(a=>[a.sha256,a])).values()){const raw=await vault.downloadAccepted(a.sha256);await durableWrite(path.join(out,'objects',a.sha256),raw);}
  await durableWrite(path.join(out,'accepted.json'),canonical(accepted)+'\n');return {verified:true,...accepted};
 });
}
