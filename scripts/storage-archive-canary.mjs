import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ARCHIVE_RESOURCES} from './storage-archive-config.mjs';
import {INVESTIGATION_WRANGLER,recoverySocketSnapshot} from './storage-reset.mjs';
import {commandFingerprint} from '../apps/web/generated/packages/shared-types/src/sync-protocol.js';
import {STORAGE_GENERATION_HEADER,STORAGE_GENERATION_QUERY} from '../packages/shared-types/src/storage-policy.js';

async function liveCanarySocket({origin,gameId,identityId,generation}){
 const url=new URL(`/api/shell/games/${gameId}/ws`,origin);url.protocol='wss:';
 for(const [key,value] of Object.entries({identityId,sessionId:crypto.randomUUID(),lastEventSeq:'0',[STORAGE_GENERATION_QUERY]:generation}))url.searchParams.set(key,value);
 const socket=new WebSocket(url.href),frames=[],waiters=new Set();
 socket.addEventListener('message',event=>{try{const frame=JSON.parse(event.data);assert.equal(frame.storageGeneration,generation);assert.equal(frame.gameId,gameId);if(frame.game){frames.push(frame);for(const check of waiters)check();}}catch(error){for(const check of waiters)check(error);}});
 socket.addEventListener('error',()=>{for(const check of waiters)check(Error('Canary socket failed'));});
 const waitForMoves=count=>new Promise((resolve,reject)=>{const done=error=>{const frame=frames.find(f=>f.game.moves.length>=count);if(!error&&!frame)return;clearTimeout(timer);waiters.delete(done);error?reject(error):resolve(frame);};const timer=setTimeout(()=>done(Error('Canary socket delivery timed out')),15000);waiters.add(done);done();});
 try{await waitForMoves(0);return {waitForMoves,close:()=>socket.close()};}catch(error){socket.close();throw error;}
}

export function verifyDeployedArchiveVersion(version,{revision,generation,mode,canaryGameId=''}){
 assert.equal(version.annotations?.['workers/tag'],revision,'API Worker revision differs from canary');
 const bindings=version.resources?.bindings??[],binding=name=>bindings.find(b=>b.name===name);
 assert.equal(binding('DB')?.id,ARCHIVE_RESOURCES.databaseId,'API Worker database differs');
 assert.equal(binding('ARCHIVES')?.bucket_name,ARCHIVE_RESOURCES.bucket,'API Worker bucket differs');
 for(const [key,value] of Object.entries({STORAGE_GENERATION:generation,STORAGE_ARCHIVE_MODE:mode,STORAGE_ARCHIVE_CANARY_GAME_ID:canaryGameId,STORAGE_ARCHIVES_ENABLED:String(mode==='active'||mode==='canary'),STORAGE_BUDGET_ENABLED:String(mode!=='disabled'),STORAGE_EXCLUSIVE_R2:String(mode!=='disabled')}))assert.equal(binding(key)?.text,value,`API Worker ${key} differs`);
}

export function validateArchiveReceipt(receipt,{revision,generation,origin}){
 assert.equal(receipt.version,1);assert.equal(receipt.revision,revision,'Canary revision changed');
 assert.equal(receipt.generation,generation,'Canary generation changed');assert.equal(receipt.origin,origin);
 assert.deepEqual(receipt.resources,ARCHIVE_RESOURCES,'Canary resources changed');
 assert.match(receipt.gameId,/^game-[a-f0-9]{32}$/);assert.equal(receipt.identityId,'smoke-player');
}
export function requireFreshArchiveProof(receipt,{revision,generation,origin,workerBuild,now=Date.now()}){
 validateArchiveReceipt(receipt,{revision,generation,origin});
 assert.equal(receipt.verified,true,'Archive canary has not passed');
 const age=now-Date.parse(receipt.verifiedAt);assert.ok(Number.isFinite(age)&&age>=0&&age<3600000,'Archive canary proof expired');
 assert.equal(receipt.workerBuild,workerBuild,'Canary Worker deployment changed');
 assert.ok(receipt.commands.length>=15&&receipt.resumed&&receipt.twoSockets,'Incomplete archive canary');
}
export async function runArchiveCanary({action,receiptPath,origin,revision,apply=false},{fetcher=fetch,run=(command,args)=>execFileSync(command,args,{encoding:'utf8',env:{...process.env,CI:'true'},stdio:['ignore','pipe','pipe']})}={}){
 assert.ok(['prepare','age','status','verify','promotion-check'].includes(action),'Unknown canary action');
 assert.match(revision,/^[a-f0-9]{40}$/);assert.equal(new URL(origin).origin,origin);assert.ok(origin.startsWith('https://'));
 if(action!=='status'&&action!=='promotion-check')assert.equal(apply,true,'Canary mutations require --apply');
 const meta=await (await fetcher(new URL('/deploy-meta.json?archive-canary='+revision,origin),{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)})).json();
 assert.equal(meta.commitSha,revision,'Production revision differs from requested canary');
 const bootstrapResponse=await fetcher(new URL('/api/shell/bootstrap',origin),{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 const bootstrap=await bootstrapResponse.json();assert.equal(bootstrapResponse.ok,true);assert.equal(bootstrap.maintenance,false);assert.equal(bootstrap.accountsRequired,false,'Canary requires reviewed guest deployment');
 const generation=bootstrap.storageGeneration;assert.match(generation,/^reset-[a-f0-9-]+$/);
 const checkedBuilds=new Set();
 const headers={'content-type':'application/json',[STORAGE_GENERATION_HEADER]:generation};
 const request=async(route,body,allowRestoring=false)=>{
  const response=await fetcher(new URL(route,origin),{headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
  const value=await response.json();
  if(allowRestoring&&response.status===503&&value.error==='storage_restoring')return value;
  assert.equal(response.ok,true,JSON.stringify({status:response.status,error:value.error}));
  const build=response.headers.get('X-Righelt-Server-Build');assert.ok(build&&build!=='unavailable','Worker version is unavailable');
  if(!checkedBuilds.has(build)){
   const deployed=JSON.parse(run('pnpm',['dlx',INVESTIGATION_WRANGLER,'versions','view',build,'--name','righelt-api','--json']));
   verifyDeployedArchiveVersion(deployed,{revision,generation,mode:action==='prepare'?'disabled':'canary',canaryGameId:action==='prepare'?'':receipt.gameId});checkedBuilds.add(build);
  }
  return {...value,workerBuild:build};
 };
 const mode=()=>{
  const result=JSON.parse(run('gh',['api','repos/kenankigunda/righelt-app/environments/Dev/variables']));
  return Object.fromEntries(result.variables.map(v=>[v.name,v.value]));
 };
 const query=sql=>JSON.parse(run('pnpm',['dlx',INVESTIGATION_WRANGLER,'d1','execute','DB','--config','apps/api/wrangler.toml','--remote','--json','--command',sql]))[0];
 const file=path.resolve(receiptPath),save=receipt=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});};
 let receipt;try{receipt=JSON.parse(readFileSync(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!receipt){assert.equal(action,'prepare');receipt={version:1,revision,generation,origin,resources:ARCHIVE_RESOURCES,gameId:'game-'+crypto.randomUUID().replaceAll('-',''),identityId:'smoke-player',commands:[],createdAt:new Date().toISOString()};save(receipt);}
 validateArchiveReceipt(receipt,{revision,generation,origin});
 const route=`/api/shell/games/${receipt.gameId}`,load=()=>request(route+'?identityId='+receipt.identityId);
 const status=()=>query(`SELECT a.status,a.manifest_sha256,a.activity_at,(SELECT COUNT(*) FROM game_payloads p WHERE p.game_id=g.game_id) AS payloads,(SELECT COUNT(*) FROM live_command_receipts r WHERE r.game_id=g.game_id) AS receipts,g.retention_activity_at,g.gameplay_revision FROM live_games g LEFT JOIN game_archives a USING(game_id) WHERE g.game_id='${receipt.gameId}'`).results[0];
 if(action==='status')return {gameId:receipt.gameId,...status()};
 const vars=mode();
 if(action==='prepare'){
  assert.equal(vars.RIGHELT_STORAGE_ARCHIVE_MODE||'disabled','disabled');
  let game;
  if(!receipt.created){const created=await request('/api/shell/games',{gameId:receipt.gameId,identityId:receipt.identityId,selfPlayMode:true,protocolVersion:2});game=created.game;receipt.initialWorkerBuild=created.workerBuild;receipt.created=true;save(receipt);}else game=(await load()).game;
  for(let i=0;i<15;i++){
   let command=receipt.commands[i];
   if(!command){command={protocolVersion:2,gameId:receipt.gameId,identityId:receipt.identityId,clientCommandId:'v2:'+crypto.randomUUID(),kind:'action',payload:{action:{type:'pass'}},expectedState:game.board.state,expectedGameplayRevision:game.gameplayRevision};command.fingerprint=await commandFingerprint(command);receipt.commands.push(command);save(receipt);}
   const accepted=await request(route+'/apply',command);assert.ok(accepted.accepted||accepted.duplicate);game=accepted.game;
  }
  game=(await load()).game;assert.equal(game.moves.length,15);receipt.before={board:game.board.state,moves:game.moves,revision:game.gameplayRevision,invite:game.inviteTokens.viewer};receipt.prepared=true;save(receipt);
  return {prepared:true,gameId:receipt.gameId,commands:receipt.commands.length};
 }
 assert.equal(vars.RIGHELT_STORAGE_ARCHIVE_MODE,'canary');assert.equal(vars.RIGHELT_STORAGE_ARCHIVE_CANARY_GAME_ID,receipt.gameId);
 assert.equal(receipt.prepared,true);
 if(action==='age'){
  if(receipt.aged)return {aged:true,gameId:receipt.gameId};
  const loaded=await load();assert.notEqual(loaded.workerBuild,receipt.initialWorkerBuild,'Canary deployment has not replaced disabled deployment');
  assert.deepEqual(loaded.game.board.state,receipt.before.board);assert.equal(loaded.game.moves.length,15);
  const result=query(`UPDATE live_games SET retention_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days') WHERE game_id='${receipt.gameId}' AND player1_identity_id='smoke-player' AND player2_identity_id='smoke-player' AND gameplay_revision=15;`);
  assert.equal(result.meta.changes,1,'Canary game ownership or revision differs');receipt.workerBuild=loaded.workerBuild;receipt.aged=true;save(receipt);return {aged:true,gameId:receipt.gameId};
 }
 if(action==='promotion-check'){
  const loaded=await load();requireFreshArchiveProof(receipt,{revision,generation,origin,workerBuild:loaded.workerBuild});return {readyToActivate:true,revision,gameId:receipt.gameId};
 }
 assert.equal(receipt.aged,true);let stored,loaded;
 if(!receipt.archiveVerified){
 stored=status();assert.equal(stored.status,'archived','Wait for canary schedule to publish the archive');assert.equal(stored.payloads,0);assert.equal(stored.receipts,0,'Wait for bounded receipt pruning');assert.match(stored.manifest_sha256,/^[a-f0-9]{64}$/);
 loaded=await load();assert.equal(loaded.workerBuild,receipt.workerBuild);assert.deepEqual(loaded.game.board.state,receipt.before.board);assert.deepEqual(loaded.game.moves,receipt.before.moves);
 assert.equal((await request(route+'/apply',receipt.commands[0])).duplicate,true);
 assert.equal((await request('/api/shell/invites/'+receipt.before.invite)).gameId,receipt.gameId);
 const catalog=await request('/api/shell/games?identityId=smoke-player&section=smoke&debug=1&page=0&pageSize=20');
 assert.ok(JSON.stringify(catalog).includes(receipt.gameId),'Canary missing from Home catalog');
 assert.equal((await request(route+'/history',{identityId:receipt.identityId,moveIndex:0})).game.inHistoryMode,true);
 assert.equal((await request(route+'/live',{identityId:receipt.identityId})).game.inHistoryMode,false);
 assert.equal(status().status,'archived');assert.equal(status().retention_activity_at,stored.retention_activity_at,'Read-only work renewed retention');
 const archivedSocket=await recoverySocketSnapshot({origin,gameId:receipt.gameId,identityId:receipt.identityId,generation});assert.equal(archivedSocket.game.moves.length,15);assert.equal(status().status,'archived');
 receipt.archiveVerified=true;save(receipt);
 }
 loaded=await load();assert.equal(loaded.workerBuild,receipt.workerBuild);let command=receipt.resumeCommand;
 if(!command){command={protocolVersion:2,gameId:receipt.gameId,identityId:receipt.identityId,clientCommandId:'v2:'+crypto.randomUUID(),kind:'action',payload:{action:{type:'pass'}},expectedState:loaded.game.board.state,expectedGameplayRevision:loaded.game.gameplayRevision};command.fingerprint=await commandFingerprint(command);receipt.resumeCommand=command;save(receipt);}
 const deadline=Date.now()+120000;let accepted;
 do{accepted=await request(route+'/apply',command,true);if(accepted.accepted||accepted.duplicate)break;await new Promise(resolve=>setTimeout(resolve,500));}while(Date.now()<deadline);
 assert.ok(accepted.accepted||accepted.duplicate,'Restore deadline exceeded');assert.ok(accepted.game.moves.length>=16);assert.ok(accepted.game.gameplayRevision>=receipt.before.revision+1);
 assert.equal((await request(route+'/apply',command)).duplicate,true);assert.equal((await request(route+'/apply',receipt.commands[0])).duplicate,true);
 loaded=await load();assert.deepEqual(loaded.game.moves.slice(0,15),receipt.before.moves);assert.deepEqual(loaded.game.board.state,accepted.game.board.state);stored=status();assert.equal(stored.status,null);assert.equal(stored.payloads,1);
 const channels=[];
 try{
  // A new command after restoration must reach both live clients, not only HTTP.
  channels.push(await liveCanarySocket({origin,gameId:receipt.gameId,identityId:receipt.identityId,generation}));
  channels.push(await liveCanarySocket({origin,gameId:receipt.gameId,identityId:receipt.identityId,generation}));
  loaded=await load();const count=loaded.game.moves.length;
  const syncCommand={...command,clientCommandId:'v2:'+crypto.randomUUID(),expectedState:loaded.game.board.state,expectedGameplayRevision:loaded.game.gameplayRevision};syncCommand.fingerprint=await commandFingerprint(syncCommand);
  (receipt.syncCommands??=[]).push(syncCommand);save(receipt);
  const delivery=Promise.all(channels.map(channel=>channel.waitForMoves(count+1)));void delivery.catch(()=>{});
  const played=await request(route+'/apply',syncCommand);assert.equal(played.accepted,true);
  for(const snapshot of await delivery)assert.deepEqual(snapshot.game.board.state,played.game.board.state);
  assert.equal((await request(route+'/apply',syncCommand)).duplicate,true);
 }finally{for(const channel of channels)channel.close();}

 receipt.verified=true;receipt.verifiedAt=new Date().toISOString();receipt.resumed=true;receipt.twoSockets=true;save(receipt);return {verified:true,gameId:receipt.gameId,revision};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [action,...args]=process.argv.slice(2),read=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
 try{console.log(JSON.stringify(await runArchiveCanary({action,receiptPath:read('--receipt'),origin:read('--origin'),revision:read('--revision'),apply:args.includes('--apply')})));}catch(error){console.error(error.message);process.exitCode=1;}
}
