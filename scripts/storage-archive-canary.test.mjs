import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ARCHIVE_RESOURCES} from './storage-archive-config.mjs';
import {requireFreshArchiveProof,validateArchiveReceipt,verifyArchivedCanaryHistory,runArchiveCanary} from './storage-archive-canary.mjs';
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


test('archived canary verifies known replay data with reads and rejects changed history',async()=>{
 const initial={pieces:[{id:'red-1',x:1,y:2}],sideToMove:'P1'};
 const board={pieces:[{id:'red-1',x:2,y:2}],sideToMove:'P2'};
 const moves=[{moveId:'move-1',clientCommandId:'v2:one',snapshot:structuredClone(board)}];
 const before={board,moves,revision:1},commands=[{expectedState:initial}];
 const loaded={eventSeq:3,game:{board:{state:board},moves,gameplayRevision:1}};
 const history={items:[{kind:'initial',state:structuredClone(initial)},{kind:'decision',move:structuredClone(moves[0])}],nextCursor:null};
 const calls=[];
 await verifyArchivedCanaryHistory({route:'/owned-game',identityId:'owned actor',before,commands,loaded,request:async(route,body)=>{calls.push({route,body});return route.endsWith('/decision-history')?history:structuredClone(loaded);}});
 assert.deepEqual(calls,[{route:'/owned-game/decision-history',body:{identityId:'owned actor',protocolVersion:2}},{route:'/owned-game?identityId=owned%20actor',body:undefined}]);
 for(const defect of ['missing-initial','corrupt-initial','missing-decision','wrong-command','corrupt-snapshot','extra-page','changed-event','changed-revision','changed-board','changed-live-history']){
  const page=structuredClone(history),live=structuredClone(loaded);
  if(defect==='missing-initial')page.items.shift();
  if(defect==='corrupt-initial')page.items[0].state={corrupt:true};
  if(defect==='missing-decision')page.items.pop();
  if(defect==='wrong-command')page.items[1].move.clientCommandId='v2:other';
  if(defect==='corrupt-snapshot')page.items[1].move.snapshot.pieces[0].x=99;
  if(defect==='extra-page')page.nextCursor={eventSeq:3,ordinal:0};
  if(defect==='changed-event')live.eventSeq=4;
  if(defect==='changed-revision')live.game.gameplayRevision=2;
  if(defect==='changed-board')live.game.board.state.pieces[0].x=99;
  if(defect==='changed-live-history')live.game.moves=[];
  await assert.rejects(verifyArchivedCanaryHistory({route:'/owned-game',identityId:'owned actor',before,commands,loaded,request:async route=>route.endsWith('/decision-history')?page:live}),undefined,defect);
 }
});


test('archive verification command reaches read-only history before its unchanged socket check',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'archive-caller-')),file=path.join(directory,'receipt.json');
 const origin='https://example.test',revision='a'.repeat(40),generation='reset-a',gameId='game-'+'b'.repeat(32),identityId='smoke-player';
 const initial={pieces:[],sideToMove:'P1'},board={pieces:[{id:'red-1',x:2,y:2}],sideToMove:'P2'};
 const moves=Array.from({length:15},(_,i)=>({moveId:'move-'+i,clientCommandId:'v2:'+i,snapshot:structuredClone(board)}));
 const game={board:{state:board},moves,gameplayRevision:15},commands=Array.from({length:15},()=>({expectedState:initial}));
 const fixture={version:1,origin,revision,generation,resources:ARCHIVE_RESOURCES,gameId,identityId,commands,before:{board,moves,revision:15,invite:'owned-invite'},prepared:true,aged:true,workerBuild:'local-build'};
 writeFileSync(file,JSON.stringify(fixture));
 const version={annotations:{'workers/tag':revision},resources:{bindings:[{name:'DB',id:ARCHIVE_RESOURCES.databaseId},{name:'ARCHIVES',bucket_name:ARCHIVE_RESOURCES.bucket},...Object.entries({STORAGE_GENERATION:generation,STORAGE_ARCHIVE_MODE:'canary',STORAGE_ARCHIVE_CANARY_GAME_ID:gameId,STORAGE_ARCHIVES_ENABLED:'true',STORAGE_BUDGET_ENABLED:'true',STORAGE_EXCLUSIVE_R2:'true'}).map(([name,text])=>({name,text}))]}};
 const calls=[];
 const fetcher=async(url,options)=>{
  const route=new URL(url).pathname;calls.push({route,method:options?.method??'GET'});
  let value;
  if(route==='/deploy-meta.json')value={commitSha:revision};
  else if(route==='/api/shell/bootstrap')value={maintenance:false,accountsRequired:false,storageGeneration:generation};
  else if(route===`/api/shell/games/${gameId}`)value={game,eventSeq:18};
  else if(route.endsWith('/apply'))value={duplicate:true,game};
  else if(route==='/api/shell/invites/owned-invite')value={gameId};
  else if(route==='/api/shell/games')value={items:[{id:gameId}]};
  else if(route.endsWith('/decision-history'))value={items:[{kind:'initial',state:initial},...moves.map(move=>({kind:'decision',move}))],nextCursor:null};
  else throw Error('Unexpected caller route: '+route);
  return Response.json(value,{headers:{'X-Righelt-Server-Build':'local-build'}});
 };
 const run=(command,args)=>{
  if(command==='gh')return JSON.stringify({variables:[{name:'RIGHELT_STORAGE_ARCHIVE_MODE',value:'canary'},{name:'RIGHELT_STORAGE_ARCHIVE_CANARY_GAME_ID',value:gameId}]});
  if(args.includes('versions'))return JSON.stringify(version);
  if(args.includes('execute'))return JSON.stringify([{results:[{status:'archived',payloads:0,receipts:0,manifest_sha256:'c'.repeat(64),retention_activity_at:'2026-01-01'}]}]);
  throw Error('Unexpected provider command');
 };
 const previous=globalThis.WebSocket;globalThis.WebSocket=class{constructor(){throw Error('Expected unchanged archive socket boundary');}};
 try{
  await assert.rejects(runArchiveCanary({action:'verify',receiptPath:file,origin,revision,apply:true},{fetcher,run}),/Expected unchanged archive socket boundary/);
  const historyIndex=calls.findIndex(call=>call.route.endsWith('/decision-history'));
  assert.ok(historyIndex>=0,'Actual archive verifier must call the read-only history helper');
  assert.deepEqual(calls.slice(historyIndex,historyIndex+2),[{route:`/api/shell/games/${gameId}/decision-history`,method:'POST'},{route:`/api/shell/games/${gameId}`,method:'GET'}]);
  assert.ok(!calls.some(call=>/\/(history|live)$/.test(call.route)));
 }finally{globalThis.WebSocket=previous;rmSync(directory,{recursive:true,force:true});}
});
