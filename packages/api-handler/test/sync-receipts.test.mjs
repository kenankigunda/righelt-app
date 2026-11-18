import assert from 'node:assert/strict';
import test from 'node:test';
import {loadCommandEvidence} from '../src/sync-receipts.ts';
import {createFakeD1} from './support/fake-d1.mjs';

const saveReceipt = (db, outcome = 'accepted') => db.prepare('INSERT INTO live_command_receipts').bind('g','v2:one','actor','original',outcome,outcome === 'rejected' ? 'stale_state' : null,7,3,JSON.stringify({removedPieces:['unit']})).run();
const saveLegacy = db => db.prepare('INSERT INTO live_legacy_command_tombstones').bind('g','v2:one','{}').run();
const measured = db => {
  const calls = {batch:0,first:0};
  return {calls, DB:{prepare(sql){const statement=db.prepare(sql);const originalBind=statement.bind;
    statement.bind=(...args)=>{const bound=originalBind(...args);const first=bound.first.bind(bound);bound.first=(...args)=>{calls.first++;return first(...args);};return bound;};return statement;
  },async batch(statements){calls.batch++;return db.batch(statements);}}};
};

test('fresh command evidence uses one database round trip and never caches a miss',async()=>{
  const db=createFakeD1(),env=measured(db);
  let evidence=await loadCommandEvidence(env,'g','v2:one');
  assert.equal(evidence.receipt,null);assert.equal(await evidence.hasLegacyEvidence(),false);
  assert.deepEqual(env.calls,{batch:1,first:0});
  await saveReceipt(db);
  evidence=await loadCommandEvidence(env,'g','v2:one');
  assert.deepEqual(evidence.receipt,{gameId:'g',clientCommandId:'v2:one',identityId:'actor',fingerprint:'original',outcome:'accepted',reason:null,eventSeq:7,gameplayRevision:3,result:{removedPieces:['unit']}});
  assert.deepEqual(env.calls,{batch:2,first:0});
});

for(const outcome of ['accepted','rejected']) test(`authoritative ${outcome} receipt survives simultaneous legacy evidence`,async()=>{
  const db=createFakeD1();await saveReceipt(db,outcome);await saveLegacy(db);
  const evidence=await loadCommandEvidence({DB:db},'g','v2:one');
  assert.equal(evidence.receipt.outcome,outcome);assert.equal(evidence.receipt.fingerprint,'original');
  assert.equal(evidence.receipt.reason,outcome==='rejected'?'stale_state':null);
});

test('legacy evidence stays unknown and scoped to the requested game and command',async()=>{
  const db=createFakeD1();await saveLegacy(db);
  const evidence=await loadCommandEvidence({DB:db},'g','v2:one');
  assert.equal(evidence.receipt,null);assert.equal(await evidence.hasLegacyEvidence(),true);
  assert.equal(await(await loadCommandEvidence({DB:db},'other','v2:one')).hasLegacyEvidence(),false);
  assert.equal(await(await loadCommandEvidence({DB:db},'g','other')).hasLegacyEvidence(),false);
});

test('failed batch falls back to receipt-first short circuit without unrelated archive IO',async()=>{
  const db=createFakeD1();await saveReceipt(db);let batches=0;
  const env={DB:{prepare:db.prepare,async batch(){batches++;throw Error('read batch unavailable');}}};
  const evidence=await loadCommandEvidence(env,'g','v2:one');
  assert.equal(evidence.receipt.outcome,'accepted');assert.equal(batches,1);
  assert.equal(db.getReads().filter(row=>row.query.includes('game_archives')).length,0);
});

test('malformed batch result falls back instead of fabricating an evidence miss',async()=>{
  const db=createFakeD1();await saveLegacy(db);
  for(const result of [[],[{success:false},{success:true,results:[]},{success:true,results:[]}]]) {
    const evidence=await loadCommandEvidence({DB:{prepare:db.prepare,async batch(){return result;}}},'g','v2:one');
    assert.equal(evidence.receipt,null);assert.equal(await evidence.hasLegacyEvidence(),true);
  }
});

test('live receipt short circuits unusable archive metadata without opening archived objects',async()=>{
  const db=createFakeD1();await saveReceipt(db);
  const env={DB:{prepare:db.prepare,async batch(){return [
    {success:true,results:[db.getReceipt('g','v2:one')]},
    {success:true,results:[]},
    {success:true,results:[{game_id:'g',status:'archived',manifest_sha256:null}]},
  ];}}};
  assert.equal((await loadCommandEvidence(env,'g','v2:one')).receipt.outcome,'accepted');
});

test('archiving evidence is not read and an archived read failure cannot become a clean miss',async()=>{
  for(const status of ['archiving','archived']) {
    const db=createFakeD1();const env={DB:{prepare:db.prepare,async batch(){return [
      {success:true,results:[]},{success:true,results:[]},
      {success:true,results:[{game_id:'g',status,manifest_sha256:null}]},
    ];}}};
    if(status==='archived') await assert.rejects(loadCommandEvidence(env,'g','v2:one'),/archive_unavailable/);
    else {const evidence=await loadCommandEvidence(env,'g','v2:one');assert.equal(evidence.receipt,null);assert.equal(await evidence.hasLegacyEvidence(),false);}
  }
});

test('read-only batches cannot consume lost-commit or rollback injections',async()=>{
  for(const fault of ['lose','rollback']) {
    const db=createFakeD1();if(fault==='lose')db.loseNextBatchResponse();else db.failNextBatchAt(0);
    assert.equal((await loadCommandEvidence({DB:db},'g','v2:one')).receipt,null);
    await assert.rejects(db.batch([db.prepare('INSERT INTO live_command_receipts').bind('g','v2:one','actor','original','accepted',null,7,3)]),fault==='lose'?/Lost batch response/:/Injected batch failure/);
    assert.equal(db.getReceipt('g','v2:one')?.outcome??null,fault==='lose'?'accepted':null);
  }
});
