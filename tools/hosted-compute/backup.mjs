import { POLICY, assert, artifact, canonical, encode, sha256, safeRunPath } from './policy.mjs';

export class BackupVault {
  constructor({storage,bucket}) {this.storage=storage;this.bucket=bucket;}
  async state(){assert(this.bucket,'private backup bucket is not configured');const s=await this.storage.get('backup-vault')??{schema:1,roots:[],verified:{}};
    if(s.commit){await this.verifiedPut('index.json',encode(canonical(s.commit.index)));s.roots=s.commit.index.roots;s.audit=s.commit.index.audit;s.accepted=s.commit.index.accepted;s.verified[s.commit.key]=s.commit.id;delete s.pending;delete s.commit;await this.save(s);}
    return s;}
  async save(s){await this.storage.put('backup-vault',s);}
  async read(key){const o=await this.bucket.get(key);assert(o,'backup object missing');return new Uint8Array(await o.arrayBuffer());}
  async verifiedPut(key,bytes){await this.bucket.put(key,bytes);assert(await sha256(await this.read(key))===await sha256(bytes),'backup read-back failed');}
  async begin(inventory,collection,selection){
    const s=await this.state();
    const inventorySha256=await sha256(encode(canonical(inventory)));
    assert(collection?.verified===true&&collection.manifestSha256===inventory.manifestSha256&&collection.inventorySha256===inventorySha256,'verified local collection required before backup');
    assert(!s.pending,'another backup is unfinished; resume or abort it');
    if(selection.lineage){const ref=selection.lineage;assert(ref.schema===1&&/^[a-f0-9]{64}$/.test(ref.sha256)&&Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&s.lineageVerified?.[ref.sha256],'cloud-decrypted lineage recovery proof required');}
    const snapshot=inventory.recoveryPoints.find(p=>p.id===selection.snapshotId);
    assert(snapshot||selection.snapshotId===null&&inventory.recoveryPoints.length===0,'unknown recovery point');
    const available=[...(snapshot?.files??[]),...inventory.manifest.inputs];
    assert(Array.isArray(selection.paths)&&new Set(selection.paths).size===selection.paths.length,'explicit unique recovery closure required');
    const selected=selection.paths.map(p=>{assert(safeRunPath(p),'unsafe backup path');const a=available.find(a=>a.path===p);assert(a,'file is not in frozen recovery point');artifact(a);return a;});
    // Hydration semantics: a recovery snapshot supersedes the original input
    // at the same path. Keep the original input blob separately for provenance.
    const materialized=new Map(inventory.manifest.inputs.map(a=>[a.path,a]));
    for(const a of selected)materialized.set(a.path,a);
    const files=[...materialized.values()];
    const needed=new Map([...inventory.manifest.inputs,...files].map(a=>[a.sha256,artifact(a)]));
    for(const a of selection.acceptedFiles??[]){
      assert([...available,...inventory.fileHistory.flatMap(h=>h.files)].some(f=>f.sha256===a.sha256&&f.path===a.path),'accepted model/proof outside inventory');
      needed.set(a.sha256,artifact(a));
    }
    // Settled game receipts are part of recovery, not disposable logs.
    for(const claim of Object.values(inventory.claims))if(claim.result)needed.set(claim.result.sha256,artifact(claim.result));
    const control=encode(canonical({manifest:inventory.manifest,manifestSha256:inventory.manifestSha256,claims:inventory.claims,counters:inventory.counters,attempts:inventory.attempts,missingUploads:inventory.missingUploads}));
    const controlArtifact={name:'control.json',sha256:await sha256(control),bytes:control.length};artifact(controlArtifact);needed.set(controlArtifact.sha256,controlArtifact);
    if(snapshot){
      assert(typeof selection.checkpointPath==='string'&&files.some(f=>f.path===selection.checkpointPath),'checkpoint missing from recovery closure');
      const cp=files.find(f=>f.path===selection.checkpointPath);
      assert(files.some(f=>f.path===selection.checkpointPath.replace(/\.pt$/,'.json')) && files.some(f=>f.path===selection.checkpointPath.replace(/\.pt$/,'.runner.json')),'checkpoint companions missing');
      assert(cp.sha256===selection.checkpointSha256,'backup checkpoint identity mismatch');
    }
    assert(needed.size<=POLICY.maxArtifacts,'backup closure object limit');
    const root={schema:1,id:crypto.randomUUID(),campaign:inventory.id,inventorySha256,manifestSha256:inventory.manifestSha256,
      capturedAt:snapshot?.capturedAt??0,snapshotId:snapshot?.id??null,checkpointPath:selection.checkpointPath??null,
      checkpointSha256:selection.checkpointSha256??null,files,objects:[...needed.values()],control:controlArtifact,
      acceptedFiles:selection.acceptedFiles??[],acceptedMetadata:selection.acceptedMetadata??null,lineage:selection.lineage??null};
    s.pending={root,acked:{}};await this.save(s);
    await this.verifiedPut(`objects/${controlArtifact.sha256}`,control);s.pending.acked[controlArtifact.sha256]=true;await this.save(s);
    return root;
  }
  async pending(){return (await this.state()).pending?.root??null;}
  async copy(hash,readSource){
    const s=await this.state(),a=s.pending?.root.objects.find(a=>a.sha256===hash);assert(a,'unlisted backup object');
    // Read even an existing blob: a prior failed write is never proof credit.
    let o=await this.bucket.get(`objects/${hash}`);
    if(o){const bytes=new Uint8Array(await o.arrayBuffer());assert(bytes.length===a.bytes&&await sha256(bytes)===hash,'existing backup changed');}
    else {const bytes=await readSource(a);assert(bytes.length===a.bytes&&await sha256(bytes)===hash,'source object changed');await this.verifiedPut(`objects/${hash}`,bytes);}
    s.pending.acked[hash]=true;await this.save(s);return {sha256:hash,verified:true};
  }
  async seal(){
    const s=await this.state(),p=s.pending;assert(p&&p.root.objects.every(a=>p.acked[a.sha256]),'backup upload incomplete');
    await this.verifiedPut(`roots/${p.root.id}`,encode(canonical(p.root)));
    p.sealed=true;await this.save(s);return p.root;
  }

  async root(id){const s=await this.state();assert(s.roots.includes(id)||s.audit===id||s.pending?.sealed&&s.pending.root.id===id,'backup is not retained');return JSON.parse(new TextDecoder().decode(await this.read(`roots/${id}`)));}
  async permitsClear(id,hash){const s=await this.state(),root=s.verified[`${id}/${hash}`];assert(root&&(s.roots.includes(root)||s.audit===root),'verified retained cloud backup required before clear');await this.root(root);assert(s.restored?.[root],'cloud-only restore verification required before clear');return root;}
  async abort(){const s=await this.state();delete s.pending;await this.save(s);return {aborted:true};}
  async prune(){
    const s=await this.state();assert(!s.pending,'cannot prune while backup is unfinished');
    const keep=new Set(['index.json','state/backup-vault.json','operator-lock']);
    const keepLineage=ref=>{if(ref)keep.add(`lineage/${ref.sha256}`);};
    keepLineage(s.accepted?.lineage);
    for(const a of s.accepted?.files??[])keep.add(`objects/${a.sha256}`);
    for(const id of new Set([...s.roots,s.audit].filter(Boolean))){const root=await this.root(id);keep.add(`roots/${id}`);for(const a of root.objects)keep.add(`objects/${a.sha256}`);keepLineage(root.lineage);}
    let cursor,removed=0;
    do{const page=await this.bucket.list({cursor});for(const o of page.objects)if(!keep.has(o.key)){await this.bucket.delete(o.key);removed++;}cursor=page.truncated?page.cursor:undefined;assert(!page.truncated||cursor,'backup inventory incomplete');}while(cursor);
    const retained=new Set([...s.roots,s.audit].filter(Boolean));
    s.readBack=Object.fromEntries(Object.entries(s.readBack??{}).filter(([id])=>retained.has(id)));
    s.restored=Object.fromEntries(Object.entries(s.restored??{}).filter(([id])=>retained.has(id)));
    s.verified=Object.fromEntries(Object.entries(s.verified).filter(([,id])=>retained.has(id)));
    s.lineageVerified=Object.fromEntries(Object.entries(s.lineageVerified??{}).filter(([hash])=>keep.has(`lineage/${hash}`)));
    await this.save(s);return {removed,retainedRoots:s.roots};
  }
  async confirmRestore(id,proof){
    const s=await this.state(),root=await this.root(id);
    assert(proof?.backupId===id && proof.manifestSha256===root.manifestSha256 && proof.checkpointSha256===root.checkpointSha256 && proof.controlSha256===root.control.sha256 && proof.allocationResumed===false,'restore proof identity mismatch');
    if(root.lineage)assert(proof.lineageCiphertextSha256===root.lineage.sha256&&proof.lineageBindingSha256===s.lineageVerified?.[root.lineage.sha256]?.lineageBindingSha256&&/^[a-f0-9]{64}$/.test(proof.lineageBindingSha256),'lineage cloud restore proof missing');
    assert(root.objects.every(a=>s.readBack?.[id]?.[a.sha256]),'cloud restore object verification incomplete');
    if(!s.pending || s.pending.root.id!==id){assert(s.restored?.[id],'restore is not a pending or previously verified backup');return {verified:true,id};}
    assert(s.pending.root.id===id&&s.pending.sealed,'backup not sealed');
    const previous=[];
    for(const priorId of s.roots){if(priorId===id)continue;const prior=await this.root(priorId);
      // A re-verified version of the same recovery point replaces its older
      // metadata/lineage root only after complete restoration succeeds.
      if(prior.campaign===root.campaign&&prior.snapshotId===root.snapshotId&&prior.checkpointSha256===root.checkpointSha256)continue;
      previous.push(priorId);
    }
    const roots=root.checkpointPath?[id,...previous].slice(0,POLICY.backupRecoveryPoints):s.roots;
    const audit=root.checkpointPath?null:id;
    const accepted=root.acceptedFiles?.length?{files:root.acceptedFiles,manifestSha256:root.manifestSha256,metadata:root.acceptedMetadata,lineage:root.lineage}:s.accepted??null;
    s.restored??={};s.restored[id]=proof;
    s.commit={index:{schema:1,roots,audit,accepted},id,key:`${root.campaign}/${root.inventorySha256}`};await this.save(s);
    await this.state();return {verified:true,id};
  }
  async catalog(){const s=await this.state();return {pending:s.pending?.root??null,roots:await Promise.all([...s.roots,s.audit].filter(Boolean).map(id=>this.root(id))),accepted:s.accepted??null};}
  async confirmLineage(reference,proof){
    assert(proof?.schema===1&&proof.ciphertextSha256===reference.sha256&&/^[a-f0-9]{64}$/.test(proof.lineageBindingSha256)&&proof.cloudRead===true&&proof.decrypted===true&&proof.relationshipsVerified===true&&proof.outsideOriginalMachine===true,'complete lineage recovery proof required');
    const bytes=await this.read(`lineage/${reference.sha256}`);assert(bytes.length===reference.bytes&&await sha256(bytes)===reference.sha256,'lineage ciphertext checksum mismatch');
    const s=await this.state();s.lineageVerified??={};s.lineageVerified[reference.sha256]=proof;await this.save(s);return proof;
  }
  async downloadAccepted(hash){const s=await this.state(),a=s.accepted?.files.find(a=>a.sha256===hash);assert(a,'object is not an accepted model essential');const bytes=await this.read(`objects/${hash}`);assert(bytes.length===a.bytes&&await sha256(bytes)===hash,'accepted object checksum mismatch');return bytes;}
  async verifyDownloaded(id,hash,bytes){const root=await this.root(id),a=root.objects.find(a=>a.sha256===hash);assert(a,'object outside backup closure');assert(bytes.length===a.bytes&&await sha256(bytes)===hash,'backup checksum mismatch');const s=await this.state();s.readBack??={};s.readBack[id]??={};s.readBack[id][hash]=true;await this.save(s);return bytes;}
  async download(id,hash){return this.verifyDownloaded(id,hash,await this.read(`objects/${hash}`));}
}
