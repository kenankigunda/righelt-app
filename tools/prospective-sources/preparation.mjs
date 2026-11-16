// Operator-only preparation library. No CLI, engine import or execution image hook.
import {createHash, randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';

const schemaBytes=readFileSync(new URL('./schema.json',import.meta.url));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const SCHEMA=freeze(JSON.parse(schemaBytes));
export const fileSha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const canonical=value=>JSON.stringify(sort(value));
function sort(value){
  if(Array.isArray(value))return value.map(sort);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])]));
  if(value===undefined||typeof value==='number'&&!Number.isFinite(value))throw Error('invalid-json');
  return value;
}
const digest=value=>fileSha256(Buffer.from(canonical(value)));
const hex=(value,length=64)=>typeof value==='string'&&new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const requireValue=(condition,reason)=>{if(!condition)throw Error(reason);};
const shape=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(',');
const equal=(a,b)=>canonical(a)===canonical(b);
export const schemaIdentity=freeze({id:SCHEMA.id,version:SCHEMA.version,fileSha256:fileSha256(schemaBytes)});
export const primitiveIdentity=freeze({revision:SCHEMA.primitiveRevision,files:SCHEMA.primitiveFiles});
export const implementationCodeSha256=fileSha256(readFileSync(new URL(import.meta.url)));

export function validateContext(context){
  requireValue(shape(context,['authoritySha256','producer','schema','primitives','custody','registrySha256','exposureSha256','selection','continuationMaximum','executionMode']),'invalid-context');
  const p=context.producer;
  requireValue(shape(p,['revision','codeSha256','dependencySha256','configSha256','runtimeSha256'])&&hex(p.revision,40)&&['codeSha256','dependencySha256','configSha256','runtimeSha256'].every(k=>hex(p[k]))&&p.codeSha256===implementationCodeSha256,'producer-identity-mismatch');
  requireValue(equal(context.schema,schemaIdentity),'schema-identity-mismatch');
  requireValue(equal(context.primitives,primitiveIdentity),'primitive-identity-mismatch');
  requireValue(shape(context.custody,['identitySha256','policySha256','recoverySha256'])&&Object.values(context.custody).every(v=>hex(v)),'custody-identity-mismatch');
  requireValue(['authoritySha256','registrySha256','exposureSha256'].every(k=>hex(context[k]))&&context.selection===SCHEMA.selection&&context.continuationMaximum===0&&context.executionMode==='synthetic','invalid-context');
  return structuredClone(context);
}

function commitment(domain,context,reservation,nonce,payload){
  requireValue(hex(nonce),'invalid-private-nonce');
  return {domain,digest:digest({domain,context,reservation,nonce,payload})};
}
export function seedCommitment(context,reservation,nonce,assignmentSha256){
  validateContext(context);validateReservation(reservation);
  requireValue(hex(assignmentSha256),'assignment-binding-required');
  return commitment(SCHEMA.domains.reservation,context,reservation.id,nonce,{assignmentSha256,reservation});
}
export function verifySeedOpening(expected,context,reservation,nonce,assignmentSha256){
  requireValue(equal(expected,seedCommitment(context,reservation,nonce,assignmentSha256)),'reservation-opening-mismatch');
  return true;
}
function validateReservation(r){
  requireValue(shape(r,['id','sourceFamily','parents','partition','startKind','seed'])&&hex(r.id)&&(r.sourceFamily===null||hex(r.sourceFamily))&&Array.isArray(r.parents)&&r.parents.every(v=>hex(v))&&new Set(r.parents).size===r.parents.length&&['train','validation','final'].includes(r.partition)&&['normal','developed'].includes(r.startKind)&&Number.isInteger(r.seed)&&r.seed>=0&&r.seed<2**32,'invalid-reservation');
}
function validateAssignment(a){
  requireValue(shape(a,['context','deadline','attemptLimit','reservations','registry','exposure']),'invalid-assignment');validateContext(a.context);
  requireValue(Number.isSafeInteger(a.deadline)&&a.deadline>0&&Number.isSafeInteger(a.attemptLimit)&&a.attemptLimit>0&&Array.isArray(a.reservations)&&a.reservations.length===a.attemptLimit,'finite-reservations-required');
  requireValue(digest(a.registry)===a.context.registrySha256&&digest(a.exposure)===a.context.exposureSha256,'input-identity-mismatch');
  requireValue(Array.isArray(a.registry)&&a.registry.length&&Array.isArray(a.exposure),'invalid-registry');
  const families=new Map();
  for(const f of a.registry){
    requireValue(shape(f,['id','partition','relations','exposure'])&&hex(f.id)&&!families.has(f.id)&&['train','validation','final'].includes(f.partition)&&Array.isArray(f.relations)&&f.relations.every(v=>hex(v))&&new Set(f.relations).size===f.relations.length&&!f.relations.includes(f.id)&&['unexposed','exposed','unresolved','quarantined'].includes(f.exposure),'invalid-family');families.set(f.id,f);
  }
  for(const f of families.values())for(const relation of f.relations)requireValue(families.get(relation)?.partition===f.partition,'lineage-partition-conflict');
  const ids=new Set();
  for(const r of a.reservations){
    validateReservation(r);requireValue(!ids.has(r.id),'duplicate-reservation');ids.add(r.id);
    const family=families.get(r.sourceFamily);requireValue(r.sourceFamily===null||family&&family.partition===r.partition,'reservation-family-mismatch');
    for(const parent of r.parents)requireValue(families.get(parent)?.partition===r.partition&&(!family||family.relations.includes(parent)),'unregistered-parent');
  }
  for(const guard of a.exposure)validateGuard(guard);
}
function validateGuard(g){
  requireValue(shape(g,['domain','digest'])&&[SCHEMA.domains.encoded,SCHEMA.domains.geometry].includes(g.domain)&&hex(g.digest),'invalid-guard-domain');
}

// Custody must provide a durable compare-and-append journal and write-once raw
// capture in operator-only storage, with the reviewed recovery boundary. It is
// deliberately injected, never redirected to trainer storage or public stdout.
export async function openPreparation(assignment,{custody,primitives,now=Date.now,nonceFactory}={}){
  validateAssignment(assignment);
  requireValue(primitives&&typeof primitives.construct==='function'&&typeof primitives.verify==='function'&&equal(primitives.identity,primitiveIdentity),'primitive-identity-mismatch');
  requireValue(custody&&['readJournal','append','putRaw'].every(k=>typeof custody[k]==='function')&&equal(custody.identity,assignment.context.custody),'custody-identity-mismatch');
  requireValue(!nonceFactory||assignment.context.executionMode==='synthetic','operator-nonce-override-forbidden');
  const makeNonce=nonceFactory??(()=>randomBytes(32).toString('hex'));
  const a=structuredClone(assignment),context=a.context;
  let journal=await custody.readJournal();
  const assignmentSha256=digest(a);
  async function append(type,payload){
    journal=await custody.append(journal.revision,{type,payload});return journal;
  }
  if(!journal.events.length){
    const reservations=a.reservations.map(reservation=>{const nonce=makeNonce();return {reservation,nonce,commitment:seedCommitment(context,reservation,nonce,assignmentSha256)};});
    await append('reserved',{assignmentSha256,context,reservations});
  }
  requireValue(journal.events[0].type==='reserved'&&journal.events[0].payload.assignmentSha256===assignmentSha256&&equal(journal.events[0].payload.context,context),'journal-binding-mismatch');
  const reserved=journal.events[0].payload.reservations;
  requireValue(reserved.length===a.reservations.length,'journal-reservation-mismatch');
  reserved.forEach((r,i)=>{requireValue(equal(r.reservation,a.reservations[i]),'journal-reservation-mismatch');verifySeedOpening(r.commitment,context,r.reservation,r.nonce,assignmentSha256);});
  function attempts(){
    const result=[];
    for(const e of journal.events.slice(1)){
      requireValue(['began','settled'].includes(e.type),'invalid-journal-event');
      if(e.type==='began'){requireValue(shape(e.payload,['index','startedAt'])&&Number.isSafeInteger(e.payload.startedAt)&&e.payload.startedAt>=0&&e.payload.startedAt<a.deadline&&e.payload.index===result.length&&result.length<a.attemptLimit&&!result.some(x=>!x.settled),'attempt-order-mismatch');result.push({...e.payload,settled:null});}
      else{
        const attempt=result.at(-1),p=e.payload,reasons={eligible:['construction-only'],quarantined:['source-exposure-unresolved','source-family-unresolved'],missing:['construction-or-capture-incomplete'],rejected:['construction-or-guard-rejected']};
        const fields=['index','status','reason','captureCommitment','endedAt','elapsedMs',...(p.status==='eligible'?['stateHash','fingerprint','constructionSha256','guards']:[])];
        requireValue(attempt&&!attempt.settled&&p.index===attempt.index&&shape(p,fields)&&reasons[p.status]?.includes(p.reason)&&Number.isSafeInteger(p.endedAt)&&p.endedAt>=attempt.startedAt&&p.elapsedMs===p.endedAt-attempt.startedAt,'attempt-order-mismatch');
        requireValue(p.captureCommitment===null?['quarantined','missing'].includes(p.status):shape(p.captureCommitment,['domain','digest'])&&p.captureCommitment.domain===SCHEMA.domains.capture&&hex(p.captureCommitment.digest),'invalid-capture-commitment');
        if(p.status==='eligible'){requireValue(hex(p.stateHash)&&hex(p.constructionSha256)&&typeof p.fingerprint==='string'&&p.fingerprint.length>0&&Array.isArray(p.guards),'invalid-private-proof');p.guards.forEach(validateGuard);}
        attempt.settled=p;
      }
    }
    return result;
  }
  const registry=new Map(a.registry.map(f=>[f.id,f]));
  function component(id){
    const seen=new Set(),pending=[id];
    while(pending.length){const key=pending.pop();if(seen.has(key))continue;seen.add(key);
      for(const f of registry.values())if(f.id===key)pending.push(...f.relations);else if(f.relations.includes(key))pending.push(f.id);
    }
    return [...seen].sort();
  }
  function dispositions(){
    const records=attempts(),eligible=records.filter(x=>x.settled?.status==='eligible'),duplicates=new Set();
    const seen=new Map();
    for(const item of eligible){
      if(reserved[item.index].reservation.startKind!=='developed')continue;
      const keys=['state:'+item.settled.stateHash,'fingerprint:'+item.settled.fingerprint,...item.settled.guards.map(g=>g.domain+':'+g.digest)];
      for(const key of keys){if(seen.has(key)){duplicates.add(item.index);duplicates.add(seen.get(key));}else seen.set(key,item.index);}
    }
    const complete=records.length===a.attemptLimit&&records.every(x=>x.settled&&x.settled.status!=='missing');
    const families=new Set(),selected=[];
    if(complete)for(const item of eligible){const family=component(reserved[item.index].reservation.sourceFamily)[0];if(!duplicates.has(item.index)&&!families.has(family)){families.add(family);selected.push(reserved[item.index].commitment);}}
    return {records,duplicates,selected};
  }
  function metadata(){
    const {records,duplicates,selected}=dispositions();
    return {schema:1,kind:SCHEMA.id,context:Object.fromEntries(SCHEMA.publicContextFields.map(k=>[k,structuredClone(context[k])])),reservations:reserved.map(r=>structuredClone(r.commitment)),
      attempts:records.map(x=>({reservationCommitment:structuredClone(reserved[x.index].commitment),status:duplicates.has(x.index)?'quarantined':x.settled?.status??'interrupted',reason:duplicates.has(x.index)?'duplicate-developed-source':x.settled?.reason??'unsettled-private-attempt',captureCommitment:x.settled?.captureCommitment??null})),selected:structuredClone(selected),claims:structuredClone(SCHEMA.claims)};
  }
  async function next(){
    const records=attempts();requireValue(!records.some(x=>!x.settled),'interrupted-attempt-needs-review');
    requireValue(records.length<a.attemptLimit&&now()<a.deadline,'original-bound-exhausted');
    const index=records.length,startedAt=now(),{reservation:r,nonce,commitment:binding}=reserved[index];validateReservation(r);
    await append('began',{index,startedAt});
    const settle=(status,reason,extra)=>{const endedAt=now();requireValue(Number.isSafeInteger(endedAt)&&endedAt>=startedAt,'invalid-attempt-clock');return append('settled',{index,status,reason,endedAt,elapsedMs:endedAt-startedAt,...extra});};
    const family=a.registry.find(f=>f.id===r.sourceFamily);
    if(!family||component(family.id).some(id=>registry.get(id).exposure!=='unexposed')){await settle('quarantined',family?'source-exposure-unresolved':'source-family-unresolved',{captureCommitment:null});return metadata();}
    let raw,capture;
    try{
      raw=await primitives.construct({command:r.startKind==='normal'?'canonical-normal':'generate-opening',seed:r.seed,deadline:a.deadline});
      // Retain original response BEFORE parsing, postflight checks or verification.
      requireValue(raw instanceof Uint8Array,'invalid-private-response');
      capture=await custody.putRaw(binding.digest,raw);
      requireValue(shape(capture,['domain','sha256','bytes'])&&capture.domain===SCHEMA.domains.file&&capture.sha256===fileSha256(raw)&&capture.bytes===raw.byteLength,'private-capture-mismatch');
    }catch{
      await settle('missing','construction-or-capture-incomplete',{captureCommitment:null});return metadata();
    }
    const captures={construction:capture,verification:null};
    const captured=()=>commitment(SCHEMA.domains.capture,context,r.id,nonce,{assignmentSha256,captures});
    try{
      requireValue(now()<a.deadline,'original-bound-exhausted');
      const result=JSON.parse(new TextDecoder().decode(raw));
      requireValue(result&&result.state&&Array.isArray(result.actions)&&typeof result.fingerprint==='string'&&result.fingerprint.length>0,'invalid-construction');
      if(r.startKind==='developed')requireValue(result.type==='opening-generated'&&result.initial===false,'ineligible-developed-root');
      else requireValue(result.type==='canonical-normal'&&result.actions.length===0,'normal-warmup-forbidden');
      const verificationRaw=await primitives.verify({command:r.startKind==='normal'?'expectedEvaluationStart':'validate-opening',state:result.state,actions:result.actions,startKind:r.startKind,deadline:a.deadline});
      requireValue(verificationRaw instanceof Uint8Array,'invalid-private-verification');
      captures.verification=await custody.putRaw(digest({domain:SCHEMA.domains.verification,reservation:binding.digest}),verificationRaw);
      requireValue(shape(captures.verification,['domain','sha256','bytes'])&&captures.verification.domain===SCHEMA.domains.file&&captures.verification.sha256===fileSha256(verificationRaw)&&captures.verification.bytes===verificationRaw.byteLength,'private-verification-capture-mismatch');
      const verified=JSON.parse(new TextDecoder().decode(verificationRaw));
      requireValue(verified?.ongoing===true&&verified.fingerprint===result.fingerprint&&hex(verified.stateHash)&&hex(verified.constructionSha256)&&Array.isArray(verified.guards),'construction-verification-failed');
      requireValue(now()<a.deadline,'original-bound-exhausted');
      if(r.startKind==='developed'){
        requireValue(verified.initial===false&&verified.guards.length===2&&new Set(verified.guards.map(g=>g.domain)).size===2,'developed-guard-scope-missing');
        verified.guards.forEach(validateGuard);
        requireValue(!verified.guards.some(g=>a.exposure.some(e=>equal(g,e))),'protected-source-collision');
      }else requireValue(verified.guards.length===0,'normal-root-is-not-developed-guard');
      await settle('eligible','construction-only',{captureCommitment:captured(),stateHash:verified.stateHash,fingerprint:verified.fingerprint,constructionSha256:verified.constructionSha256,guards:verified.guards});
    }catch{
      await settle('rejected','construction-or-guard-rejected',{captureCommitment:captured()});
    }
    return metadata();
  }
  // Native private final delivery has not been reviewed or wired. A candidate
  // digest alone is never lock authority and this API never returns raw seeds.
  function openPostLock(){throw Error('private-final-consumption-interface-unavailable');}
  return {next,metadata,openPostLock};
}
