import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlayableAction} from '../e2e/support/read-playable-action.mjs';
test('browser state failures remain distinct without retries or leaking response data',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{});
 const previous=globalThis.window;
 globalThis.window={localStorage:{getItem:()=> 'private-identity'},location:{href:'https://localhost/#/game/private-game'}};
 try {
  for(const [reply,expected] of [
   [()=>new Response(JSON.stringify({error:'local_api_unavailable',secret:'sensitive'}),{status:503}),/HTTP 503 local_api_unavailable/],
   [()=>new Response('sensitive',{status:200}),/invalid JSON/],
   [()=>new Response('{}'),/invalid game payload/],
   [()=>{throw Error('sensitive private-identity');},/transport/],
  ]){
   let calls=0;globalThis.fetch=async()=>{calls++;return reply();};
   await assert.rejects(readPlayableAction(),error=>{assert.match(error.message,expected);assert.doesNotMatch(error.message,/sensitive|private-identity|private-game/);return true;});assert.equal(calls,1);
  }
  globalThis.fetch=async()=>new Response(JSON.stringify({game:{legalActions:[]}}));assert.equal(await readPlayableAction(),null);
  const action={from:{row:1,col:2},to:{row:2,col:2}};
  globalThis.fetch=async()=>new Response(JSON.stringify({game:{legalActions:[action]}}));assert.deepEqual(await readPlayableAction(),action);
  globalThis.fetch=async()=>new Response('{}',{status:503,headers:{'x-request-id':'12345678-1234-1234-1234-123456789abc'}});
  await assert.rejects(readPlayableAction(),/requestId=12345678-1234-1234-1234-123456789abc/);
 } finally {globalThis.window=previous;}
});
