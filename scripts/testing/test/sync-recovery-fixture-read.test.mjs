import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {request} from '@playwright/test';
import {isOperationRequest,operationValues} from '../../../e2e/support/shared-request.mjs';

const source=await readFile(new URL('../../../e2e/workflows/sync-recovery-ux.spec.mjs',import.meta.url),'utf8');
const caseStart='test("pending feedback reaches overdue once, then clears or explains definitive conflict"';
const caseEnd="test('healthy optimistic confirmation";
const originalRead='  const response=await page.request.get(`/api/shell/games/${gameId}?identityId=${payload.identityId}`);';
const retryRead='  const response=await page.request.get(`/api/shell/games/${gameId}?identityId=${payload.identityId}`,{maxRetries:1});';
const caseSource=source.slice(source.indexOf(caseStart),source.indexOf(caseEnd,source.indexOf(caseStart)));
const digest=value=>createHash('sha256').update(value).digest('hex');
const originalCaseHash='84dad85ea1e98bc5f304ecc590ca30a1b2677d303b063ae2a85bfdd082e446b8';

// Execute the real intercepted callback, including its semantic request matcher
// and receipt construction. Only the thin Playwright route interface is adapted
// to an actual incoming HTTP request. Both inner GETs and the single outer POST
// use the pinned APIRequestContext implementation and real loopback sockets.
function callbackSource(original=false) {
 assert.equal(source.split(caseStart).length,2);
 assert.equal(source.split(caseEnd).length,2);
 assert.equal(caseSource.split(retryRead).length,2);
 assert.equal(digest(caseSource.replace(retryRead,originalRead)),originalCaseHash,
  'Every original action, oracle, deadline and route statement must remain unchanged');
 const routeStart=' await page.route(`**/api/shell/games/${gameId}/**`,async route=>{';
 const routeEnd='\n });\n const action=';
 assert.equal(caseSource.split(routeStart).length,2);
 assert.equal(caseSource.split(routeEnd).length,2);
 const start=caseSource.indexOf(routeStart)+routeStart.length;
 const end=caseSource.indexOf(routeEnd,start);
 const callback='async route=>{'+caseSource.slice(start,end)+'\n}';
 return original?callback.replace(retryRead,originalRead):callback;
}

const gameId='fixture-game';
const command={gameId,identityId:'fixture-owner',clientCommandId:'fixture-command',fingerprint:'fixture-fingerprint'};
const fresh={game:{id:gameId,gameplayRevision:7,freshSnapshotMarker:'authoritative-after-reset'},eventSeq:9};

async function exchange(t,{original=false,operation='apply',fault='none',mode='reject'}={}) {
 const counts={posts:0,gets:0,callbacks:0,fulfills:0,continues:0};
 const errors=[];
 let callback,reads,submissions;
 const server=http.createServer((incoming,outgoing)=>{
  void (async()=>{
   const path=new URL(incoming.url,'http://localhost').pathname;
   if(incoming.method==='GET') {
    counts.gets++;
    if(fault==='two-resets'||fault==='first-reset'&&counts.gets===1) {
     incoming.socket.destroy();return;
    }
    outgoing.setHeader('content-type','application/json');
    if(fault==='status-503') {outgoing.statusCode=503;outgoing.end(JSON.stringify({unavailable:true}));return;}
    if(fault==='malformed-json') {outgoing.end('{not-json');return;}
    assert.equal(path,`/api/shell/games/${gameId}`);
    outgoing.end(JSON.stringify(fresh));return;
   }
   assert.equal(incoming.method,'POST');counts.posts++;
   if(fault==='post-reset') {incoming.socket.destroy();return;}
   let body='';for await(const part of incoming)body+=part;
   const payload=JSON.parse(body);
   if(fault==='connection-refused')server.close(); // New inner GET has its own fresh context/socket.
   counts.callbacks++;
   await callback({
    request:()=>({method:()=>incoming.method,url:()=>`http://localhost${incoming.url}`,postDataJSON:()=>payload}),
    fulfill:async({json})=>{counts.fulfills++;outgoing.setHeader('content-type','application/json');outgoing.end(JSON.stringify(json));},
    continue:async()=>{counts.continues++;outgoing.end('{}');},
   });
  })().catch(error=>{
   errors.push(error);
   // A fixture failure is exposed to the one outer request, never retried or
   // converted into a successful synthetic rejection.
   if(!outgoing.destroyed&&!outgoing.writableEnded) {
    outgoing.statusCode=599;outgoing.end('{"fixtureFailed":true}');
   }
  });
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const ownedPort=server.address().port;
 t.after(async()=>{
  try {await submissions?.dispose();await reads?.dispose();}
  finally {server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));}
  const connections=await new Promise((resolve,reject)=>server.getConnections((error,count)=>error?reject(error):resolve(count)));
  assert.equal(server.listening,false);assert.equal(connections,0);
  t.diagnostic(JSON.stringify({ownedPort,ownerPid:process.pid,closed:true,connections,counts,
   original,operation,fault,mode,errorCount:errors.length}));
 });
 const baseURL=`http://127.0.0.1:${ownedPort}`;
 reads=await request.newContext({baseURL,timeout:2000});
 submissions=await request.newContext({baseURL,timeout:4000});
 const environment={page:{request:reads},gameId,mode,unknownResponses:0,isOperationRequest,operationValues};
 callback=vm.runInNewContext('('+callbackSource(original)+')',environment);
 const payload=operation==='reconcile'?{identityId:command.identityId,commands:[command]}:command;
 let response,postError;
 try {response=await submissions.post(`/api/shell/games/${gameId}/${operation}`,{data:payload});}
 catch(error) {postError=error;}
 return {counts,errors,response,postError,unknownResponses:environment.unknownResponses};
}

function assertRejectedSnapshot(result,{gets}) {
 assert.deepEqual(result.counts,{posts:1,gets,callbacks:1,fulfills:1,continues:0});
 assert.equal(result.errors.length,0);assert.equal(result.postError,undefined);
 assert.equal(result.response.status(),200);
}

test('original fixture loses its rejection when the real snapshot GET socket closes',async t=>{
 const result=await exchange(t,{original:true,fault:'first-reset'});
 assert.deepEqual(result.counts,{posts:1,gets:1,callbacks:1,fulfills:0,continues:0});
 assert.equal(result.errors.length,1);assert.match(result.errors[0].message,/socket hang up/);
 assert.equal(result.response.status(),599);
});

for(const operation of ['apply','reconcile'])test(`one reset retry supplies the fresh snapshot to the original ${operation} rejection`,async t=>{
 const result=await exchange(t,{operation,fault:'first-reset'});
 assertRejectedSnapshot(result,{gets:2});
 assert.deepEqual(await result.response.json(),{...fresh,protocolVersion:2,gameId,gameplayRevision:7,
  commandOutcomes:[{...command,outcome:'rejected',reason:'stale_state',eventSeq:9,gameplayRevision:7}]});
 // The pinned retry loop permits a second attempt only for ECONNRESET. The
 // original callback above establishes the actual socket-hang-up counterexample;
 // this successful second GET proves eligibility through that real retry loop.
});

test('a healthy fixture GET is not repeated and retains the original unknown receipt',async t=>{
 const result=await exchange(t,{mode:'hold'});
 assertRejectedSnapshot(result,{gets:1});assert.equal(result.unknownResponses,1);
 const body=await result.response.json();assert.equal(body.commandOutcomes[0].outcome,'unknown');
 assert.equal(body.commandOutcomes[0].reason,null);assert.deepEqual(body.game,fresh.game);
});

test('two reset sockets exhaust the single retry without inventing a conflict receipt',async t=>{
 const result=await exchange(t,{fault:'two-resets'});
 assert.deepEqual(result.counts,{posts:1,gets:2,callbacks:1,fulfills:0,continues:0});
 assert.equal(result.errors.length,1);assert.match(result.errors[0].message,/Failed after 2 attempt\(s\).*socket hang up/s);
 assert.equal(result.response.status(),599);
});

for(const fault of ['status-503','malformed-json'])test(`${fault} does not cause another GET or fabricate a conflict`,async t=>{
 const result=await exchange(t,{fault});
 assert.deepEqual(result.counts,{posts:1,gets:1,callbacks:1,fulfills:0,continues:0});
 assert.equal(result.errors.length,1);assert.equal(result.response.status(),599);
});

test('a refused inner connection is not eligible for a reset retry',async t=>{
 const result=await exchange(t,{fault:'connection-refused'});
 assert.deepEqual(result.counts,{posts:1,gets:0,callbacks:1,fulfills:0,continues:0});
 assert.equal(result.errors.length,1);assert.match(result.errors[0].message,/ECONNREFUSED/);
 assert.doesNotMatch(result.errors[0].message,/Received ECONNRESET|Failed after 2 attempt/);
 assert.equal(result.response.status(),599);
});

test('a dropped outer POST is never replayed by the fixture GET option',async t=>{
 const result=await exchange(t,{fault:'post-reset'});
 assert.deepEqual(result.counts,{posts:1,gets:0,callbacks:0,fulfills:0,continues:0});
 assert.equal(result.errors.length,0);assert.match(result.postError.message,/socket hang up/);
 assert.equal(result.response,undefined);
});
