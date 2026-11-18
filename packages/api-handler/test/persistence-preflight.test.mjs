import assert from 'node:assert/strict';
import test from 'node:test';
import {beginPersistencePreflight} from '../src/persistence-preflight.ts';
import {GameRoomDO} from '../src/game-room-do.ts';
import {commandFingerprint} from '../../shared-types/src/sync-protocol.ts';
import {AuthProblem} from '../src/auth-controls.ts';
import {createFakeD1} from './support/fake-d1.mjs';

const policyRow = {activated_at:null,maintenance:0,canary_account_id:null};
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const nextMicrotasks = () => new Promise(resolve=>setImmediate(resolve));

test('fresh primary policy and archive reads overlap without a cached result',async()=>{
  const policy=deferred(),archive=deferred(),starts=[],sessions=[];
  const env={DB:{withSession(mode){sessions.push(mode);return {prepare(){starts.push('policy');return {first:()=>policy.promise};}};},prepare(){return {bind(id){starts.push(['archive',id]);return {first:()=>archive.promise};}};}}};
  const pending=beginPersistencePreflight(env,'g');await nextMicrotasks();
  assert.deepEqual(starts,['policy',['archive','g']]);assert.deepEqual(sessions,['first-primary']);
  policy.resolve(policyRow);const result=await pending;
  assert.equal(result.env.AUTH_REQUIRED,'false');assert.equal(result.env.DB,env.DB);
  const row={game_id:'g',status:'archived'};archive.resolve(row);
  assert.deepEqual(await result.archive,{status:'fulfilled',value:row});
  await beginPersistencePreflight(env,'g');assert.equal(starts.length,4);assert.equal(sessions.length,2);
});

test('policy failure rejects promptly without waiting for the archive read',async()=>{
  const archive=deferred();
  const env={DB:{prepare(sql){if(sql.includes('account_cutover'))return {first:async()=>{throw Error('policy unavailable');}};return {bind:()=>({first:()=>archive.promise})};}}};
  await assert.rejects(beginPersistencePreflight(env,'g'),error=>error.message==='temporarily_unavailable'&&error.status===503);
  archive.reject(Error('archive unavailable'));await nextMicrotasks();
});

test('synchronous archive failure is settled and cannot mask a simultaneous policy failure',async()=>{
  for(const policyFails of [false,true]) {
    const env={DB:{prepare(sql){if(sql.includes('account_cutover'))return {first:async()=>{if(policyFails)throw Error('policy unavailable');return policyRow;}};throw Error('archive synchronous failure');}}};
    if(policyFails)await assert.rejects(beginPersistencePreflight(env,'g'),/temporarily_unavailable/);
    else {const result=await beginPersistencePreflight(env,'g');assert.equal(result.env.AUTH_REQUIRED,'false');const archive=await result.archive;assert.equal(archive.status,'rejected');assert.match(archive.reason.message,/archive synchronous failure/);}
  }
});

const roomHarness = async () => {
  const db=createFakeD1();let mode=null,policyReads=0;
  const DB={batch:db.batch,prepare(sql){const statement=db.prepare(sql);
    if(sql.includes('FROM account_cutover'))statement.first=async()=>{
      if(mode&&++policyReads===2){if(mode==='policy-failure')throw Error('policy failure');if(mode==='deny')return {...policyRow,maintenance:1};}
      return policyRow;
    };
    else if(sql.includes('FROM game_archives'))statement.first=async()=>{
      // Distinct safe error codes make guard precedence observable through the
      // actual response boundary, which intentionally masks generic DB errors.
      if(mode)throw mode==='archive-failure'?Error('archive read failed'):new AuthProblem('archive_unavailable',503);
      return null;
    };
    return statement;
  }};
  const room=new GameRoomDO({id:{name:'g'}},{DB});
  const call=body=>room.fetch(new Request('https://test/moves',{method:'POST',headers:{'x-game-id':'g'},body:JSON.stringify(body)}));
  const created=await room.fetch(new Request('https://test/create',{method:'POST',headers:{'x-game-id':'g'},body:JSON.stringify({identityId:'actor',protocolVersion:2,gameId:'g',selfPlayMode:true})}));
  assert.equal(created.status,200);const before=db.getGameState('g');
  const command={protocolVersion:2,gameId:'g',identityId:'actor',clientCommandId:'v2:preflight',kind:'move',payload:{},expectedState:before.board.state,expectedGameplayRevision:before.gameplayRevision};command.fingerprint=await commandFingerprint(command);
  return {db,before,async execute(nextMode){mode=nextMode;policyReads=0;return call(command);}};
};

for(const mode of ['deny','policy-failure','archive-failure']) test(`actual room preserves ${mode} priority and never persists a failed preflight`,async()=>{
  const h=await roomHarness();
  if(mode==='archive-failure')await assert.rejects(h.execute(mode),/archive read failed/);
  else {const response=await h.execute(mode);assert.equal(response.status,503);assert.equal((await response.json()).error,'temporarily_unavailable');}
  assert.deepEqual(h.db.getGameState('g'),h.before);assert.equal(h.db.getReceipt('g','v2:preflight'),null);
});
