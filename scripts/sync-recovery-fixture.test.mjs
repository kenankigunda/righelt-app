import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import {once} from 'node:events';
import {chromium} from '@playwright/test';
import {wire, party} from '../e2e/support/sync-recovery-fixture.mjs';

// This controlled peer demonstrates the auxiliary client's failure boundary.
// It does not claim to reproduce the unobserved Linux packet ordering in CI.
async function peer(handler) {
 const sockets=new Set();
 const server=http.createServer(handler);
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 return {url:`http://127.0.0.1:${server.address().port}`,close:async()=>{
  const closed=new Promise(resolve=>server.close(resolve));
  for(const socket of sockets)socket.destroy();
  await closed;
 }};
}
async function closeAll(...closers) {
 const settled=await Promise.allSettled(closers.map(close=>Promise.resolve().then(close)));
 const failures=settled.filter(result=>result.status==='rejected').map(result=>result.reason);
 if(failures.length)throw new AggregateError(failures,'Fixture cleanup failed');
}
for(const dropAfterCommit of [false,true]) {
test(`native browser prerequisites avoid an auxiliary pooled disconnect (${dropAfterCommit?'after':'before'} commit)`,{timeout:15000},async()=>{
 let warmedSocket;const received=[],committed=[];let auxiliaryDrops=0;
 const backend=await peer((req,res)=>{
  if(req.url==='/pool-warm'){warmedSocket=req.socket;res.end('warm');return;}
  if(req.method==='POST'){
   const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
    const record={path:req.url,body:Buffer.concat(chunks).toString(),cookie:req.headers.cookie};received.push(record);
    if(req.socket===warmedSocket){auxiliaryDrops++;if(dropAfterCommit)committed.push(record);req.socket.end();return;}
    committed.push(record);res.writeHead(200,{'Content-Type':'application/json'});res.end('{"joined":true}');
   });return;
  }
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Transport fixture</title>');
 });
 let browser,context;const routeErrors=[];
 try {
  browser=await chromium.launch({headless:true});context=await browser.newContext();const page=await context.newPage();
  await context.addCookies([{name:'fixture',value:'same-session',url:backend.url}]);
  // Preserve route errors as evidence while allowing the expected negative
  // control to finish and close its browser and sockets.
  const observedPage={routeWebSocket:page.routeWebSocket.bind(page),route:(pattern,handler)=>page.route(pattern,async route=>{
   try{await handler(route);}catch(error){routeErrors.push(error.message);await route.abort();}
  })};
  const fault=await wire(observedPage,{interceptHttp:false});
  await page.goto(backend.url);
  await (await page.request.get(`${backend.url}/pool-warm`)).body();
  const result=await page.evaluate(async()=>{
   try{const response=await fetch('/api/shell/games/fixture/join',{method:'POST',body:'join-once'});return {status:response.status,body:await response.json()};}
   catch(error){return {error:error.message};}
  });
  assert.deepEqual(result,{status:200,body:{joined:true}},JSON.stringify({result,routeErrors,auxiliaryDrops,received,committed}));
  assert.equal(auxiliaryDrops,0);assert.deepEqual(routeErrors,[]);
  assert.deepEqual(received,[{path:'/api/shell/games/fixture/join',body:'join-once',cookie:'fixture=same-session'}]);
  assert.deepEqual(committed,received);assert.equal(fault.requests,0);
 }finally{await closeAll(()=>browser?.close(),()=>backend.close());}
});
}
test('armed HTTP faults lose a committed reply once and retain recovery controls',{timeout:15000},async()=>{
 const posts=[];let reconciles=0;
 const backend=await peer((req,res)=>{
  if(req.method==='POST'&&req.url.endsWith('/apply')){
   const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
    const command=JSON.parse(Buffer.concat(chunks));posts.push(command);
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({game:{revision:posts.length},commandOutcomes:[{clientCommandId:command.clientCommandId,status:'applied'}]}));
   });return;
  }
  if(req.url.endsWith('/reconcile')){reconciles++;res.writeHead(200,{'Content-Type':'application/json'});res.end('{"game":{"revision":1}}');return;}
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Fault fixture</title>');
 });
 let browser,context;
 try{
  browser=await chromium.launch({headless:true});context=await browser.newContext();const page=await context.newPage();
  const fault=await wire(page,{interceptHttp:false});await page.goto(backend.url);
  fault.interceptHttp=true;fault.loseAtApply=true;
  const send=()=>page.evaluate(async()=>{
   try{return (await fetch('/api/shell/games/fixture/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientCommandId:'one-command'})})).status;}catch{return 'lost';}
  });
  assert.equal(await send(),'lost');assert.equal(posts.length,1);assert.equal(fault.commands.length,1);
  assert.equal(fault.receive,true);assert.equal(fault.loseReply,true);assert.equal(fault.outcomes[0].clientCommandId,'one-command');
  const recover=()=>page.evaluate(async()=>{try{return (await fetch('/api/shell/games/fixture/reconcile',{method:'POST',body:'{}'})).status;}catch{return 'lost';}});
  assert.equal(await recover(),'lost');assert.equal(reconciles,0);
  fault.loseReply=false;fault.receive=false;fault.interruptNextRecovery=true;
  assert.equal(await recover(),'lost');assert.equal(reconciles,1);assert.equal(fault.interruptedRecoveries,1);assert.equal(fault.http,true);
  fault.http=false;assert.equal(await recover(),200);assert.equal(reconciles,2);
  // Neither dropped response nor recovery may replay the mutation.
  assert.deepEqual(posts,[{clientCommandId:'one-command'}]);
  fault.holdApply=true;assert.equal(await send(),'lost');assert.equal(posts.length,1);
  assert.equal(fault.requests,5);assert.equal(fault.commands.length,2);assert.equal(fault.snapshots,3);assert.ok(fault.bytes>0);
 }finally{await closeAll(()=>browser?.close(),()=>backend.close());}
});

for(const failure of ['context','page','wire'])test(`party setup closes every acquired context after ${failure} failure`,async()=>{
 const cause=new Error(`setup-${failure}`),closed=[],unrouted=[];let created=0;
 const browser={newContext:async()=>{
  const id=created++;
  if(failure==='context'&&id===1)throw cause;
  return {newPage:async()=>{
   if(failure==='page')throw cause;
   return {routeWebSocket:async()=>{throw cause;}};
  },unrouteAll:async()=>{unrouted.push(id);if(id===0)throw new Error('cleanup route error');},close:async()=>{closed.push(id);}};
 }};
 await assert.rejects(party(browser,'http://unused'),error=>error===cause);
 const expected=failure==='context'?[0]:[0,1,2];
 assert.deepEqual(unrouted.sort(),expected);assert.deepEqual(closed.sort(),expected);
});
