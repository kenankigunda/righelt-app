import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {encode,sha256,POLICY} from '../policy.mjs';
import {EXPLORATORY_PURPOSE} from '../exploratory-policy.mjs';
import {Client} from '../client.mjs';

test('controller work retains every object hash for restarted client upload and publication accounting',async()=>{
 const f=await fixture();await f.launch();
 const raw=encode('older checkpoint no longer in latest snapshot');const a=await f.upload(raw);
 const work=await f.core.work('pilot',1);
 const client=new Client({url:'https://compute.example',token:'fixture',id:'pilot',generation:1,fetcher:()=>{throw Error('retained bytes must not upload again');}});
 client.rememberObjects(work.knownObjects);
 assert.equal(client.knownObjects.size,4);
 assert.equal(client.knownObjects.size-new Set(work.manifest.inputs.map(x=>x.sha256)).size,1);
 assert.deepEqual(await client.upload(raw),{name:a.sha256,sha256:a.sha256,bytes:raw.length});
 for(const input of work.manifest.inputs)assert.equal(client.knownObjects.get(input.sha256).bytes,input.bytes);
});

async function sealedFixture(){
 const f=await fixture();await f.launch();const db=await f.core.load(),c=db.campaigns.pilot;
 c.manifest.purpose=EXPLORATORY_PURPOSE;c.manifest.exploratory={schema:1};c.manifest.phases[0].kind='training';await f.core.save(db);
 const cp=encode('independent immutable checkpoint'),cpHash=await sha256(cp);
 const values=[['checkpoint.pt',cp],['latest.json',encode(JSON.stringify({checkpoint:'.ai-runs/pilot/run/checkpoint.pt',sha256:cpHash,updates:17}))],
  ['runner-result.json',encode(JSON.stringify({status:'stopped',reason:'validation-handoff',state:{updates:17}}))]];
 const files=[];
 for(const [name,raw]of values){const a={name,sha256:await sha256(raw),bytes:raw.length};await f.core.putObject('pilot',a,raw,1);files.push({...a,path:'.ai-runs/pilot/run/'+name});}
 const request={id:'sealed-checkpoint',capturedAt:f.now(),files};await f.core.snapshot('pilot',1,request);
 const body={snapshotId:request.id,checkpointSha256:cpHash};await f.core.sealExploratoryEndpoint('pilot',1,body);
 return {...f,body,request,cpHash};
}

test('identical snapshot/seal settlements replay, changed identity cannot replace the sealed checkpoint',async()=>{
 const f=await sealedFixture();assert.equal((await f.core.snapshot('pilot',1,f.request)).replayed,true);
 assert.equal((await f.core.sealExploratoryEndpoint('pilot',1,f.body)).checkpointSha256,f.cpHash);
 await assert.rejects(f.core.snapshot('pilot',1,{...f.request,capturedAt:f.now()+1}),/different bytes/);
 await assert.rejects(f.core.sealExploratoryEndpoint('pilot',1,{...f.body,checkpointSha256:'f'.repeat(64)}),/already sealed/);
 await assert.rejects(f.core.snapshot('pilot',1,{...f.request,id:'replacement'}),/cannot be replaced/);
});
test('sealed export survives checkpoint age in BOTH heartbeat and reconciliation while lease/phase bounds remain',async()=>{
 const f=await sealedFixture();
 for(let i=0;i<8;i++){f.advance(100000);await f.core.heartbeat('pilot',1);await f.core.reconcile();assert.equal((await f.state()).status,'running');}
 assert(f.now()-f.request.capturedAt>POLICY.checkpointMs);
 const db=await f.core.load();db.campaigns.pilot.sealedEndpoint.generation=2;await f.core.save(db);
 await assert.rejects(f.core.heartbeat('pilot',1),/remote checkpoint overdue/);
 await f.core.reconcile();assert.notEqual((await f.state()).status,'running');
});
