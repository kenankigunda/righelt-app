import test from 'node:test';
import assert from 'node:assert/strict';
import {createFaultLifecycle,fetchFaultResponse,disposeFaultContexts} from '../../../e2e/support/fault-lifecycle.mjs';
function fixture() {
 const timers=new Map();let next=0;
 const lifecycle=createFaultLifecycle({setTimer: callback=>{const id=++next;timers.set(id,callback);return id;},clearTimer:id=>timers.delete(id)});
 return {lifecycle,timers};
}
test('relay resets reach the browser without retrying, while unrelated relay errors still fail',async()=>{
 const calls=[];let resets=0;
 const route={fetch:async options=>{calls.push(options);throw Error('route.fetch: read ECONNRESET');},abort:async code=>calls.push(code)};
 assert.equal(await fetchFaultResponse(route,{timeout:100},()=>resets++),null);
 assert.equal(resets,1);assert.deepEqual(calls,[{timeout:100},'connectionreset']);
 const response={ok:true};assert.equal(await fetchFaultResponse({fetch:async()=>response,abort:()=>assert.fail('no abort')},{}),response);
 await assert.rejects(fetchFaultResponse({fetch:async()=>{throw Error('bad response parsing');},abort:()=>assert.fail('no abort')},{}),/bad response parsing/);
});
test('disposal cancels delayed sends, including a callback already queued by the timer',async()=>{
 const {lifecycle,timers}=fixture();let sends=0;
 lifecycle.schedule(()=>sends++,100);const callback=[...timers.values()][0];
 await lifecycle.dispose();callback();lifecycle.schedule(()=>sends++,100);
 assert.equal(sends,0);assert.equal(timers.size,0);
});
test('disposal releases delayed routes and waits for their pending work',async()=>{
 const {lifecycle,timers}=fixture();let finished=false;
 const task=lifecycle.run(async()=>{await lifecycle.wait(100);assert.equal(lifecycle.disposed,true);finished=true;});
 await Promise.resolve();assert.equal(timers.size,1);
 await lifecycle.dispose();await task;
 assert.equal(finished,true);assert.equal(timers.size,0);
});
test('active delayed-send and route errors remain failures of their owning test',async()=>{
 const {lifecycle,timers}=fixture();const sendError=Error('send failure'),routeError=Error('route failure');
 lifecycle.schedule(()=>{throw sendError;},100);[...timers.values()][0]();
 await lifecycle.run(async()=>{throw routeError;});
 await assert.rejects(lifecycle.dispose(),error=>error instanceof AggregateError&&error.errors[0]===sendError&&error.errors[1]===routeError);
});
test('disposal waits for in-flight work and preserves errors even during cleanup',async()=>{
 const {lifecycle}=fixture();let release;const gate=new Promise(resolve=>release=resolve);const failure=Error('in-flight failure');
 const task=lifecycle.run(async()=>{await gate;throw failure;});await Promise.resolve();let disposed=false;
 const disposal=lifecycle.dispose().finally(()=>disposed=true);
 await Promise.resolve();assert.equal(disposed,false);release();
 await assert.rejects(disposal,error=>error.errors[0]===failure);await task;
});

test('stop prevents a queued route callback from starting',async()=>{
 const {lifecycle}=fixture();let callbacks=0;
 const task=lifecycle.run(()=>callbacks++);lifecycle.stop();
 await task;await lifecycle.dispose();assert.equal(callbacks,0);
});

test('context cleanup owns twin helpers and partially initialized contexts',async()=>{
 const events=[];
 const context=name=>({unrouteAll:async options=>{assert.equal(options.behavior,'wait');events.push(`${name}:unroute`);},close:async()=>events.push(`${name}:close`)});
 const full=context('full'),partial=context('partial');
 const helpers=[fixture(),fixture()];let sends=0;
 helpers.forEach(({lifecycle})=>lifecycle.schedule(()=>sends++,100));
 const resources={faults:new Map([[full,helpers.map(f=>f.lifecycle)],[partial,[]]]),contexts:new Set([full,partial])};
 await disposeFaultContexts(resources,[full,partial]);
 assert.equal(sends,0);helpers.forEach(({timers})=>assert.equal(timers.size,0));
 assert.equal(resources.faults.size,0);assert.equal(resources.contexts.size,0);
 for(const name of ['full','partial']) assert.ok(events.indexOf(`${name}:unroute`)<events.indexOf(`${name}:close`));
});
test('cleanup awaits owned context closure and drains helpers when unroute fails',async()=>{
 const {lifecycle,timers}=fixture();lifecycle.schedule(()=>{},100);
 let closeFinished=false,release;const gate=new Promise(resolve=>release=resolve);
 const context={unrouteAll:async()=>{throw Error('unroute failure');},close:async()=>{await gate;closeFinished=true;}};
 const resources={faults:new Map([[context,[lifecycle]]]),contexts:new Set([context])};
 const cleanup=disposeFaultContexts(resources,[context]);
 await Promise.resolve();await Promise.resolve();assert.equal(closeFinished,false);release();
 await assert.rejects(cleanup,/Recovery test cleanup failed/);assert.equal(closeFinished,true);assert.equal(timers.size,0);
});

test('nested cleanup reports transport causes while preserving failures and omitting request details',async()=>{
 const {lifecycle}=fixture();
 const failure=Error('route.fetch: read ECONNRESET\nCall log:\n  authorization: private-test-value');
 await lifecycle.run(async()=>{throw failure;});
 let closed=false;
 const context={unrouteAll:async()=>{},close:async()=>{closed=true;}};
 const resources={faults:new Map([[context,[lifecycle]]]),contexts:new Set([context])};
 await assert.rejects(disposeFaultContexts(resources,[context]),error=>{
  assert.match(error.message,/Recovery test cleanup failed: Fault cleanup failed: Fault helper asynchronous work failed: route.fetch: read ECONNRESET/);
  assert.doesNotMatch(error.message,/private-test-value|authorization|Call log/);
  assert.equal(error.errors[0].errors[0].errors[0],failure);
  return true;
 });
 assert.equal(closed,true);
 assert.equal(resources.faults.size,0);assert.equal(resources.contexts.size,0);
});

for(const error of [Object.assign(Error('relay failed'),{code:'ECONNRESET'}),Error('socket hang up'),Error('route.fetch: socket hang up\nCall log:\nrequest details')])test(`relay reset spelling settles exactly once: ${error.message.split('\n')[0]}`,async()=>{
 let aborted=0,resets=0,fetched=0;
 assert.equal(await fetchFaultResponse({fetch:async()=>{fetched++;throw error;},abort:async code=>{assert.equal(code,'connectionreset');aborted++;}},{},()=>resets++),null);
 assert.equal(fetched,1);assert.equal(aborted,1);assert.equal(resets,1);
});
test('relay refusal, timeout and unrelated socket descriptions remain observable',async()=>{
 for(const message of ['route.fetch: ECONNREFUSED','route.fetch: Timeout 30000ms exceeded','parsing socket hang up response']){
  const error=Error(message);await assert.rejects(fetchFaultResponse({fetch:async()=>{throw error;},abort:()=>assert.fail('must not swallow')},{}),caught=>caught===error);
 }
});
test('reset abort failure remains observable',async()=>{
 const error=Error('abort failed');await assert.rejects(fetchFaultResponse({fetch:async()=>{throw Error('socket hang up');},abort:async()=>{throw error;}},{}),caught=>caught===error);
});
