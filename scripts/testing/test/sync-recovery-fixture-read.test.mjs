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

// Exact accepted182 additions coexist with the later246 one-reset GET option.
// Invert only those reviewed case edits, retaining the original246 source seal.
// Sources:18218c33875926a82d4aae3397be03fc7c0cb2b012c and
//246bff385c98d3a0ea58f097ce41ae41ab6b614edd8. No fixture code is rewritten.
const acceptedRecoveryCaseHash='9253266bd58752ab5b0674d3b1326d70d9d8ad636ef54bf93478f3b6d1cf25b9';
const acceptedRecoveryDelta=[
  {
    "before": " // Two real 15-second foreground waits plus WebKit setup and the final move\n // need headroom under CI load; keep the individual recovery deadlines strict.\n test.setTimeout(90000);\n",
    "after": ""
  },
  {
    "before": " // Keep durable work genuinely pending with valid unknown receipts.\n",
    "after": " // A transport failure must show its error immediately. To exercise genuinely\n // pending work instead, return valid unknown receipts without applying it.\n"
  },
  {
    "before": " // An already-overdue command must not announce an old background wait when\n // the person returns. Exercise the real shell visibility listener without\n // relying on the browser runner keeping an auxiliary tab in the background.\n await page.evaluate(() => {\n   Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });\n   Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });\n   document.dispatchEvent(new Event('visibilitychange'));\n });\n await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);\n await page.evaluate(() => {\n   delete document.hidden; delete document.visibilityState;\n   document.dispatchEvent(new Event('visibilitychange'));\n });\n await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);\n await expect(page.locator('#shell-sync-announcement')).not.toContainText('Still checking');\n await page.waitForTimeout(2000);\n await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);\n await expect(page.getByTestId('sync-recovery-banner')).toContainText('Recording your move', { timeout: 5000 });\n await expect(page.getByTestId('sync-recovery-banner').getByRole('button', { name: 'Reload game', exact: true })).toHaveCount(0);\n await expect(page.getByTestId('sync-recovery-banner')).toContainText('Still checking your move', { timeout: 15000 });\n",
    "after": ""
  }
];
function normalizeAcceptedRecoveryCase(current,inversions=acceptedRecoveryDelta) {
 assert.equal(current.split(retryRead).length,2,'exact one-reset fixture GET option');
 let normalized=current.replace(retryRead,originalRead);
 assert.equal(digest(normalized),acceptedRecoveryCaseHash,'exact accepted182 recovery case');
 assert.equal(inversions.length,3,'all three accepted182 edits must be inverted');
 let previous=-1;
 for(const {before} of inversions){
  assert.ok(before&&normalized.split(before).length===2,'exact accepted182 edit body/count');
  const at=normalized.indexOf(before);assert.ok(at>previous,'accepted182 edit order');previous=at;
 }
 for(const {before,after} of [...inversions].reverse())normalized=normalized.replace(before,after);
 assert.equal(digest(normalized),originalCaseHash,
  'Every original action, oracle, deadline and route statement must remain unchanged');
 return normalized;
}


// Execute the real intercepted callback, including its semantic request matcher
// and receipt construction. Only the thin Playwright route interface is adapted
// to an actual incoming HTTP request. Both inner GETs and the single outer POST
// use the pinned APIRequestContext implementation and real loopback sockets.
function callbackSource(original=false) {
 assert.equal(source.split(caseStart).length,2);
 assert.equal(source.split(caseEnd).length,2);
 assert.equal(caseSource.split(retryRead).length,2);
 normalizeAcceptedRecoveryCase(caseSource);
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


test('accepted182 case edits invert exactly to the original246 golden',()=>{
 assert.equal(digest(normalizeAcceptedRecoveryCase(caseSource)),originalCaseHash);
 assert.equal(digest(caseSource.replace(retryRead,originalRead)),acceptedRecoveryCaseHash);
});
test('missing, reordered and changed accepted182 inversions fail closed',()=>{
 assert.throws(()=>normalizeAcceptedRecoveryCase(caseSource,acceptedRecoveryDelta.slice(1)),/all three/);
 assert.throws(()=>normalizeAcceptedRecoveryCase(caseSource,[...acceptedRecoveryDelta].reverse()),/edit order/);
 const changed=structuredClone(acceptedRecoveryDelta);changed[0].before+='unreviewed-body';
 assert.throws(()=>normalizeAcceptedRecoveryCase(caseSource,changed),/edit body\/count/);
 const wrongOriginal=structuredClone(acceptedRecoveryDelta);wrongOriginal[1].after+=' ';
 assert.throws(()=>normalizeAcceptedRecoveryCase(caseSource,wrongOriginal),/Every original action/);
});
test('changed native action or original assertion cannot hide behind case compatibility',()=>{
 const action='await submitPlayableAction(page,action);';assert.equal(caseSource.split(action).length,2);
 assert.throws(()=>normalizeAcceptedRecoveryCase(caseSource.replace(action,action+'\n await page.mouse.click(1,1);')),/exact accepted182/);
 const oracle='expect(unknownResponses).toBeGreaterThan(0);';assert.equal(caseSource.split(oracle).length,2);
 assert.throws(()=>normalizeAcceptedRecoveryCase(caseSource.replace(oracle,oracle.replace('(0)','(1)'))),/exact accepted182/);
});
test('changed route or original and accepted deadlines remain sealed',()=>{
 const route='if(mode==="accept"){await route.continue();return;}';assert.equal(caseSource.split(route).length,2);
 assert.throws(()=>normalizeAcceptedRecoveryCase(caseSource.replace(route,route.replace('continue()','abort()'))),/exact accepted182/);
 for(const [before,after] of [['test.setTimeout(90000);','test.setTimeout(90001);'],['{timeout:20000}','{timeout:20001}']]){
  assert.ok(caseSource.includes(before));assert.throws(()=>normalizeAcceptedRecoveryCase(caseSource.replace(before,after)),/exact accepted182/);
 }
});
test('duplicate reset-read option cannot gain another permitted fixture request',()=>{
 assert.throws(()=>normalizeAcceptedRecoveryCase(caseSource+'\n'+retryRead),/exact one-reset/);
});
