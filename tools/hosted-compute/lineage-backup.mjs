// Operator-only. Plaintext and keys never enter controller/worker manifests.
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assert, canonical, encode, sha256} from './policy.mjs';

const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&canonical(Object.keys(value).sort())===canonical([...keys].sort());
const identifier=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f]/.test(v);
const unique=v=>Array.isArray(v)&&v.every(identifier)&&new Set(v).size===v.length;
export function validateLineage(scope) {
  assert(fields(scope,['schema','lineageVersion','entries'])&&scope.schema===1&&identifier(scope.lineageVersion)&&Array.isArray(scope.entries)&&scope.entries.length>0&&scope.entries.length<=10000,'minimal lineage scope required');
  const sources=new Map(),aliases=new Map(),familyAliases=new Map(),familyExposure=new Map();
  for(const e of scope.entries){
    assert(fields(e,['sourceId','familyId','sanitizedSourceIds','sanitizedFamilyIds','ancestorSourceIds','exposure'])&&identifier(e.sourceId)&&identifier(e.familyId)&&unique(e.sanitizedSourceIds)&&unique(e.sanitizedFamilyIds)&&unique(e.ancestorSourceIds)&&['training','development','final','unknown'].includes(e.exposure),'unexpected lineage fields or relationships');
    assert(!sources.has(e.sourceId),'duplicate original lineage source');sources.set(e.sourceId,e);
    assert(!familyExposure.has(e.familyId)||familyExposure.get(e.familyId)===e.exposure,'whole-family exposure boundary differs');familyExposure.set(e.familyId,e.exposure);
    for(const id of e.sanitizedSourceIds){assert(!aliases.has(id)||aliases.get(id)===e.sourceId,'sanitized source alias split');aliases.set(id,e.sourceId);}
    for(const id of e.sanitizedFamilyIds){assert(!familyAliases.has(id)||familyAliases.get(id)===e.familyId,'sanitized family alias split');familyAliases.set(id,e.familyId);}
  }
  const active=new Set(),done=new Set();
  const visit=e=>{
    assert(!active.has(e.sourceId),'cyclic lineage');if(done.has(e.sourceId))return;active.add(e.sourceId);
    for(const id of e.ancestorSourceIds){const a=sources.get(id);assert(a&&a.familyId===e.familyId,'missing ancestry or family split');
      assert(a.exposure!=='final'||e.exposure==='final','final exposure was downgraded');
      assert(a.exposure!=='unknown'||['unknown','final'].includes(e.exposure),'unknown ancestry was upgraded');
      assert(a.exposure!=='development'||e.exposure!=='training','development exposure was downgraded');visit(a);}
    active.delete(e.sourceId);done.add(e.sourceId);
  };
  for(const e of sources.values())visit(e);
  return scope;
}

// New salts may add aliases. They cannot manufacture a new independent family
// or erase a source's previous exposure and ancestry. This initial migration
// deliberately requires a separately reviewed scope for any exposure change.
export function preserveLineage(previous,next) {
  validateLineage(previous);validateLineage(next);const entries=new Map(next.entries.map(e=>[e.sourceId,e]));
  for(const old of previous.entries){const e=entries.get(old.sourceId);assert(e&&e.familyId===old.familyId&&e.exposure===old.exposure&&canonical([...e.ancestorSourceIds].sort())===canonical([...old.ancestorSourceIds].sort()),'lineage version changed ancestry, exposure or independence');
    assert(old.sanitizedSourceIds.every(id=>e.sanitizedSourceIds.includes(id))&&old.sanitizedFamilyIds.every(id=>e.sanitizedFamilyIds.includes(id)),'lineage alias history was lost');}
  return next;
}

export class AgeEncryption {
  constructor({binary='age',recipient,identityFile,identityBytes}) {Object.assign(this,{binary,recipient,identityFile,identityBytes});}
  async run(args,bytes) {
    // Stdin/stdout buffers avoid plaintext temporary files. Never include child
    // stderr or arguments in errors (they may reveal keys or original IDs).
    return new Promise((resolve,reject)=>{
      const child=spawn(this.binary,args,{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,LANG:'C'}}),chunks=[];let size=0,failed=false;
      const fail=()=>{if(!failed){failed=true;clearTimeout(timeout);for(const part of chunks)part.fill(0);child.kill();reject(Error('age encryption/decryption unavailable or failed'));}};
      const timeout=setTimeout(fail,30000);child.on('error',fail);child.stdin.on('error',fail);child.stderr.resume();
      child.stdout.on('data',part=>{if(failed){part.fill(0);return;}size+=part.length;if(size>16*1024*1024){part.fill(0);fail();}else chunks.push(part);});
      child.on('close',code=>{clearTimeout(timeout);if(failed)return;if(code!==0)return fail();const joined=Buffer.concat(chunks),result=new Uint8Array(joined);joined.fill(0);for(const part of chunks)part.fill(0);resolve(result);});
      child.stdin.end(bytes);
    });
  }
  encrypt(bytes) {assert(/^age1[0-9a-z]+$/.test(this.recipient??''),'explicit age recipient required');return this.run(['--encrypt','--recipient',this.recipient],bytes);}
  async decrypt(bytes) {
    let temporary,identity=this.identityFile;
    try {
      if(this.identityBytes){
        assert(this.identityBytes instanceof Uint8Array&&this.identityBytes.length>0&&this.identityBytes.length<65536,'bounded private age identity bytes required');
        temporary=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-age-identity-'));identity=path.join(temporary,'identity');
        await fs.writeFile(identity,this.identityBytes,{flag:'wx',mode:0o600});
      }
      const info=await fs.lstat(identity);assert(info.isFile()&&!info.isSymbolicLink()&&(info.mode&0o077)===0,'private recovered age identity file required');
      return await this.run(['--decrypt','--identity',identity],bytes);
    } finally {if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
  }
}

export async function encryptLineage(scope,encryption,{previous}={}) {
  validateLineage(scope);if(previous)preserveLineage(previous,scope);
  const envelope=encode(canonical({schema:1,kind:'minimal-lineage',scope,scopeSha256:await sha256(encode(canonical(scope)))}));
  try {const ciphertext=await encryption.encrypt(envelope);return {ciphertext,reference:{schema:1,sha256:await sha256(ciphertext),bytes:ciphertext.length}};}
  finally {envelope.fill(0);}
}

export async function verifyLineageRecovery(vault,reference,encryption,{expectedVersion,recoveryEvidence,previous}={}) {
  assert(reference?.schema===1&&/^[a-f0-9]{64}$/.test(reference.sha256)&&Number.isSafeInteger(reference.bytes)&&reference.bytes>0,'opaque lineage ciphertext reference required');
  // Outside-machine key recovery is an operator assertion, not something a
  // process running on the original Mac can independently establish.
  assert(recoveryEvidence?.schema===1&&recoveryEvidence.outsideOriginalMachine===true&&recoveryEvidence.keyRecovered===true&&identifier(recoveryEvidence.reference),'outside-machine key recovery evidence required');
  const ciphertext=await vault.read(`lineage/${reference.sha256}`);
  assert(ciphertext.length===reference.bytes&&await sha256(ciphertext)===reference.sha256,'cloud lineage ciphertext changed');
  const plaintext=await encryption.decrypt(ciphertext);
  try {
    let envelope;
    try{envelope=JSON.parse(new TextDecoder().decode(plaintext));}catch{throw Error('invalid encrypted lineage envelope');}
    assert(fields(envelope,['schema','kind','scope','scopeSha256'])&&envelope.schema===1&&envelope.kind==='minimal-lineage','invalid encrypted lineage envelope');
    validateLineage(envelope.scope);
    assert(envelope.scope.lineageVersion===expectedVersion&&envelope.scopeSha256===await sha256(encode(canonical(envelope.scope))),'lineage version or plaintext checksum mismatch');
    if(previous)preserveLineage(previous,envelope.scope);
    const proof={schema:1,ciphertextSha256:reference.sha256,lineageBindingSha256:await sha256(encode(canonical({lineageVersion:envelope.scope.lineageVersion,scopeSha256:envelope.scopeSha256}))),cloudRead:true,decrypted:true,relationshipsVerified:true,outsideOriginalMachine:true,recoveryEvidenceSha256:await sha256(encode(canonical(recoveryEvidence)))};
    await vault.confirmLineage(reference,proof);
    return {scope:envelope.scope,proof};
  } finally {plaintext.fill(0);}
}

export async function backupLineage(vault,scope,encryption,options) {
  const {ciphertext,reference}=await encryptLineage(scope,encryption,options);
  await vault.verifiedPut(`lineage/${reference.sha256}`,ciphertext);
  await verifyLineageRecovery(vault,reference,encryption,{...options,expectedVersion:scope.lineageVersion});
  return reference;
}
