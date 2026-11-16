import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './manual-fixture.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const hash=v=>sha256(encode(canonical(v)));
async function coldSetup(options){
 const f=await setup(options);
 f.intent.startup={schema:1,kind:'confirmed-pod-startup',deadline:f.now()+900000,maximumMs:900000};
 f.funding.newIntent.startupDeadline=f.intent.startup.deadline;
 f.intent.fundingReservation=await f.receipt(f.funding,'6');
 f.claim={podId:'manual',intentSha256:await hash(f.intent),sessionId:'7'.repeat(32)};
 return f;
}
test('confirmed attached Pod starts after five minutes, with one persisted process and unchanged actual anchor',async()=>{
 const f=await coldSetup();await f.core.manualPrepare('ui',f.intent);f.addPod();await f.attach();
 const attached=await f.ui();f.advance(360000);
 await assert.rejects(f.core.work('ui',1),/session required/);
 assert.deepEqual(await f.core.manualReady('ui',1,f.claim),{ready:true,until:f.intent.startup.deadline});
 const first=await f.ui();f.advance(1000);
 assert.equal((await f.core.manualReady('ui',1,f.claim)).ready,true);
 assert.deepEqual((await f.ui()).manual.startupSession,first.manual.startupSession);
 for(const claim of [{...f.claim,podId:'other'},{...f.claim,intentSha256:'a'.repeat(64)},{...f.claim,sessionId:'8'.repeat(32)}])await assert.rejects(f.core.manualReady('ui',1,claim));
 f.core.workerSession(await f.ui(),f.claim.sessionId);
 for(const session of [null,undefined,'8'.repeat(32)])assert.throws(()=>f.core.workerSession(first,session),/process differs/);
 assert.equal((await f.core.work('ui',1)).manifestSha256,f.intent.manifestSha256);
 await f.core.heartbeat('ui',1);assert.equal((await f.core.manualReady('ui',1,f.claim)).ready,false);
 await f.attach();assert.deepEqual((await f.ui()).programAnchor,attached.programAnchor);
 assert.equal((await f.ui()).manual.startupDeadline,attached.manual.startupDeadline);
 assert.deepEqual((await f.state()).attempts[0],f.old);assert.equal(f.providers.creates,1);
 assert(!JSON.stringify(f.core.status(await f.ui())).includes(f.claim.sessionId));
});
test('cold-start grant never extends create or attach and cannot bootstrap an unattached Pod',async()=>{
 const f=await coldSetup();await f.core.manualPrepare('ui',f.intent);f.addPod();f.advance(300001);
 assert.deepEqual(await f.core.manualReady('ui',1,f.claim),{ready:false,until:f.intent.expiresAt});
 await assert.rejects(f.attach(),/expired/);await assert.rejects(f.core.work('ui',1));
 assert.equal((await f.ui()).manual.startupSession,undefined);
 const late=await coldSetup();late.advance(300001);await assert.rejects(late.core.manualPrepare('ui',late.intent),/expired/);
});
test('cancel, generation replay, disabled compute and reduced allowance deny startup and work',async()=>{
 for(const mode of ['cancel','generation','disabled','allowance']){
  const f=await coldSetup();await f.core.manualPrepare('ui',f.intent);f.addPod();await f.attach();f.advance(360000);
  if(mode==='cancel')await f.core.cancel('ui');
  if(mode==='disabled')f.config.enabled=false;
  if(mode==='allowance')f.config.authorizedCents=1999;
  if(mode==='cancel')assert.equal((await f.core.manualReady('ui',1,f.claim)).ready,false);
  else await assert.rejects(f.core.manualReady('ui',mode==='generation'?2:1,f.claim));
  await assert.rejects(f.core.work('ui',mode==='generation'?2:1));assert.equal((await f.ui()).manual.startupSession,undefined);
 }
});
test('startup expires at its immutable deadline and reconcile retains cleanup responsibility',async()=>{
 const f=await coldSetup();await f.core.manualPrepare('ui',f.intent);f.addPod();await f.attach();f.advance(899999);
 assert.equal((await f.core.manualReady('ui',1,f.claim)).ready,true);f.advance(1);
 assert.equal((await f.core.manualReady('ui',1,f.claim)).ready,false);await assert.rejects(f.core.work('ui',1));
 await f.core.reconcile();await f.core.reconcile();assert.equal(f.providers.resources.size,0);assert.equal((await f.ui()).cleanupVerified,true);
});
test('typed startup rejects malformed or unfunded bounds without storing authority',async()=>{
 for(const change of [f=>{f.intent.startup=null;},f=>{f.intent.startup.maximumMs++;},f=>{f.intent.startup.extra=true;},f=>{f.intent.startup.deadline++;},f=>{f.funding.newIntent.startupDeadline--;},f=>{f.intent.expiresAt=f.intent.createdAt+300001;}]){
  const f=await coldSetup();change(f);f.intent.fundingReservation=await f.receipt(f.funding,'6');
  const before=await f.core.load();await assert.rejects(f.core.manualPrepare('ui',f.intent));assert.deepEqual(await f.core.load(),before);
 }
});
test('accepted-at fifteen-minute cap is persisted once and never renewed by attachment or polling',async()=>{
 const f=await coldSetup({manualWindowMs:1200000,liabilityMs:8400000});
 f.intent.startup.deadline=f.intent.createdAt+1200000;f.funding.newIntent.startupDeadline=f.intent.startup.deadline;
 f.intent.fundingReservation=await f.receipt(f.funding,'6');f.claim.intentSha256=await hash(f.intent);
 await f.core.manualPrepare('ui',f.intent);f.addPod();await f.attach();const initial=await f.ui();
 assert.equal(initial.manual.startupDeadline,f.intent.createdAt+900000);
 f.advance(600000);await f.attach();assert.equal((await f.core.manualReady('ui',1,f.claim)).until,initial.manual.startupDeadline);
 f.advance(300000);assert.equal((await f.core.manualReady('ui',1,f.claim)).ready,false);await assert.rejects(f.core.work('ui',1));
 assert.deepEqual((await f.ui()).programAnchor,initial.programAnchor);assert.equal((await f.ui()).manual.startupDeadline,initial.manual.startupDeadline);
});
test('an existing overall deadline cannot be reset or exceeded by new startup authority',async()=>{
 const f=await coldSetup(),db=await f.core.load();db.manualProgram={acceptedAt:f.now()-86400000+600000,deadline:f.now()+600000,intentSha256:'a'.repeat(64),campaignId:'earlier'};await f.core.save(db);
 await assert.rejects(f.core.manualPrepare('ui',f.intent),/immutable bounds/);assert.deepEqual((await f.core.load()).manualProgram,db.manualProgram);
});
