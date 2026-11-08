import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installWorkerLifecycle} from './page-observer.mjs';
import {initialize,resolve} from './test-import-hook.mjs';
function fixture({throwConsole=false,protocol='http:',maxRows=4096,nonce='document-a',constructorError}={}){
 const calls=[],rows=[];
 class NativeWorker{
  constructor(...args){calls.push({kind:'construct',thisValue:this,args,newTarget:new.target});if(constructorError)throw constructorError;this.listeners=new Map();}
  addEventListener(kind,listener){const list=this.listeners.get(kind)??[];list.push(listener);this.listeners.set(kind,list);}
  dispatch(kind,event){for(const listener of this.listeners.get(kind)??[])listener(event);this['on'+kind]?.(event);}
  postMessage(...args){assert(this instanceof NativeWorker);calls.push({kind:'post',thisValue:this,args});if(this.postError)throw this.postError;return this.postResult;}
  terminate(...args){assert(this instanceof NativeWorker);calls.push({kind:'terminate',thisValue:this,args});if(this.terminateError)throw this.terminateError;return this.terminateResult;}
 }
 const scope={Worker:NativeWorker,location:{protocol},document:{readyState:'loading'},crypto:{randomUUID:()=>nonce},performance:{now:()=>12,timeOrigin:1000},console:{debug:value=>{if(throwConsole)throw Error('observer sink');rows.push(JSON.parse(value.slice(2)));}}};
 vm.runInNewContext(`(${installWorkerLifecycle.toString()})({prefix:'!!',contextId:'context-a',maxRows:${maxRows},maxText:65536})`,scope);
 return{scope,NativeWorker,calls,rows};
}
test('constructor returns the native object and preserves subclass prototype/newTarget',()=>{
 const f=fixture(),w=new f.scope.Worker('blob:original',{type:'module'});
 assert.equal(Object.getPrototypeOf(w),f.NativeWorker.prototype);assert(w instanceof f.NativeWorker);assert(w instanceof f.scope.Worker);
 class Derived extends f.scope.Worker{}const d=new Derived('rules-worker.js');assert.equal(Object.getPrototypeOf(d),Derived.prototype);assert.equal(f.calls.at(-1).newTarget,Derived);
});
test('post delegates exact receiver, payload, transfer list and return identity',()=>{
 const f=fixture(),w=new f.scope.Worker('blob:a'),data={type:'initialize',id:1,bytes:new Uint8Array([1,2])},transfer=[data.bytes.buffer],result=Promise.resolve('native');w.postResult=result;
 assert.equal(w.postMessage(data,transfer),result);const call=f.calls.at(-1);assert.equal(call.thisValue,w);assert.equal(call.args[0],data);assert.equal(call.args[1],transfer);assert.equal(call.args.length,2);
 assert(!JSON.stringify(f.rows).includes('bytes'));
});
test('post and constructor preserve the original thrown object without invoking error getters',()=>{
 const f=fixture(),w=new f.scope.Worker('blob:a');let reads=0;const error={get name(){reads++;throw Error('getter');}};w.postError=error;
 assert.throws(()=>w.postMessage({id:1}),actual=>actual===error);assert.equal(reads,0);
 const failing=fixture({constructorError:error});
 assert.throws(()=>new failing.scope.Worker('bad'),actual=>actual===error);assert.equal(reads,0);assert(failing.rows.some(row=>row.kind==='constructor-threw'));
});
test('terminate preserves exact receiver, arguments, return and native error',()=>{
 const f=fixture(),w=new f.scope.Worker('rules-worker.js'),result={native:true};w.terminateResult=result;
 assert.equal(w.terminate('original'),result);assert.equal(f.calls.at(-1).thisValue,w);assert.deepEqual(f.calls.at(-1).args,['original']);
 const error=Error('native failure');w.terminateError=error;assert.throws(()=>w.terminate(),actual=>actual===error);assert(f.rows.find(r=>r.kind==='terminate-called').callerStack.value.includes('observedTerminate'));
});
test('native error is observed before application cancellation and never suppressed',()=>{
 const f=fixture(),w=new f.scope.Worker('rules-worker.js'),event={message:'bootstrap failed',filename:'rules-worker.js',lineno:1,colno:2,error:Error('worker stack'),defaultPrevented:false};
 w.onerror=received=>{assert.equal(received,event);assert(f.rows.some(r=>r.kind==='native-error'));w.terminate();};w.dispatch('error',event);
 assert.equal(event.defaultPrevented,false);assert(f.rows.findIndex(r=>r.kind==='native-error')<f.rows.findIndex(r=>r.kind==='terminate-called'));
});
test('messages and onmessage handler receive the exact original event/data',()=>{
 const f=fixture(),w=new f.scope.Worker('rules-worker.js'),data={id:1,type:'project',scope:'admit:private',result:{large:'not logged'}},event={data};let actual;
 const handler=received=>actual=received;w.onmessage=handler;w.dispatch('message',event);
 assert.equal(actual,event);assert.equal(actual.data,data);assert.equal(w.onmessage,handler);assert(!JSON.stringify(f.rows).includes('not logged'));
});
test('messageerror retains its own event without becoming native error or terminate',()=>{
 const f=fixture(),w=new f.scope.Worker('rules-worker.js');let calls=0;w.onmessageerror=()=>calls++;w.dispatch('messageerror',{data:null});
 assert.equal(calls,1);assert(f.rows.some(r=>r.kind==='messageerror'));assert(!f.rows.some(r=>r.kind==='native-error'||r.kind==='terminate-called'));
});
test('payload accessors and non-string URL coercion are not invoked by the observer',()=>{
 const f=fixture();let reads=0;const url={toString(){reads++;return 'rules-worker.js';}},data={get type(){reads++;return 'project';}};
 const w=new f.scope.Worker(url);w.postMessage(data);assert.equal(reads,0);assert.equal(f.calls[0].args[0],url);assert.equal(f.calls.at(-1).args[0],data);
});
test('observer console failure cannot change native operations',()=>{
 const f=fixture({throwConsole:true}),w=new f.scope.Worker('blob:a'),result={native:true};w.postResult=result;assert.equal(w.postMessage({id:1}),result);assert.equal(w.terminate(),undefined);
});
test('equal job IDs and static URLs remain separate Worker object ordinals',()=>{
 const f=fixture(),a=new f.scope.Worker('rules-worker.js'),b=new f.scope.Worker('rules-worker.js');a.postMessage({id:1,scope:'admit:x',type:'project'});b.postMessage({id:1,scope:'admit:x',type:'project'});
 const posted=f.rows.filter(r=>r.kind==='post-called');assert.equal(posted.length,2);assert.notEqual(posted[0].workerOrdinal,posted[1].workerOrdinal);assert.equal(posted[0].data.id,posted[1].data.id);
});
test('cap loss is explicit once and never stops the native operation',()=>{
 const f=fixture({maxRows:3}),w=new f.scope.Worker('blob:a');for(let i=0;i<10;i++)w.postMessage({id:i});
 assert.equal(f.rows.filter(r=>r.kind==='cap-loss').length,1);assert.equal(f.calls.filter(r=>r.kind==='post').length,10);
});
test('aboutblank is skipped and separate HTTP documents have distinct nonces',()=>{
 const blank=fixture({protocol:'about:'});assert.equal(blank.scope.Worker,blank.NativeWorker);assert.equal(blank.rows.length,0);
 assert.notEqual(fixture({nonce:'first'}).rows[0].documentNonce,fixture({nonce:'second'}).rows[0].documentNonce);
});
test('borrowed native operations retain native invalid-receiver behavior',()=>{
 const f=fixture(),w=new f.scope.Worker('blob:a');assert.throws(()=>w.postMessage.call({},{}),assert.AssertionError);
});
test('public Node resolve hook redirects only exact test import under candidate e2e',async()=>{
 initialize({candidateRoot:'file:///candidate/e2e/',fixtureURL:'file:///diagnostic/test-fixture.mjs'});let delegated=0;const next=async(specifier,context)=>{delegated++;return{specifier,context};};
 assert.deepEqual(await resolve('@playwright/test',{parentURL:'file:///candidate/e2e/workflows/original.spec.mjs'},next),{url:'file:///diagnostic/test-fixture.mjs',shortCircuit:true});
 for(const [specifier,parentURL]of[['@playwright/test','file:///candidate/playwright.config.mjs'],['@playwright/test','file:///candidate/apps/web/module.js'],['./original.mjs','file:///candidate/e2e/workflows/original.spec.mjs']])await resolve(specifier,{parentURL},next);
 assert.equal(delegated,3);
});
