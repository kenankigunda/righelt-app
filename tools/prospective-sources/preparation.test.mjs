import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {SCHEMA,schemaIdentity,primitiveIdentity,implementationCodeSha256,canonical,fileSha256,seedCommitment,verifySeedOpening,openPreparation} from './preparation.mjs';
import {openFileCustody} from './file-custody.mjs';
const hash=v=>fileSha256(Buffer.from(canonical(v)));
const hex=n=>n.toString(16).padStart(64,'0');
const raw=v=>Buffer.from(JSON.stringify(v));
async function fixture(t,{kinds=['developed'],partitions=kinds.map(()=> 'final')}={}){
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-source-'));t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
 const root=path.join(temporary,'custody'),custody=await openFileCustody(root,{create:true,policySha256:hex(900),recoverySha256:hex(901)});
 const registry=kinds.map((_,i)=>({id:hex(i+1),partition:partitions[i],relations:[],exposure:'unexposed'}));
 const reservations=kinds.map((startKind,i)=>({id:hex(i+100),sourceFamily:registry[i].id,parents:[],partition:partitions[i],startKind,seed:i+1000}));
 const assignment={context:{authoritySha256:hex(910),producer:{revision:'a'.repeat(40),codeSha256:implementationCodeSha256,dependencySha256:hex(911),configSha256:hex(912),runtimeSha256:hex(913)},schema:structuredClone(schemaIdentity),primitives:structuredClone(primitiveIdentity),custody:structuredClone(custody.identity),registrySha256:hash(registry),exposureSha256:hash([]),selection:SCHEMA.selection,continuationMaximum:0,executionMode:'synthetic'},deadline:2000,attemptLimit:reservations.length,reservations,registry,exposure:[]};
 const calls=[],primitives={identity:primitiveIdentity,async construct({command,seed}){calls.push({command,seed});const normal=command==='canonical-normal';return raw({type:normal?'canonical-normal':'opening-generated',initial:normal,state:{synthetic:true,privateMarker:'SYNTHETIC_RAW_STATE',seed:normal?0:seed},actions:normal?[]:['synthetic-action'],fingerprint:normal?'normal-root':'synthetic-'+seed});},async verify({command,state,startKind}){calls.push({command});return raw({ongoing:true,initial:startKind==='normal',fingerprint:startKind==='normal'?'normal-root':'synthetic-'+state.seed,stateHash:hash(state),constructionSha256:hash({synthetic:state}),guards:startKind==='normal'?[]:[{domain:'sha256-encoded-float32-le',digest:hash({encoded:state})},{domain:'commander-geometry-alias',digest:hash({geometry:state})}]});}};
 let now=1000,nonce=10000;
 const services={custody,primitives,now:()=>now,nonceFactory:()=>hex(++nonce)};
 const refresh=()=>{assignment.context.registrySha256=hash(assignment.registry);assignment.context.exposureSha256=hash(assignment.exposure);};
 return {root,custody,assignment,primitives,calls,services,refresh,advance:n=>{now+=n;},open:()=>openPreparation(assignment,services)};
}

test('synthetic preparation privately retains both original responses and exports only hiding metadata',async t=>{
 const f=await fixture(t),order=[],put=f.custody.putRaw,verify=f.primitives.verify;
 f.custody.putRaw=async(...args)=>{order.push('capture');return put(...args);};
 f.primitives.verify=async args=>{assert.deepEqual(order,['capture']);order.push('verify');return verify(args);};
 const preparation=await f.open();const output=await preparation.next();assert.deepEqual(order,['capture','verify','capture']);
 assert.equal(output.attempts[0].status,'eligible');assert.equal(output.selected.length,1);
 assert.deepEqual(Object.keys(output).sort(),['attempts','claims','context','kind','reservations','schema','selected']);
 assert.deepEqual(Object.keys(output.context).sort(),['continuationMaximum','executionMode','primitives','producer','schema','selection']);
 assert(Object.values(output.claims).every(v=>v===false));
 const printed=JSON.stringify(output);
 for(const hidden of ['SYNTHETIC_RAW_STATE',f.assignment.reservations[0].id,f.assignment.reservations[0].sourceFamily,hex(10001),f.assignment.context.registrySha256,f.assignment.context.exposureSha256])assert(!printed.includes(hidden));
 assert.equal((await fs.readdir(path.join(f.root,'raw'))).length,2);
 for(const name of await fs.readdir(path.join(f.root,'raw')))assert.equal((await fs.stat(path.join(f.root,'raw',name))).mode&0o777,0o600);
 const expected=structuredClone(output);output.reservations[0].digest=hex(111);output.selected[0].digest=hex(112);assert.deepEqual(preparation.metadata(),expected);
 const resumed=await f.open();assert.deepEqual(resumed.metadata(),expected);await assert.rejects(resumed.next(),/bound-exhausted/);assert.equal(f.calls.length,2);
 assert.throws(()=>resumed.openPostLock(0,{candidateSha256:hex(999),nonce:hex(10001)}),/interface-unavailable/);
});
test('hiding opening binds nonce and the entire private assignment, including order and original bounds',async t=>{
 const f=await fixture(t,{kinds:['normal','developed']}),a=f.assignment,r=a.reservations[0],nonce=hex(10001),binding=hash(a);
 const commitment=seedCommitment(a.context,r,nonce,binding);assert.equal(verifySeedOpening(commitment,a.context,r,nonce,binding),true);
 for(const changed of [undefined,hex(10002)])assert.throws(()=>verifySeedOpening(commitment,a.context,r,changed,binding));
 for(const change of [x=>x.deadline++,x=>x.reservations.reverse(),x=>x.attemptLimit++,x=>x.context.producer.configSha256=hex(999)]){
  const other=structuredClone(a);change(other);assert.throws(()=>verifySeedOpening(commitment,other.context,r,nonce,hash(other)),/opening-mismatch/);
 }
 assert.notDeepEqual(commitment,seedCommitment(a.context,r,hex(10002),binding));
});
test('canonical normal roots can be shared without collapsing registered independent game families',async t=>{
 const f=await fixture(t,{kinds:['normal','normal']});const p=await f.open();await p.next();const output=await p.next();
 assert.equal(output.selected.length,2);assert.deepEqual(output.attempts.map(x=>x.status),['eligible','eligible']);
});
test('actual registered parent and child stay in one dependency component without extra family credit',async t=>{
 const f=await fixture(t,{kinds:['developed','developed']});f.assignment.registry[1].relations=[f.assignment.registry[0].id];f.assignment.reservations[1].parents=[f.assignment.registry[0].id];f.refresh();
 const p=await f.open();await p.next();const output=await p.next();assert.equal(output.selected.length,1);assert.deepEqual(output.selected,[output.reservations[0]]);
});
test('unresolved or exposed lineage quarantines its whole component and null family never reaches a primitive',async t=>{
 const f=await fixture(t,{kinds:['normal','developed','developed']});f.assignment.registry[0].relations=[f.assignment.registry[1].id];f.assignment.registry[1].exposure='exposed';f.assignment.reservations[2].sourceFamily=null;f.refresh();
 const p=await f.open();await p.next();await p.next();const output=await p.next();assert.equal(output.selected.length,0);assert.deepEqual(output.attempts.map(x=>x.status),['quarantined','quarantined','quarantined']);assert.equal(output.attempts[2].reason,'source-family-unresolved');assert.equal(f.calls.length,0);
});
test('developed duplicate roots or guard aliases cannot earn distinct family credit',async t=>{
 const f=await fixture(t,{kinds:['developed','developed']}),verify=f.primitives.verify;
 f.primitives.verify=async args=>{const v=JSON.parse(await verify(args));v.guards[1].digest=hex(999);return raw(v);};
 const p=await f.open();await p.next();const output=await p.next();assert.equal(output.selected.length,0);assert.deepEqual(output.attempts.map(x=>x.reason),['duplicate-developed-source','duplicate-developed-source']);
});
test('guard hashes keep their domains and actual protected collisions reject without waivers',async t=>{
 for(const domain of ['sha256-encoded-float32-le','commander-geometry-alias']){
  const f=await fixture(t),verify=f.primitives.verify;f.assignment.exposure=[{domain,digest:hex(999)}];f.refresh();
  f.primitives.verify=async args=>{const v=JSON.parse(await verify(args));v.guards[0].digest=hex(999);return raw(v);};
  const p=await f.open(),output=await p.next();assert.equal(output.attempts[0].status,domain==='sha256-encoded-float32-le'?'rejected':'eligible');
 }
});
test('raw malformed constructor and verifier responses are retained before rejection without snippets',async t=>{
 for(const stage of ['construct','verify']){
  const f=await fixture(t);f.primitives[stage]=async()=>Buffer.from('SYNTHETIC_PRIVATE_INVALID_JSON');
  const p=await f.open(),output=await p.next();assert.equal(output.attempts[0].status,'rejected');assert.equal((await fs.readdir(path.join(f.root,'raw'))).length,stage==='construct'?1:2);assert(!JSON.stringify(output).includes('PRIVATE_INVALID'));
 }
});
test('constructor failure and original deadline exhaustion consume the original attempt without replacement',async t=>{
 for(const mode of ['throw','overrun']){
  const f=await fixture(t),construct=f.primitives.construct;
  f.primitives.construct=async args=>{if(mode==='throw')throw Error('SYNTHETIC_PRIVATE_ERROR');const response=await construct(args);f.advance(1001);return response;};
  const p=await f.open(),output=await p.next();assert.equal(output.selected.length,0);assert.equal(output.attempts[0].status,mode==='throw'?'missing':'rejected');await assert.rejects(p.next(),/bound-exhausted/);assert(!JSON.stringify(output).includes('PRIVATE_ERROR'));
 }
});
test('crash after durable begin never redispatches the consumed attempt on recovery',async t=>{
 const f=await fixture(t),append=f.custody.append;
 f.custody.append=async(...args)=>{const result=await append(...args);if(args[1].type==='began')throw Error('synthetic response lost');return result;};
 const p=await f.open();await assert.rejects(p.next());f.custody.append=append;
 const recovered=await f.open();assert.equal(recovered.metadata().attempts[0].status,'interrupted');await assert.rejects(recovered.next(),/interrupted-attempt/);assert.equal(f.calls.length,0);
});
test('private custody rejects concurrent stale writers, altered bytes, broken chains and changed identity',async t=>{
 const f=await fixture(t);await f.custody.append(0,{type:'fixture',payload:{synthetic:true}});await assert.rejects(f.custody.append(0,{type:'fixture'}),/revision-conflict/);
 await f.custody.putRaw(hex(100),raw({synthetic:1}));await assert.rejects(f.custody.putRaw(hex(100),raw({synthetic:2})),/already-bound/);
 await assert.rejects(openFileCustody(f.root,{policySha256:hex(902),recoverySha256:hex(901)}),/identity-mismatch/);
 const record=path.join(f.root,'journal','00000001.json'),value=JSON.parse(await fs.readFile(record));value.event.payload.synthetic=false;await fs.writeFile(record,JSON.stringify(value));await assert.rejects(f.custody.readJournal(),/chain-invalid/);
});
test('operator mode, altered identities, non-uint32 seeds and cross-partition lineage reject before reservation or dispatch',async t=>{
 for(const change of [a=>a.context.executionMode='operator',a=>a.context.producer.codeSha256=hex(999),a=>a.context.schema.fileSha256=hex(999),a=>a.context.primitives.revision='b'.repeat(40),a=>a.context.custody.identitySha256=hex(999),a=>a.reservations[0].seed=-1,a=>a.reservations[0].seed=2**32,a=>a.registry[0].relations=[a.registry[1].id],a=>a.reservations[0].parents=[a.registry[1].id]]){
  const f=await fixture(t,{kinds:['normal','developed'],partitions:['train','final']});change(f.assignment);f.refresh();await assert.rejects(f.open());assert.equal((await f.custody.readJournal()).revision,0);assert.equal(f.calls.length,0);
 }
});

test('two preparation handles cannot dispatch the same reserved attempt concurrently',async t=>{
 const f=await fixture(t),first=await f.open(),second=await f.open();
 const results=await Promise.allSettled([first.next(),second.next()]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.calls.filter(x=>x.command==='generate-opening').length,1);
 const recovered=await f.open();assert.equal(recovered.metadata().attempts.length,1);await assert.rejects(recovered.next(),/bound-exhausted/);
});
