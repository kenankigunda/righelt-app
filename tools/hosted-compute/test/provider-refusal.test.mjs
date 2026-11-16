import test from 'node:test';
import assert from 'node:assert/strict';
import {refusalFixture,historical} from './provider-refusal-fixture.mjs';
import {effectiveRefusal,needsOwnershipWatch} from '../refusal-state.mjs';

test('only the exact retained 1c3 refusal resolves current ownership without rewriting history, clocks or money',async()=>{
 const f=await refusalFixture(),before=await f.core.load(),ref=await f.receipt(f.r);
 const out=await f.core.resolveProviderRefusal(f.m.id,ref),after=await f.core.load(),c=after.campaigns[f.m.id];
 assert.equal(out.resolved,true);assert.equal(c.status,'cancelled');assert.equal(c.cleanupVerified,true);assert.deepEqual(c.attempts,before.campaigns[f.m.id].attempts);
 assert.deepEqual(after.manualProgram,before.manualProgram);assert.equal(after.creditAllocatedCents,3);assert.equal(after.pilotReservedCents,3);assert.deepEqual(after.actualSpendBasis,before.actualSpendBasis);
 assert.equal(effectiveRefusal(after,c),true);assert.equal(needsOwnershipWatch(after,c,c.attempts[0],0),false);assert.deepEqual(after.providerRefusalResolution.originalAttempt,c.attempts[0]);
 f.advance(900001);assert.equal((await f.core.resolveProviderRefusal(f.m.id,ref)).replayed,true);assert.equal(effectiveRefusal(await f.core.load(),c),true);
 await assert.rejects(f.core.resolveProviderRefusal(f.m.id,{...ref,sha256:'0'.repeat(64)}),/already bound/);
 assert.equal(f.providers.creates,0);
});
test('altered native bytes, status, account, snapshots, intent, stale CAS and accepted resource evidence reject without mutation',async()=>{
 const changes=[
  f=>{f.r.native.responseBodyUtf8=f.r.native.responseBodyUtf8.trimEnd();},
  f=>{f.r.native.outcomeJournalUtf8=f.r.native.outcomeJournalUtf8.replace('400','500');},
  f=>{f.r.native.attemptJournalUtf8+=' ';},
  f=>{f.r.accountId='other';},f=>{f.r.attestation.helperSnapshotSha256='0'.repeat(64);},
  f=>{f.r.attestation.bootstrapSnapshotSha256='0'.repeat(64);},f=>{f.r.attestation.credentialBindingSha256='0'.repeat(64);},
  f=>{f.r.attestation.requestBodySha256='0'.repeat(64);},f=>{f.r.ledgerSha256='0'.repeat(64);},f=>{f.r.expiresAt=f.r.createdAt;},
  async f=>{const db=await f.core.load();db.campaigns[f.m.id].manual.intentSha256='0'.repeat(64);await f.core.save(db);},
  ...['resourceId','placement','workStartedAt','attached','startupSession'].map(key=>async f=>{const db=await f.core.load(),c=db.campaigns[f.m.id];(key==='attached'||key==='startupSession'?c.manual:c.attempts[0])[key]='unexpected';await f.core.save(db);})
 ];
 for(const change of changes){const f=await refusalFixture();await change(f);const ref=await f.receipt(f.r),before=await f.core.load();await assert.rejects(f.core.resolveProviderRefusal(f.m.id,ref));assert.deepEqual(await f.core.load(),before);}
 const f=await refusalFixture(),ref=await f.receipt(f.r),load=f.core.load.bind(f.core);let reads=0;
 f.core.load=async()=>{const db=await load();if(++reads===2)db.pilotReservedCents++;return db;};await assert.rejects(f.core.resolveProviderRefusal(f.m.id,ref),/ledger changed/);assert.equal((await load()).providerRefusalResolution,undefined);
});
test('original and B6 status-only ownership cannot adopt the singleton evidence',async()=>{
 const f=await refusalFixture(),ref=await f.receipt(f.r);for(const id of ['pilot','public-timing-b6'])await assert.rejects(f.core.resolveProviderRefusal(id,ref));
 const db=await f.core.load(),c=db.campaigns[f.m.id];c.manifest.id='public-timing-b6';assert.equal(needsOwnershipWatch(db,c,c.attempts[0],0),true);
});
test('ordinary reconciliation detects a late resource for a cancelled resolution before deletion and keeps the hold after absence',async()=>{
 const f=await refusalFixture(),ref=await f.receipt(f.r);await f.core.resolveProviderRefusal(f.m.id,ref);
 f.providers.resources.set('late-pod',{id:'late-pod',name:historical.name,host:f.m.phases[0].host});
 f.providers.remove=async()=>{assert.equal((await f.core.load()).providerRefusalContradictions.length,1);f.providers.resources.clear();};
 await f.core.reconcile();let db=await f.core.load();assert.equal(db.campaigns[f.m.id].attempts[0].uncertain,true);assert.equal(db.campaigns[f.m.id].cleanupVerified,false);assert.equal(db.providerRefusalContradictions.length,1);assert.equal(f.providers.resources.size,0);
 await f.core.reconcile();const core=f.controller();assert.equal((await core.resolveProviderRefusal(f.m.id,ref)).held,true);
 db=await core.load();assert.equal(db.campaigns[f.m.id].status,'cleanup-uncertain');assert.equal(effectiveRefusal(db,db.campaigns[f.m.id]),false);assert.equal(needsOwnershipWatch(db,db.campaigns[f.m.id],db.campaigns[f.m.id].attempts[0],0),true);assert.equal(db.providerRefusalContradictions.length,1);
});
