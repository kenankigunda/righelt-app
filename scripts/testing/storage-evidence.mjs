import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const STORAGE_TESTS=Object.freeze([
 'archive preserves browser history, direct links and exactly-once resumed play',
 'reset fences a stale tab and creates a fresh game in the new generation',
]);
export const storageHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const decode=value=>value.replace(/&([^;]+);/g,(_,name)=>{
 const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
 if(Object.hasOwn(named,name))return named[name];
 if(/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(name)){const n=name[1]==='x'?parseInt(name.slice(2),16):Number(name.slice(1));if(n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff))return String.fromCodePoint(n);}
 throw Error('Unsupported XML entity');
});
// Closed parser for the pinned Playwright JUnit dialect, not a general XML loader.
// No DTD, external entities, recovery parsing or silent trailing-fragment discard.
export function storageJUnit(bytes,project){
 assert(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=4*1024*1024,'Nonempty bounded storage JUnit required');
 let text=bytes.toString('utf8');assert(!text.includes('\uFFFD')&&!/<!DOCTYPE|<!ENTITY/i.test(text));
 text=text.replace(/^\s*<\?xml[^?]*\?>/,'').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g,'');
 const stack=[],nodes=[];let offset=0;const allowed=new Set(['testsuites','testsuite','testcase','properties','property','system-out','system-err','failure','error','skipped']);
 for(const match of text.matchAll(/<([^<>]+)>/g)){
  const preceding=text.slice(offset,match.index);assert(!/[<>]/.test(preceding));assert(!preceding.trim()||['system-out','system-err','failure','error'].includes(stack.at(-1)?.name),'Unexpected XML text');offset=match.index+match[0].length;
  const token=match[1],closing=token.startsWith('/'),self=token.endsWith('/'),content=token.replace(/^\//,'').replace(/\/$/,'').trim(),name=/^[\w-]+/.exec(content)?.[0];assert(allowed.has(name),'Unknown storage JUnit element');
  if(closing){assert.equal(content,name);assert.equal(stack.pop()?.name,name,'Unbalanced storage JUnit');continue;}
  const attrs=Object.create(null);let rest=content.slice(name.length);
  while(rest.trim()){
   const attr=/^\s+([\w.-]+)="([^"<>]*)"/.exec(rest);assert(attr,'Malformed JUnit attribute');assert(!Object.hasOwn(attrs,attr[1]),'Duplicate JUnit attribute');attrs[attr[1]]=decode(attr[2]);rest=rest.slice(attr[0].length);
  }
  const parent=stack.at(-1),node={name,attrs,parent};if(!parent)assert.equal(nodes.length,0,'Multiple XML roots');
  if(name==='testsuites')assert(!parent);else if(name==='testsuite')assert.equal(parent?.name,'testsuites');else if(name==='testcase')assert.equal(parent?.name,'testsuite');else if(name==='properties')assert.equal(parent?.name,'testcase');else if(name==='property')assert.equal(parent?.name,'properties');else assert(['testsuite','testcase'].includes(parent?.name));
  nodes.push(node);if(!self)stack.push(node);
 }
 assert.equal(stack.length,0);assert.equal(text.slice(offset).trim(),'');assert.equal(nodes[0]?.name,'testsuites');
 const suites=nodes.filter(n=>n.name==='testsuite'),cases=nodes.filter(n=>n.name==='testcase');assert.equal(suites.length,1);assert.equal(suites[0].attrs.hostname,project);
 for(const n of[nodes[0],...suites])for(const[k,v]of Object.entries({tests:'2',failures:'0',skipped:'0',errors:'0'}))assert.equal(n.attrs[k],v,'Storage JUnit counts differ');
 assert.equal(cases.length,2);assert.deepEqual(cases.map(n=>n.attrs.name).sort(),[...STORAGE_TESTS].sort());
 for(const n of cases)assert.equal(n.attrs.classname,'workflows/storage-lifecycle.spec.mjs');
 assert(!nodes.some(n=>['failure','error','skipped'].includes(n.name)),'Storage JUnit contains non-pass');return{tests:2,passed:2,project};
}
export function validateStorageEvidence(proof,xml,observations,{runId,head,attempt,project,identity}={}){
 assert.equal(proof.version,1);assert.equal(proof.source?.sourceClean,true);assert.equal(proof.runId,runId);assert.equal(proof.head,head);assert.equal(proof.attempt,attempt);assert.equal(proof.project,project);assert.equal(proof.job,'e2e');assert.equal(proof.shard,1);
 if(identity)for(const key of['revision','testedTree','sourceFingerprint'])assert.equal(proof.source[key],identity[key]);
 assert.equal(proof.xmlSHA256,storageHash(xml));assert.equal(proof.observationsSHA256,storageHash(observations));storageJUnit(xml,project);
 const o=JSON.parse(observations);for(const[k,v]of Object.entries({total:2,passed:2,failed:0,skipped:0,flaky:0,uncompleted:0}))assert.equal(o[k],v,'Storage observation counts differ');
 assert.equal(o.tests.length,2);assert.equal(new Set(o.tests.map(t=>t.id)).size,2);
 for(const t of o.tests){assert(t.file.endsWith('/e2e/workflows/storage-lifecycle.spec.mjs'));assert.equal(t.status,'expected');assert.equal(t.expected,'passed');assert.equal(t.attempts.length,1);assert.equal(t.attempts[0].status,'passed');assert.deepEqual(t.attempts[0].errors,[]);assert(STORAGE_TESTS.some(title=>t.name===` > ${project} > workflows/storage-lifecycle.spec.mjs > ${title}`),'Storage observation project/file/title differs');}
 assert.deepEqual(o.tests.map(t=>t.name).sort(),STORAGE_TESTS.map(title=>` > ${project} > workflows/storage-lifecycle.spec.mjs > ${title}`).sort());return{project,tests:2,attempt,runId,head};
}
export const STORAGE_JOB_STEPS=Object.freeze(['Checkout','Setup pnpm','Setup Node','Install dependencies','Install browsers','Record advisory selection','Validate suite','Validate storage lifecycle and reset','Seal mandatory storage lifecycle evidence','Preserve evidence']);
/** Latest jobs may carry old execution steps under a new numeric alias ID.
 * The selected artifact attempt is authoritative; alias IDs do not create work.
 */
export function validateStorageJobExecution(proof,jobs){
 const name=`e2e / e2e ${proof.project} 1`,matches=jobs.filter(j=>j.name===name);assert.equal(matches.length,1,'Missing or ambiguous storage job');const job=matches[0];
 assert.equal(job.run_id,proof.runId);assert.equal(job.head_sha,proof.head);assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');
 assert(Number.isSafeInteger(job.id)&&job.id>0);assert(Number.isSafeInteger(job.run_attempt)&&job.run_attempt>=proof.attempt,'Job metadata predates selected artifact');
 const start=Date.parse(job.started_at),end=Date.parse(job.completed_at),sealed=Date.parse(proof.sealedAt);assert(Number.isFinite(start)&&Number.isFinite(end)&&Number.isFinite(sealed)&&end>=start&&sealed>=start&&sealed<end+1000,'Storage seal outside actual job lifetime');
 let previous=-1;const selected=[];
 for(const name of STORAGE_JOB_STEPS){
  const found=job.steps.map((step,index)=>({step,index})).filter(x=>x.step.name===name);assert.equal(found.length,1,'Storage job step missing or duplicated');const{step,index}=found[0];assert(index>previous);previous=index;assert.equal(step.status,'completed');assert.equal(step.conclusion,'success');
  const from=Date.parse(step.started_at),to=Date.parse(step.completed_at);assert(Number.isFinite(from)&&Number.isFinite(to)&&from>=start&&to>=from&&to<=end,'Invalid storage step lifetime');
  if(name==='Seal mandatory storage lifecycle evidence')assert(sealed>=from&&sealed<to+1000,'Storage proof not from selected execution');selected.push({name,startedAt:step.started_at,completedAt:step.completed_at});
 }
 return{jobAliasId:job.id,reportedRunAttempt:job.run_attempt,artifactExecutionAttempt:proof.attempt,startedAt:job.started_at,completedAt:job.completed_at,steps:selected,timestampPrecision:'API second buckets, inclusive start and exclusive completed second + 1000ms; no application budget changes'};
}
