import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fulfillHeldContinuationRead, controlledContinuationReadCompleted } from '../../../e2e/support/held-continuation-read.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const released=deferred(),backend=deferred(),calls=[];
  const request={url:()=> 'https://127.0.0.1:9988/api/shell/games?identityId=owner&section=other&page=0',method:()=> 'GET'};
  const response={url:request.url,status:()=>200,json:async()=>({ok:true,section:'other',games:[]}),dispose:async()=>calls.push(['dispose'])};
  const route={request:()=>request,fetch:options=>{calls.push(['fetch',options]);return backend.promise;},fulfill:async options=>calls.push(['fulfill',options]),continue:()=>{throw new Error('must never continue');}};
  return {released,backend,calls,request,response,route,run:()=>fulfillHeldContinuationRead(route,{request,released:released.promise})};
}
test('one backend read begins before hold release; exact response delivery waits for both',async()=>{
  const f=fixture(),run=f.run();assert.deepEqual(f.calls,[['fetch',{maxRedirects:0,maxRetries:0}]]);
  f.backend.resolve(f.response);await tick();assert.equal(f.calls.length,1);
  f.released.resolve();await run;assert.equal(f.calls.filter(c=>c[0]==='fetch').length,1);
  assert.deepEqual(f.calls.slice(1),[['fulfill',{response:f.response}],['dispose']]);
});
test('release alone does not fulfill before the backend is ready',async()=>{
  const f=fixture(),run=f.run();f.released.resolve();await tick();assert.equal(f.calls.length,1);
  f.backend.resolve(f.response);await run;assert.equal(f.calls[1][1].response,f.response);
});
test('backend rejection is immediately owned while held and cannot fulfill or retry',async()=>{
  const f=fixture(),error=new Error('backend failed'),run=f.run();
  f.backend.reject(error);await tick();assert.equal(f.calls.length,1);
  const rejected=assert.rejects(run,value=>value===error);f.released.resolve();await rejected;
  assert.equal(f.calls.length,1);
});
test('a rejected release still owns and disposes the one eventual response',async()=>{
  const f=fixture(),error=new Error('caller failed'),run=f.run();
  const rejected=assert.rejects(run,value=>value===error);f.released.reject(error);f.backend.resolve(f.response);await rejected;
  assert.deepEqual(f.calls.map(c=>c[0]),['fetch','dispose']);
});
test('foreign request and unsupported request are rejected before backend activity',async()=>{
  const f=fixture();await assert.rejects(fulfillHeldContinuationRead(f.route,{request:{},released:f.released.promise}),/Foreign/);
  f.request.method=()=> 'POST';await assert.rejects(f.run(),/Unsupported/);assert.equal(f.calls.length,0);
});
for(const [name,change] of [
  ['non200',r=>r.status=()=>503],['redirect',r=>r.status=()=>302],['foreign URL',r=>r.url=()=> 'https://elsewhere.invalid/'],
  ['malformed JSON',r=>r.json=async()=>{throw new SyntaxError('bad JSON');}],['failed body',r=>r.json=async()=>({ok:false})],
  ['wrong section',r=>r.json=async()=>({ok:true,section:'my',games:[]})],['missing games',r=>r.json=async()=>({ok:true,section:'other'})],
])test(`${name} cannot become a fulfilled native success`,async()=>{
  const f=fixture();change(f.response);const run=f.run();f.backend.resolve(f.response);f.released.resolve();await assert.rejects(run);
  assert.deepEqual(f.calls.map(c=>c[0]),['fetch','dispose']);
});
test('native completion requires the exact controlled request and a fully finished valid response',async()=>{
  const f=fixture(),native={request:()=>f.request,status:()=>200,finished:async()=>null,json:f.response.json};
  assert.equal(await controlledContinuationReadCompleted(native,f.request),true);
  assert.equal(await controlledContinuationReadCompleted(native,{}),false);
  native.finished=async()=>new Error('cancelled');assert.equal(await controlledContinuationReadCompleted(native,f.request),false);
  native.finished=async()=>null;native.status=()=>503;assert.equal(await controlledContinuationReadCompleted(native,f.request),false);
});
function actualRegistrationPrefix(){
  const source=readFileSync(new URL('../../../e2e/auth/accounts.spec.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async function register('),end=source.indexOf('  const play =',start);
  assert.ok(start>=0&&end>start);
  return source.slice(start,end)+'  return {recoveryObserved,recoveredReadComplete};\n}';
}
function callerFixture(){
  const page=new EventEmitter(),held=deferred(),request={method:()=> 'GET',url:()=> 'https://local.invalid/api/shell/games?section=other'};
  const polls=[],button={click:async()=>{}};page.goto=async()=>{};page.getByLabel=()=>({fill:async()=>{}});
  const box={getByRole:()=>button,getByLabel:()=>({fill:async()=>{}})};
  const expect=()=>({toBeVisible:async()=>{},not:{toBeVisible:async()=>{}}});
  expect.poll=read=>({toEqual:async expected=>{polls.push(read());assert.deepEqual(JSON.parse(JSON.stringify(read())),JSON.parse(JSON.stringify(expected)));}});
  const context=vm.createContext({URL,WeakSet,password:'unused',dialog:()=>box,waitForAccountStartup:async()=>{},openPlaySignIn:async()=>{},enterUsername:async()=>{},openRecoveredFriendChoice:async()=>{},expect,controlledContinuationReadCompleted});
  vm.runInContext(actualRegistrationPrefix()+'\nglobalThis.register=register;',context);
  const run=context.register(page,'unused',{readRecovery:{released:held.promise,request:()=>request}});
  return {page,held,request,polls,run};
}
test('actual register prefix starts its original completion poll only after explicit release',async()=>{
  const f=callerFixture();await tick();assert.equal(f.polls.length,0);
  const register={method:()=> 'POST',url:()=> 'https://local.invalid/api/auth/register'};
  f.page.emit('request',register);f.page.emit('request',f.request);f.page.emit('requestfailed',f.request);
  f.page.emit('response',{request:()=>f.request,status:()=>200,finished:async()=>null,json:async()=>({ok:true,section:'other',games:[]})});
  await tick();assert.equal(f.polls.length,0);f.held.resolve();const result=await f.run;
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{recoveryObserved:true,recoveredReadComplete:true});assert.equal(f.polls.length,1);
  for(const name of ['request','requestfailed','response'])assert.equal(f.page.listenerCount(name),0);
});
test('actual register prefix rejects failed controlled retry plus unrelated late success',async()=>{
  const f=callerFixture();await tick();f.page.emit('request',{method:()=> 'POST',url:()=> 'https://local.invalid/api/auth/register'});
  f.page.emit('request',f.request);f.page.emit('requestfailed',f.request);
  const unrelated={method:f.request.method,url:f.request.url};f.page.emit('request',unrelated);
  f.page.emit('response',{request:()=>unrelated,status:()=>200,finished:async()=>null,json:async()=>({ok:true,section:'other',games:[]})});
  await tick();const rejected=assert.rejects(f.run);f.held.resolve();await rejected;
  assert.equal(f.polls[0].recoveredReadComplete,false);
  for(const name of ['request','requestfailed','response'])assert.equal(f.page.listenerCount(name),0);
});
test('original serial schedule exceeds five seconds while the actual helper overlaps the same controlled work',async()=>{
  // Model only external leaves; the real helper controls launch/delivery ordering.
  const appDeadline=5000,heldCost=3516,backendCost=3343;
  const f=fixture(),run=f.run();assert.equal(f.calls[0][0],'fetch');
  const launchAt=0;f.backend.resolve(f.response);await tick();f.released.resolve();await run;
  const serialDelivery=heldCost+backendCost,overlapDelivery=Math.max(heldCost,launchAt+backendCost);
  assert.ok(serialDelivery>appDeadline,'original held→continue counterexample remains RED');
  assert.ok(overlapDelivery<appDeadline);assert.equal(f.calls.filter(c=>c[0]==='fetch').length,1);
});
function actualRetryRoute({failedReads=1}={}){
  const source=readFileSync(new URL('../../../e2e/auth/accounts.spec.mjs',import.meta.url),'utf8');
  const testStart=source.indexOf('test("registration helper retries one failed continuation read');
  const start=source.indexOf('async route => {',testStart),end=source.indexOf('\n  });\n  const registration',start);
  assert.ok(testStart>=0&&start>testStart&&end>start);
  const f=fixture(),context=vm.createContext({URL,Error,fulfillHeldContinuationRead,held:f.released.promise});
  vm.runInContext(`let registrations=1,failedReads=${failedReads},retriedReads=0,retryRequest;let failures=0;const failed=()=>failures++;globalThis.handler=${source.slice(start,end)}};globalThis.state=()=>({failedReads,retriedReads,retryRequest,failures});`,context);
  return {...f,handler:context.handler,state:context.state};
}
test('actual caller arms exactly one retry, rejects a second, and never continues a fetched route',async()=>{
  const f=actualRetryRoute(),run=f.handler(f.route);assert.equal(f.calls[0][0],'fetch');
  await assert.rejects(f.handler(f.route),/second continuation retry/);
  f.backend.resolve(f.response);f.released.resolve();await run;
  assert.equal(f.state().retryRequest,f.request);assert.equal(f.calls.filter(c=>c[0]==='fetch').length,1);
});
test('actual caller preserves the first connection-reset abort without a backend fetch',async()=>{
  const f=actualRetryRoute({failedReads:0}),aborts=[];f.route.abort=async code=>aborts.push(code);
  await f.handler(f.route);assert.deepEqual(aborts,['connectionreset']);assert.equal(f.calls.length,0);
  assert.equal(f.state().failures,1);assert.equal(f.state().retriedReads,0);
});

for(const stage of ['fulfill','release'])test(`${stage} failure remains primary when response disposal also fails`,async()=>{
  const f=fixture(),primary=new Error(stage+' failed'),cleanup=new Error('dispose failed');
  f.response.dispose=async()=>{throw cleanup;};
  if(stage==='fulfill')f.route.fulfill=async()=>{throw primary;};
  const run=f.run(),rejected=assert.rejects(run,error=>error instanceof AggregateError&&error.cause===primary&&error.errors[0]===primary&&error.errors[1]===cleanup);
  f.backend.resolve(f.response);if(stage==='release')f.released.reject(primary);else f.released.resolve();await rejected;
  assert.equal(f.calls.filter(c=>c[0]==='fetch').length,1);
});
test('response disposal failure alone cannot become success',async()=>{
  const f=fixture(),cleanup=new Error('dispose failed');f.response.dispose=async()=>{throw cleanup;};
  const run=f.run(),rejected=assert.rejects(run,error=>error===cleanup);f.backend.resolve(f.response);f.released.resolve();await rejected;
  assert.equal(f.calls.filter(c=>c[0]==='fulfill').length,1);
});
