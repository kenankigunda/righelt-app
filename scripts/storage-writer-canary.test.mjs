import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyWriterDeployment,requireWriterProof,nextWriterAction,runWriterCanary} from './storage-writer-canary.mjs';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {STORAGE_GENERATION_HEADER} from '../packages/shared-types/src/storage-policy.js';
import {ARCHIVE_RESOURCES} from './storage-archive-config.mjs';
import {createInitialState,listLegalActions,applyAction,resolveToStability} from '../apps/web/generated/packages/game-engine/src/index.js';

const revision='a'.repeat(40),id='game-'+'b'.repeat(32);
function fixture(phase='canary'){
 const receipt={revision,gameId:id,generation:'generation'};
 const values={STORAGE_COMPRESSION:'true',STORAGE_GENERATION:'generation',AUTH_ENABLED:'false',STORAGE_ARCHIVE_MODE:'active',STORAGE_ARCHIVES_ENABLED:'true',STORAGE_BUDGET_ENABLED:'true',STORAGE_EXCLUSIVE_R2:'true',STORAGE_ARCHIVE_CANARY_GAME_ID:'',STORAGE_LARGE_STATES_ENABLED:String(phase!=='plan'),STORAGE_METADATA_WRITES_ENABLED:String(phase!=='plan'),STORAGE_WRITER_CANARY_GAME_ID:phase==='canary'?id:''};
 const version={annotations:{'workers/tag':revision},resources:{bindings:[{name:'DB',id:ARCHIVE_RESOURCES.databaseId},{name:'ARCHIVES',bucket_name:ARCHIVE_RESOURCES.bucket},...Object.entries(values).map(([name,text])=>({name,text}))]}};
 return{receipt,version};
}
for(const phase of ['plan','canary','global'])test(`writer proof verifies actual ${phase} scope and preserves existing deployment bindings`,()=>{
 const {receipt,version}=fixture(phase);receipt.retainedBindings=verifyWriterDeployment(version,receipt,{phase});
 for(const name of ['STORAGE_GENERATION','STORAGE_COMPRESSION','AUTH_ENABLED','STORAGE_ARCHIVE_MODE','STORAGE_BUDGET_ENABLED']){
  const changed=structuredClone(version);changed.resources.bindings.find(value=>value.name===name).text='changed';assert.throws(()=>verifyWriterDeployment(changed,receipt,{phase}));
 }
 const wrong=structuredClone(version);wrong.resources.bindings.find(value=>value.name==='STORAGE_WRITER_CANARY_GAME_ID').text='wrong';assert.throws(()=>verifyWriterDeployment(wrong,receipt,{phase}),/scope/);
});

test('promotion requires fresh exact-worker proof of both writers, isolation, receipts and delivery',()=>{
 const now=Date.now(),receipt={revision,workerBuild:'worker',verified:true,verifiedAt:new Date(now).toISOString(),largeRawBytes:2_100_000,metadataPreserved:true,unrelatedLegacy:true,duplicate:true,socket:true};
 requireWriterProof(receipt,{revision,workerBuild:'worker',now});
 for(const key of ['verified','metadataPreserved','unrelatedLegacy','duplicate','socket'])assert.throws(()=>requireWriterProof({...receipt,[key]:false},{revision,workerBuild:'worker',now}));
 assert.throws(()=>requireWriterProof(receipt,{revision,workerBuild:'another',now}));
 assert.throws(()=>requireWriterProof(receipt,{revision,workerBuild:'worker',now:now+3600000}),/expired/);
 assert.throws(()=>requireWriterProof({...receipt,largeRawBytes:2_000_000},{revision,workerBuild:'worker',now}));
});

test('canary action selection uses legal continuing play without sacrificing pieces',()=>{
 let state=resolveToStability(createInitialState(),{artifactMode:'full'});const pieces=state.pieces.length;
 for(let i=0;i<120;i++){
  const legalActions=listLegalActions(state),action=nextWriterAction({board:{state},legalActions});assert.ok(legalActions.some(value=>JSON.stringify(value)===JSON.stringify(action)));
  state=resolveToStability(applyAction(state,action).state,{artifactMode:'full'});
  assert.equal(state.outcome.status,'ongoing');assert.equal(state.pieces.length,pieces);
 }
});

for(const fault of ['before arrival','after creation'])test(`operator resumes a create lost ${fault} with the original identity`,async t=>{
 const directory=mkdtempSync(path.join(tmpdir(),'writer-canary-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const receiptPath=path.join(directory,'receipt.json'),origin='https://example.test';
 let phase='plan',lost=false,recorded;const games=new Map(),creates=[];
 const response=(value,status=200)=>Response.json(value,{status,headers:{[STORAGE_GENERATION_HEADER]:'generation','X-Righelt-Server-Build':'worker'}});
 const fetcher=async(url,init={})=>{
  const route=new URL(url).pathname;
  if(route==='/deploy-meta.json')return response({commitSha:revision});
  if(route==='/api/shell/bootstrap')return response({storageGeneration:'generation',maintenance:false,accountsRequired:false});
  if(route==='/api/shell/games'){
   const body=JSON.parse(init.body);creates.push(body);
   if(!lost&&body.gameId===recorded.gameId){lost=true;if(fault==='before arrival')throw Error('create response lost');}
   games.set(body.gameId,{id:body.gameId,player1:{identityId:body.identityId},player2:{identityId:body.identityId}});
   if(creates.length===1&&fault==='after creation')throw Error('create response lost');
   return response({game:games.get(body.gameId)});
  }
  const id=route.split('/').at(-1);return games.has(id)?response({game:games.get(id)}):response({error:'not_found'},404);
 };
 const run=args=>{
  if(args[0]==='d1')throw Error('stop after owned creates');
  const {version}=fixture(phase);
  if(recorded)version.resources.bindings.find(value=>value.name==='STORAGE_WRITER_CANARY_GAME_ID').text=recorded.gameId;
  return JSON.stringify(version);
 };
 await runWriterCanary({action:'plan',receiptPath,origin,revision},{fetcher,run});
 recorded=JSON.parse(readFileSync(receiptPath));phase='canary';
 const options={action:'play',receiptPath,origin,revision,apply:true};
 await assert.rejects(runWriterCanary(options,{fetcher,run}),/create response lost/);
 await assert.rejects(runWriterCanary(options,{fetcher,run}),/stop after owned creates/);
 const primary=creates.filter(value=>value.gameId===recorded.gameId);
 assert.equal(primary.length,fault==='before arrival'?2:1);
 assert.ok(primary.every(value=>value.identityId===recorded.identityId&&JSON.stringify(value)===JSON.stringify(primary[0])));
 const saved=JSON.parse(readFileSync(receiptPath));assert.equal(saved.created,'created');assert.equal(saved.controlCreated,'created');
 assert.equal(saved.gameId,recorded.gameId);assert.equal(saved.controlGameId,recorded.controlGameId);assert.equal(games.size,2);
});

for(const checkpoint of ['lost reply','settled receipt'])test(`global verification resumes the same final command from ${checkpoint}`,async t=>{
 const directory=mkdtempSync(path.join(tmpdir(),'writer-final-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const receiptPath=path.join(directory,'receipt.json'),origin='https://example.test',control='game-'+'c'.repeat(32),identityId='smoke-writer-'+crypto.randomUUID();
 const {receipt:scope,version}=fixture('global'),games=new Map(),payloads=new Map(),accepted=new Map(),sent=[];let lost=false;
 const state=resolveToStability(createInitialState(),{artifactMode:'full'});
 const storePayload=game=>{const bytes=gzipSync(JSON.stringify(game));payloads.set(game.id,{format_version:1,state_sha256:createHash('sha256').update(bytes).digest('hex'),blob_hex:bytes.toString('hex')});};
 for(const gameId of [id,control]){const game={id:gameId,gameplayRevision:0,player1:{identityId},player2:{identityId},viewers:[],moves:[],board:{state:structuredClone(state)},legalActions:listLegalActions(state)};games.set(gameId,game);storePayload(game);}
 const receipt={...scope,version:1,origin,controlGameId:control,identityId,created:'created',controlCreated:'created',commands:[],verified:true,verifiedAt:new Date().toISOString(),workerBuild:'canary-worker',largeRawBytes:2_100_000,metadataPreserved:true,unrelatedLegacy:true,duplicate:true,socket:true};
 receipt.retainedBindings=verifyWriterDeployment(version,receipt,{phase:'global'});writeFileSync(receiptPath,JSON.stringify(receipt));
 const response=(value,status=200)=>Response.json(value,{status,headers:{[STORAGE_GENERATION_HEADER]:'generation','X-Righelt-Server-Build':'global-worker'}});
 const fetcher=async(url,init={})=>{
  const route=new URL(url).pathname;
  if(route==='/deploy-meta.json')return response({commitSha:revision});
  if(route==='/api/shell/bootstrap')return response({storageGeneration:'generation',maintenance:false,accountsRequired:false});
  const parts=route.split('/'),game=games.get(parts[4]);assert.ok(game,'only recorded games are addressed');
  if(init.method!=='POST')return response({game});
  const body=JSON.parse(init.body);
  if(parts[5]==='join'){if(!game.viewers.some(value=>value.identityId===body.identityId))game.viewers.push({identityId:body.identityId});payloads.get(game.id).format_version=2;return response({game});}
  sent.push(structuredClone(body));const duplicate=accepted.has(body.clientCommandId);
  if(!duplicate){game.board.state=resolveToStability(applyAction(game.board.state,body.payload.action).state,{artifactMode:'full'});game.gameplayRevision++;game.moves.push({clientCommandId:body.clientCommandId});game.legalActions=listLegalActions(game.board.state);storePayload(game);accepted.set(body.clientCommandId,body.fingerprint);}
  if(!lost){lost=true;throw Error('move reply lost');}
  return response({game,duplicate,commandOutcomes:[{clientCommandId:body.clientCommandId,fingerprint:body.fingerprint,outcome:'accepted'}]});
 };
 const run=args=>args[0]==='versions'?JSON.stringify(version):JSON.stringify([{results:[payloads.get(/game_id='([^']+)'/.exec(args.at(-1))[1])]}]);
 const socket=async()=>({game:structuredClone(games.get(id))}),options={action:'final',receiptPath,origin,revision,apply:true};
 await assert.rejects(runWriterCanary(options,{fetcher,run,socket}),/move reply lost/);
 const original=JSON.parse(readFileSync(receiptPath));assert.equal(original.commands.length,1);assert.equal(original.commands[0].purpose,'global-final');
 if(checkpoint==='settled receipt'){original.commands[0].settled=true;writeFileSync(receiptPath,JSON.stringify(original));}
 await runWriterCanary(options,{fetcher,run,socket});
 const final=JSON.parse(readFileSync(receiptPath));assert.equal(final.commands.length,1);assert.equal(final.commands[0].settled,true);assert.equal(final.globallyVerified,true);assert.equal(accepted.size,1);
 assert.ok(sent.every(value=>JSON.stringify(value)===JSON.stringify(original.commands[0].envelope)),'only the original final command is sent');
});
