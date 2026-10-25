import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {applyAction,resolveToStability} from '../apps/web/generated/packages/game-engine/src/index.js';
import {commandFingerprint,ACTION_CONTRACT_HEADER,ACTION_CONTRACT_VERSION,LIVE_HISTORY} from '../apps/web/generated/packages/shared-types/src/sync-protocol.js';
import {STORAGE_POLICY,STORAGE_GENERATION_HEADER} from '../packages/shared-types/src/storage-policy.js';
import {ARCHIVE_RESOURCES} from './storage-archive-config.mjs';
import {INVESTIGATION_WRANGLER,recoverySocketSnapshot} from './storage-reset.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const gameId = () => 'game-'+crypto.randomUUID().replaceAll('-','');
const writerBindings = ['STORAGE_LARGE_STATES_ENABLED','STORAGE_METADATA_WRITES_ENABLED','STORAGE_WRITER_CANARY_GAME_ID'];
const retainedBindings = ['STORAGE_GENERATION','STORAGE_COMPRESSION','STORAGE_ARCHIVE_MODE','STORAGE_ARCHIVE_CANARY_GAME_ID','STORAGE_ARCHIVES_ENABLED','STORAGE_BUDGET_ENABLED','STORAGE_EXCLUSIVE_R2','AUTH_ENABLED'];

export function verifyWriterDeployment(version,receipt,{phase}) {
  assert.equal(version.annotations?.['workers/tag'],receipt.revision,'Deployed API revision changed');
  const bindings=version.resources?.bindings??[],binding=name=>bindings.find(b=>b.name===name);
  assert.equal(binding('DB')?.id,ARCHIVE_RESOURCES.databaseId,'Database changed');
  assert.equal(binding('ARCHIVES')?.bucket_name,ARCHIVE_RESOURCES.bucket,'Archive bucket changed');
  const values=Object.fromEntries([...writerBindings,...retainedBindings].map(name=>[name,binding(name)?.text??'']));
  assert.equal(values.STORAGE_COMPRESSION,'true');assert.equal(values.AUTH_ENABLED,'false','Operator supports guest deployment only');
  assert.equal(values.STORAGE_GENERATION,receipt.generation);
  if(receipt.retainedBindings)for(const name of retainedBindings)assert.equal(values[name],receipt.retainedBindings[name],`${name} changed`);
  const enabled=phase!=='plan';
  for(const name of writerBindings.slice(0,2))assert.equal(values[name],String(enabled),`${name} differs`);
  assert.equal(values.STORAGE_WRITER_CANARY_GAME_ID,phase==='canary'?receipt.gameId:'','Writer scope differs');
  return Object.fromEntries(retainedBindings.map(name=>[name,values[name]]));
}

export function requireWriterProof(receipt,{revision,workerBuild,now=Date.now()}) {
  assert.equal(receipt.revision,revision);assert.equal(receipt.workerBuild,workerBuild,'Worker changed after canary');
  assert.equal(receipt.verified,true);assert.ok(receipt.largeRawBytes>STORAGE_POLICY.maximumLegacyStateBytes);
  assert.equal(receipt.metadataPreserved,true);assert.equal(receipt.unrelatedLegacy,true);assert.equal(receipt.duplicate,true);assert.equal(receipt.socketSnapshot,true);
  const age=now-Date.parse(receipt.verifiedAt);assert.ok(Number.isFinite(age)&&age>=0&&age<3600000,'Writer proof expired');
}

// Use real legal moves without destroying pieces or ending the test game.
export function nextWriterAction(game) {
  for(const action of game.legalActions.filter(a=>a.type==='move')) {
    const next=resolveToStability(applyAction(game.board.state,action).state,{artifactMode:'full'});
    if(next.outcome.status==='ongoing'&&next.pieces.length===game.board.state.pieces.length&&!next.continuation)return action;
  }
  const closure=game.legalActions.find(a=>a.type==='end_turn');
  assert.ok(closure,'No safe legal canary action');return closure;
}

export async function runWriterCanary({action,receiptPath,origin,revision,apply=false},{fetcher=fetch,run=(args)=>execFileSync('pnpm',['dlx',INVESTIGATION_WRANGLER,...args],{cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',env:{...process.env,CI:'true'},stdio:['ignore','pipe','pipe']}),socket=recoverySocketSnapshot}={}) {
  assert.ok(['plan','play','promotion-check','final'].includes(action));
  assert.match(revision,/^[a-f0-9]{40}$/);assert.equal(new URL(origin).origin,origin);assert.ok(origin.startsWith('https://'));
  if(action==='play'||action==='final')assert.equal(apply,true,'Canary gameplay requires --apply');
  const file=path.resolve(receiptPath),save=receipt=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});};
  const metaResponse=await fetcher(new URL('/deploy-meta.json',origin),{cache:'no-store',signal:AbortSignal.timeout(15000)});
  assert.equal(metaResponse.ok,true);const meta=await metaResponse.json();assert.equal(meta.commitSha??meta.sha,revision,'Public revision changed');
  const bootResponse=await fetcher(new URL('/api/shell/bootstrap',origin),{cache:'no-store',signal:AbortSignal.timeout(15000)});
  assert.equal(bootResponse.ok,true);const boot=await bootResponse.json();assert.equal(boot.maintenance,false);assert.equal(boot.accountsRequired,false);
  let receipt;try{receipt=JSON.parse(readFileSync(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!receipt){assert.equal(action,'plan');receipt={version:1,revision,origin,generation:boot.storageGeneration,gameId:gameId(),controlGameId:gameId(),identityId:'smoke-writer-'+crypto.randomUUID(),commands:[],createdAt:new Date().toISOString()};save(receipt);}
  assert.equal(receipt.version,1);assert.equal(receipt.revision,revision);assert.equal(receipt.origin,origin);assert.equal(receipt.generation,boot.storageGeneration);
  for(const id of [receipt.gameId,receipt.controlGameId])assert.match(id,/^game-[a-f0-9]{32}$/);
  assert.match(receipt.identityId,/^smoke-writer-[a-f0-9-]{36}$/);
  const phase=action==='plan'?'plan':action==='final'?'global':'canary';
  const headers={'content-type':'application/json',[STORAGE_GENERATION_HEADER]:receipt.generation,[ACTION_CONTRACT_HEADER]:String(ACTION_CONTRACT_VERSION),[LIVE_HISTORY.requestHeader]:LIVE_HISTORY.requestValue};
  let workerBuild;
  const request=async(route,body)=>{
    const response=await fetcher(new URL(route,origin),{headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
    const value=await response.json();if(!response.ok)throw Object.assign(Error(JSON.stringify({status:response.status,error:value.error})),{status:response.status,code:value.error});
    assert.equal(response.headers.get(STORAGE_GENERATION_HEADER),receipt.generation);
    const build=response.headers.get('X-Righelt-Server-Build');assert.ok(build&&build!=='unavailable');
    if(workerBuild){assert.equal(build,workerBuild,'Worker changed during proof');}
    else {
      const version=JSON.parse(run(['versions','view',build,'--name','righelt-api','--json']));
      const retained=verifyWriterDeployment(version,receipt,{phase});
      receipt.retainedBindings??=retained;workerBuild=build;
    }
    return value;
  };
  // A read establishes exact API bindings before any production mutation.
  await request('/api/shell/bootstrap');
  if(action==='plan'){receipt.readerWorkerBuild=workerBuild;save(receipt);return {planned:true,gameId:receipt.gameId,revision};}
  if(action==='promotion-check'){requireWriterProof(receipt,{revision,workerBuild});return {readyToActivate:true,revision};}
  if(action==='final')requireWriterProof(receipt,{revision,workerBuild:receipt.workerBuild});
  const route=id=>`/api/shell/games/${id}`;
  const load=id=>request(route(id)+'?identityId='+encodeURIComponent(receipt.identityId));
  const query=sql=>JSON.parse(run(['d1','execute','DB','--config','apps/api/wrangler.toml','--remote','--json','--command',sql]))[0].results[0];
  const payload=id=>{
    assert.ok(id===receipt.gameId||id===receipt.controlGameId,'Only owned canaries may be inspected');
    const row=query(`SELECT format_version,state_sha256,hex(state_blob) AS blob_hex FROM game_payloads WHERE game_id='${id}'`);
    assert.ok(row,'Canary payload missing');const bytes=Buffer.from(row.blob_hex,'hex');assert.equal(sha(bytes),row.state_sha256);
    const raw=gunzipSync(bytes,{maxOutputLength:STORAGE_POLICY.maximumStateBytes});
    return {format:row.format_version,checksum:row.state_sha256,rawBytes:raw.length,game:JSON.parse(raw),storedBytes:bytes.length};
  };
  const ensureGame=async(id,key)=>{
    if(!receipt[key]){receipt[key]='creating';save(receipt);}
    let value;
    if(receipt[key]==='creating'){
      try{value=await load(id);}
      catch(error){
        if(error.status!==404)throw error;
        // A definite miss permits only the exact recorded create to be retried.
        // A concurrent/existing result is inspected, never replaced.
        try{await request('/api/shell/games',{protocolVersion:2,gameId:id,identityId:receipt.identityId,selfPlayMode:true});}
        catch(createError){if(createError.status!==409)throw createError;}
        value=await load(id);
      }
    }else value=await load(id);
    assert.equal(value.game.player1.identityId,receipt.identityId);assert.equal(value.game.player2.identityId,receipt.identityId);
    receipt[key]='created';save(receipt);return value.game;
  };
  let game=await ensureGame(receipt.gameId,'created');
  await ensureGame(receipt.controlGameId,'controlCreated');
  const play=async(purpose)=>{
    let command=purpose?receipt.commands.find(value=>value.purpose===purpose):receipt.commands.at(-1);
    if(command?.settled&&purpose)return command.envelope;
    if(!command||command.settled){
      const selected=nextWriterAction(game),closure=selected.type==='end_turn';
      const envelope={protocolVersion:2,actionContractVersion:ACTION_CONTRACT_VERSION,gameId:receipt.gameId,identityId:receipt.identityId,clientCommandId:'v2:'+crypto.randomUUID(),kind:closure?'end_turn':'action',payload:closure?{}:{action:selected},expectedState:game.board.state,expectedGameplayRevision:game.gameplayRevision,...(closure?{expectedTurnIndex:game.board.state.turnIndex}:{})};
      envelope.fingerprint=await commandFingerprint(envelope);command={envelope,settled:false,...(purpose?{purpose}:{})};receipt.commands.push(command);save(receipt);
    }
    const result=await request(route(receipt.gameId)+(command.envelope.kind==='end_turn'?'/end-turn':'/apply'),command.envelope);
    const own=result.commandOutcomes?.find(outcome=>outcome.clientCommandId===command.envelope.clientCommandId);
    assert.equal(own?.fingerprint,command.envelope.fingerprint);assert.equal(own?.outcome,'accepted',JSON.stringify(own));
    command.settled=true;game=result.game;save(receipt);return command.envelope;
  };
  if(receipt.commands.at(-1)?.settled===false)await play();
  let stored=payload(receipt.gameId);
  if(action==='play'){
    for(let i=0;stored.rawBytes<=STORAGE_POLICY.maximumLegacyStateBytes&&i<600;i++){
      await play();if(i%10===9)stored=payload(receipt.gameId);
    }
    stored=payload(receipt.gameId);assert.ok(stored.rawBytes>STORAGE_POLICY.maximumLegacyStateBytes,'Canary did not cross the legacy limit');
    assert.ok(stored.storedBytes<=STORAGE_POLICY.maximumStoredStateBytes);receipt.largeRawBytes=stored.rawBytes;
  }else await play("global-final");
  const verifyMetadata=async(id,suffix,expectedFormat)=>{
    receipt.metadataChecks??={};
    let check=receipt.metadataChecks[suffix];
    if(!check){check={checksum:payload(id).checksum,viewer:receipt.identityId+'-'+suffix};receipt.metadataChecks[suffix]=check;save(receipt);}
    const viewer=check.viewer;
    // A stable viewer identity makes an uncertain retry idempotent.
    await request(route(id)+'/join',{identityId:viewer,mode:'viewer',protocolVersion:2});
    const after=payload(id);assert.equal(after.format,expectedFormat);
    assert.equal(after.checksum===check.checksum,expectedFormat===2,'Metadata payload rewrite differs from scope');
    const loaded=(await load(id)).game;assert.ok(loaded.viewers.some(value=>value.identityId===viewer));return loaded;
  };
  game=await verifyMetadata(receipt.gameId,action==='final'?'global-primary':'scoped-primary',2);
  await verifyMetadata(receipt.controlGameId,action==='final'?'global-control':'scoped-control',action==='final'?2:1);
  const latest=receipt.commands.at(-1).envelope;
  const duplicate=await request(route(receipt.gameId)+(latest.kind==='end_turn'?'/end-turn':'/apply'),latest);assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.game.gameplayRevision,game.gameplayRevision);assert.equal(duplicate.game.moves.length,game.moves.length);
  // A fresh socket proves reconnect snapshot continuity, not live broadcast delivery.
  const frame=await socket({origin,gameId:receipt.gameId,identityId:receipt.identityId,generation:receipt.generation});
  assert.equal(frame.game.gameplayRevision,game.gameplayRevision);assert.deepEqual(frame.game.board.state,game.board.state);
  const reloaded=(await load(receipt.gameId)).game;assert.deepEqual(reloaded.board.state,game.board.state);assert.equal(reloaded.moves.length,game.moves.length);
  receipt.metadataPreserved=true;receipt.duplicate=true;receipt.socketSnapshot=true;receipt.workerBuild=workerBuild;
  if(action==='play'){receipt.unrelatedLegacy=true;receipt.verified=true;receipt.verifiedAt=new Date().toISOString();}
  else {receipt.globallyVerified=true;receipt.globallyVerifiedAt=new Date().toISOString();}
  save(receipt);return {verified:true,phase,revision,commands:receipt.commands.length,rawBytes:receipt.largeRawBytes};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [action,...args]=process.argv.slice(2),read=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
  try{console.log(JSON.stringify(await runWriterCanary({action,receiptPath:read('--receipt'),origin:read('--origin'),revision:read('--revision'),apply:args.includes('--apply')})));}catch(error){console.error(error.message);process.exitCode=1;}
}
