import test from 'node:test';
import assert from 'node:assert/strict';
import {ARCHIVE_RESOURCES} from './storage-archive-config.mjs';
import {requireFreshArchiveProof,validateArchiveReceipt} from './storage-archive-canary.mjs';
const scope={revision:'a'.repeat(40),generation:'reset-example',origin:'https://example.test'};
const receipt={version:1,...scope,resources:ARCHIVE_RESOURCES,gameId:'game-'+'b'.repeat(32),identityId:'smoke-player',commands:Array(15).fill({}),verified:true,verifiedAt:new Date().toISOString(),workerBuild:'build-a',resumed:true,twoSockets:true};
test('archive promotion proof is bound to resources, revision, generation, Worker and freshness',()=>{
 requireFreshArchiveProof(receipt,{...scope,workerBuild:'build-a'});
 for(const change of [{revision:'c'.repeat(40)},{generation:'reset-other'},{workerBuild:'other'},{now:Date.now()+3600001}])assert.throws(()=>requireFreshArchiveProof(receipt,{...scope,workerBuild:'build-a',...change}));
 for(const change of [{resources:{...ARCHIVE_RESOURCES,bucket:'other'}},{identityId:'real-player'},{gameId:'arbitrary'},{verified:false},{twoSockets:false}])assert.throws(()=>requireFreshArchiveProof({...receipt,...change},{...scope,workerBuild:'build-a'}));
 assert.throws(()=>validateArchiveReceipt({...receipt,resources:{}},scope));
});

test('production proof checks actual Worker revision and bindings, not Pages metadata alone',async()=>{
 const {verifyDeployedArchiveVersion}=await import('./storage-archive-canary.mjs');
 const version={annotations:{'workers/tag':scope.revision},resources:{bindings:[{name:'DB',id:ARCHIVE_RESOURCES.databaseId},{name:'ARCHIVES',bucket_name:ARCHIVE_RESOURCES.bucket},...Object.entries({STORAGE_GENERATION:scope.generation,STORAGE_ARCHIVE_MODE:'canary',STORAGE_ARCHIVE_CANARY_GAME_ID:receipt.gameId,STORAGE_ARCHIVES_ENABLED:'true',STORAGE_BUDGET_ENABLED:'true',STORAGE_EXCLUSIVE_R2:'true'}).map(([name,text])=>({name,text}))]}};
 const expected={...scope,mode:'canary',canaryGameId:receipt.gameId};verifyDeployedArchiveVersion(version,expected);
 assert.throws(()=>verifyDeployedArchiveVersion({...version,annotations:{}},expected));
 for(const name of ['DB','ARCHIVES','STORAGE_GENERATION','STORAGE_ARCHIVE_MODE','STORAGE_BUDGET_ENABLED'])assert.throws(()=>verifyDeployedArchiveVersion({...version,resources:{bindings:version.resources.bindings.filter(b=>b.name!==name)}},expected));
});
