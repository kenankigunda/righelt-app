import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import {once,EventEmitter} from 'node:events';
import {chromium} from '@playwright/test';
import {wire, party,closeContexts} from '../e2e/support/sync-recovery-fixture.mjs';

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
  const observedPage={context:()=>context,unrouteAll:page.unrouteAll.bind(page),once:page.once.bind(page),off:page.off.bind(page),isClosed:page.isClosed.bind(page),routeWebSocket:page.routeWebSocket.bind(page),route:(pattern,handler)=>page.route(pattern,async route=>{
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
  const context={newPage:async()=>{
   if(failure==='page')throw cause;
   const page=new EventEmitter();page.context=()=>context;page.unrouteAll=async()=>{};page.routeWebSocket=async()=>{throw cause;};return page;
  },unrouteAll:async()=>{unrouted.push(id);if(id===0)throw new Error('cleanup route error');},close:async()=>{closed.push(id);}};
  return context;
 }};
 await assert.rejects(party(browser,'http://unused'),error=>error instanceof AggregateError&&error.cause===cause&&error.errors[0]===cause);
 const expected=failure==='context'?[0]:[0,1,2];
 assert.deepEqual(unrouted.sort(),expected);assert.deepEqual(closed.sort(),expected);
});

function socketFixture() {
 const page=new EventEmitter(),context={unrouteAll:async()=>{},close:async()=>{page.emit('close');}};
 page.context=()=>context;page.isClosed=()=>false;page.route=async()=>{};page.unrouteAll=async()=>{};
 page.routeWebSocket=async(pattern,handler)=>{page.open=()=>{
  const sent=[],closures=[],upstreamClosures=[];let receive,pageClose,serverClose;
  const server={onMessage:f=>{receive=f;},onClose:f=>{serverClose=f;},close:async options=>{upstreamClosures.push(options);}};
  const socket={connectToServer:()=>server,send:message=>{sent.push(message);},onClose:f=>{pageClose=f;},close:async options=>{closures.push(options);}};
  handler(socket);
  return {sent,closures,upstreamClosures,message:value=>receive(value),pageClose:(...args)=>pageClose?.(...args),serverClose:(...args)=>serverClose?.(...args)};
 };};
 return {page,context};
}
for(const boundary of ['page','socket','server','dispose'])test(`lifecycle cancels delayed delivery at ${boundary} closure`,async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const {page,context}=socketFixture();const fault=await wire(page);const socket=page.open();
 socket.message('pending');
 if(boundary==='page')page.emit('close');
 if(boundary==='socket')await socket.pageClose(1000,'done');
 if(boundary==='server')await socket.serverClose(1001,'restart');
 if(boundary==='dispose')await closeContexts([context]);
 t.mock.timers.tick(100);
 assert.deepEqual(socket.sent,[]);assert.equal(fault.lastInbound,0);
 if(boundary==='socket')assert.deepEqual(socket.upstreamClosures,[{code:1000,reason:'done'}]);
 if(boundary==='server')assert.deepEqual(socket.closures,[{code:1001,reason:'restart'}]);
});
test('lifecycle retains latency and receive loss and isolates socket replacement',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const {page}=socketFixture();const fault=await wire(page);const first=page.open(),second=page.open();
 first.message('old');second.message('new');await first.serverClose(1001,'restart');
 t.mock.timers.tick(99);assert.deepEqual(second.sent,[]);t.mock.timers.tick(1);
 assert.deepEqual(first.sent,[]);assert.deepEqual(second.sent,['new']);assert.ok(fault.lastInbound>0);
 fault.receive=true;second.message('lost');t.mock.timers.tick(100);assert.deepEqual(second.sent,['new']);
 fault.receive=false;second.message('restored');t.mock.timers.tick(100);assert.deepEqual(second.sent,['new','restored']);
});
test('lifecycle teardown waits for every context close before completing',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const releases=[],closed=[];let settled=false;
 const contexts=[0,1].map(id=>({unrouteAll:async()=>{},close:()=>new Promise(resolve=>releases.push(()=>{closed.push(id);resolve();}))}));
 const cleanup=closeContexts(contexts).then(()=>{settled=true;});
 try{
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(releases.length,2);
  t.mock.timers.tick(3001);for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(settled,false,'teardown must not abandon pending context.close');
  releases[0]();for(let i=0;i<20;i++)await Promise.resolve();assert.equal(settled,false);
 }finally{releases.forEach(release=>release());await cleanup;}
 assert.equal(settled,true);assert.deepEqual([...new Set(closed)].sort(),[0,1]);
});
test('lifecycle cleanup disposes twin pages and closes all contexts despite an unroute failure',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const a=socketFixture(),b=socketFixture();b.page.context=()=>a.context;
 await wire(a.page);await wire(b.page);const one=a.page.open(),two=b.page.open();one.message('one');two.message('two');
 let closes=0;a.context.unrouteAll=async()=>{throw new Error('unroute failed');};a.context.close=async()=>{closes++;};
 const other={unrouteAll:async()=>{},close:async()=>{closes++;}};
 await assert.rejects(closeContexts([a.context,other]),/cleanup failed/i);
 t.mock.timers.tick(100);assert.deepEqual(one.sent,[]);assert.deepEqual(two.sent,[]);assert.equal(closes,2);
});

test('lifecycle disposal is idempotent and still propagates both socket closes',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {page,context}=socketFixture();await wire(page);const socket=page.open();let closes=0;
 context.close=async()=>{closes++;page.emit('close');};
 socket.message('pending');await Promise.all([closeContexts([context,context]),closeContexts([context])]);
 await socket.pageClose(1000,'page');await socket.pageClose(1000,'page');
 await socket.serverClose(1001,'server');await socket.serverClose(1001,'server');
 t.mock.timers.tick(100);
 assert.equal(closes,1);assert.deepEqual(socket.sent,[]);
 assert.deepEqual(socket.upstreamClosures,[{code:1000,reason:'page'}]);
 assert.deepEqual(socket.closures,[{code:1001,reason:'server'}]);
 assert.equal(page.listenerCount('close'),0);assert.equal(page.listenerCount('crash'),0);
});
test('lifecycle waits for each page HTTP handler separately from context routes',async()=>{
 let release,closed=false,contextUnrouted=false,twinUnrouted=false;
 const a=socketFixture(),b=socketFixture();b.page.context=()=>a.context;
 await wire(a.page);await wire(b.page);
 a.page.unrouteAll=async options=>{
  assert.equal(options.behavior,'wait');await new Promise(resolve=>{release=resolve;});
 };
 b.page.unrouteAll=async options=>{assert.equal(options.behavior,'wait');twinUnrouted=true;};
 a.context.unrouteAll=async options=>{assert.equal(options.behavior,'wait');contextUnrouted=true;};
 a.context.close=async()=>{closed=true;};
 const cleanup=closeContexts([a.context]);
 try{
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(contextUnrouted,true);assert.equal(twinUnrouted,true);
  assert.equal(closed,false,'pending page route must prevent context closure');assert.equal(typeof release,'function');
 }finally{release?.();await cleanup;}
 assert.equal(closed,true);
});
test('lifecycle attempts every page route and context close while retaining cleanup failures',async()=>{
 const a=socketFixture(),b=socketFixture();b.page.context=()=>a.context;
 await wire(a.page);await wire(b.page);const attempted=[];
 a.page.unrouteAll=async()=>{attempted.push('page');throw new Error('page failure');};
 b.page.unrouteAll=async()=>{attempted.push('twin');};
 a.context.unrouteAll=async()=>{attempted.push('context');throw new Error('context failure');};
 a.context.close=async()=>{attempted.push('close');throw new Error('close failure');};
 await assert.rejects(closeContexts([a.context]),error=>{
  assert.deepEqual(error.errors[0].errors.map(e=>e.message),['page failure','context failure','close failure']);return true;
 });
 assert.deepEqual(attempted,['page','twin','context','close']);
});
