// Authored only. No execution or acceptance is recorded by this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {transformResultReviewFocusSource,resultReviewFocusInit,installResultReviewFocusObservation} from '../../../e2e/support/result-review-focus-observation.mjs';
const recipe=JSON.parse(readFileSync(new URL('../../../e2e/support/result-review-focus-observation-recipe.json',import.meta.url),'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
// Normal catalog/CI discovery reads the actual repository source without any
// environment setup. A private frozen override must be explicitly hash-bound
// to the CURRENT reviewed recipe, never implicitly to an old branch name.
const canonicalSourceURL=new URL('../../../apps/web/shell/app.js',import.meta.url);
function sourceSelection(env={}){
 const file=env.RIGHELT_RESULT_REVIEW_SOURCE_PATH,expected=env.RIGHELT_RESULT_REVIEW_SOURCE_SHA256;
 if(!file){if(expected)throw Error('frozen source hash requires an explicit path');return {file:canonicalSourceURL,expected:null,kind:'canonical-default'};}
 if(!path.isAbsolute(file)||!/^([a-f0-9]{64})$/.test(expected??''))throw Error('frozen source requires an absolute path and driver-qualified hash');
 return {file,expected,kind:'explicit-frozen'};
}
function loadSource(env={},reader=readFileSync){
 const choice=sourceSelection(env),value=reader(choice.file,'utf8'),actual=hash(value);
 if(choice.expected&&actual!==choice.expected)throw Error('frozen source hash mismatch');
 if(actual!==recipe.sourceSha256)throw Error('source differs from current reviewed recipe');
 return value;
}
const source=loadSource(process.env);
test('normal catalog discovery reads actual source without any environment variable',()=>{
 let selected;
 const value=loadSource({},file=>{selected=file;return source;});
 assert(selected instanceof URL);assert.equal(selected.href,canonicalSourceURL.href);
 assert.equal(sourceSelection({}).kind,'canonical-default');assert.equal(value,source);
});
test('an optional frozen source requires an explicit current-recipe hash before qualification',()=>{
 assert.throws(()=>sourceSelection({RIGHELT_RESULT_REVIEW_SOURCE_PATH:'/private/frozen-app.js'}),/driver-qualified hash/);
 assert.throws(()=>sourceSelection({RIGHELT_RESULT_REVIEW_SOURCE_SHA256:recipe.sourceSha256}),/requires an explicit path/);
 assert.throws(()=>sourceSelection({RIGHELT_RESULT_REVIEW_SOURCE_PATH:'relative.js',RIGHELT_RESULT_REVIEW_SOURCE_SHA256:recipe.sourceSha256}),/absolute path/);
 const env={RIGHELT_RESULT_REVIEW_SOURCE_PATH:'/private/frozen-app.js',RIGHELT_RESULT_REVIEW_SOURCE_SHA256:recipe.sourceSha256};
 assert.equal(loadSource(env,()=>source),source);
 assert.throws(()=>loadSource({...env,RIGHELT_RESULT_REVIEW_SOURCE_SHA256:'0'.repeat(64)},()=>source),/hash mismatch/);
});
test('all six operations reconstruct the exact reviewed complete application output',()=>{
 const result=transformResultReviewFocusSource(source,recipe);
 assert.equal(hash(result),recipe.outputSha256);assert.equal(recipe.operations.length,6);
});
test('changed source, range and output identities fail closed',()=>{
 assert.throws(()=>transformResultReviewFocusSource(source+' ',recipe),/source binding/);
 const changed=structuredClone(recipe);changed.operations[0].start++;
 assert.throws(()=>transformResultReviewFocusSource(source,changed),/range binding/);
 assert.throws(()=>transformResultReviewFocusSource(source,{...recipe,outputSha256:'0'.repeat(64)}),/output binding/);
});
function focusRun(code,{throwSink=false,throwFocus=false}={}){
 const error=new Error('original native focus failure'),calls=[];let reads=0;
 const heading={set tabIndex(value){calls.push(['tabIndex',value]);},get focus(){reads++;return()=>{calls.push(['focus']);if(throwFocus)throw error;};}};
 const context={pendingResultReviewFocus:'g',currentRoute:{gameId:'g'},getGamePanel:()=> 'history',
  appEl:{querySelector(){calls.push(['query']);return heading;}},
  __RIGHELT_RESULT_REVIEW_FOCUS_PROBE__(kind){calls.push(['probe',kind]);if(throwSink)throw Error('observer sink');}};
 let caught;
 try{vm.runInNewContext(recipe.prefix+code,context);}catch(e){caught=e;}
 return {calls,reads,pending:context.pendingResultReviewFocus,caught,error};
}
const originalFocus=()=>{
 const a=source.indexOf('  if (pendingResultReviewFocus === currentRoute.gameId'),b=source.indexOf('  joinFeedback.restoreFocus',a);
 assert(a>=0&&b>a);return source.slice(a,b);
};
const observedFocus=()=>{
 const result=transformResultReviewFocusSource(source,recipe),a=result.indexOf('  if (pendingResultReviewFocus === currentRoute.gameId'),b=result.indexOf('  __righeltResultReviewFocusProbe("render-before-join")',a);
 assert(a>=0&&b>a);return result.slice(a,b);
};
test('actual focus getter, call, query and pending assignment retain their original count under a throwing sink',()=>{
 const baseline=focusRun(originalFocus());
 for(const throwSink of [false,true]){
  const candidate=focusRun(observedFocus(),{throwSink});
  assert.equal(candidate.reads,baseline.reads);assert.equal(candidate.pending,baseline.pending);
  assert.deepEqual(candidate.calls.filter(x=>x[0]!=='probe'),baseline.calls);
  assert.equal(candidate.caught,undefined);
 }
});
test('an original focus exception keeps its identity and skips the original pending clear',()=>{
 for(const code of [originalFocus(),observedFocus()]){
  const result=focusRun(code,{throwSink:true,throwFocus:true});
  assert.equal(result.caught,result.error);assert.equal(result.pending,'g');assert.equal(result.reads,1);
 }
});
function collectorFixture(){
 const handlers=new Map(),body={matches:()=>false,closest:()=>null};
 const doc={body,activeElement:body,visibilityState:'visible',hasFocus:()=>true,
  addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:(name,fn)=>{if(handlers.get(name)===fn)handlers.delete(name);}};
 const context={document:doc,WeakRef};vm.runInNewContext('('+resultReviewFocusInit.toString()+')()',context);
 return {doc,handlers,context,probe:context.__RIGHELT_RESULT_REVIEW_FOCUS_PROBE__,snapshot:context.__RIGHELT_RESULT_REVIEW_FOCUS_SNAPSHOT__};
}
test('first64 and tail64 retain bounded categorical records and explicit eviction without private values',()=>{
 const f=collectorFixture();f.probe('analysis-entry');
 for(let i=0;i<160;i++)f.probe('render-after-resume');
 const result=f.snapshot();assert.equal(result.first.length,64);assert.equal(result.tail.length,64);
 assert.equal(result.sequence,161);assert.equal(result.dropped,33);assert.equal(result.scopedIncomplete,true);
 const text=JSON.stringify(result);assert(!/identityId|accountId|gameId|password|request\.url|geometry/.test(text));
 assert.equal(result.generationUnverified,true);assert.equal(result.incomplete,true);
});
test('throwing DOM projection is categorical incomplete and never serializes the error',()=>{
 const f=collectorFixture();Object.defineProperty(f.doc,'activeElement',{get(){throw Error('SECRET-IDENTIFIER');}});
 assert.doesNotThrow(()=>f.probe('analysis-entry'));
 const result=f.snapshot();assert.equal(result.projectionFailures,1);assert.equal(result.scopedIncomplete,true);
 assert(!JSON.stringify(result).includes('SECRET-IDENTIFIER'));
});
test('snapshot occurs once, removes only owned native listeners and freezes later records',()=>{
 const f=collectorFixture();f.probe('analysis-entry');const result=f.snapshot();
 assert.equal(f.handlers.size,0);f.probe('focus-after');assert.equal(result.sequence,1);assert.equal(f.snapshot(),null);
});
test('pre-arm events never fill the latest-analysis first window',()=>{
 const f=collectorFixture();
 for(let i=0;i<200;i++)f.probe('render-committed-entry');
 f.probe('analysis-entry');f.probe('focus-before');
 const result=f.snapshot();assert.equal(result.preArmEvents,200);assert.equal(result.sequence,202);
 assert.equal(result.first.length,2);assert.equal(result.first[0].sequence,201);
 assert.equal(result.first[0].kind,'analysis-entry');assert.equal(result.dropped,0);
 assert.equal(result.sequence,result.preArmEvents+result.supersededEvents+result.windowEvents);
 assert.equal(result.scopedIncomplete,false);assert.equal(result.incomplete,true);
});
test('latest analysis replaces the prior window while preserving global weak identities',()=>{
 const f=collectorFixture();
 const a={isConnected:true,closest:()=>null},b={isConnected:true,closest:()=>null};
 f.probe('analysis-entry'); // body token 1
 f.probe('focus-before',{node:a}); // heading token 2
 f.probe('mousedown',{node:{}}); // old foreign token 3
 f.probe('focus-after',{node:a});
 f.probe('analysis-entry');f.probe('focus-before',{node:b}); // new heading token 4
 const result=f.snapshot();assert.equal(result.analysisCount,2);
 assert.equal(result.supersededWindows,1);assert.equal(result.supersededEvents,4);
 assert.equal(result.priorIncomplete,0);assert.equal(result.first.length,2);
 assert.equal(result.sequence,result.preArmEvents+result.supersededEvents+result.windowEvents);
 assert.equal(result.first[0].sequence,5);assert.equal(result.first[1].nodeToken,4);
 assert.equal(result.first[0].activeToken,1);assert.equal(result.weakNodeCount,4);
 assert.equal(result.focusBeforeCount,1);assert.equal(result.focusAfterCount,0);
 assert.equal(result.incomplete,true);assert.equal(result.generationUnverified,true);
});
test('superseding a dropped and projection-failed window resets scoped counters and retains prior incompleteness',()=>{
 const f=collectorFixture();f.probe('analysis-entry');
 for(let i=0;i<160;i++)f.probe('render-after-resume');
 Object.defineProperty(f.doc,'activeElement',{configurable:true,get(){throw Error('private projection failure');}});
 f.probe('focus-before');
 Object.defineProperty(f.doc,'activeElement',{configurable:true,writable:true,value:f.doc.body});
 f.probe('analysis-entry');
 const result=f.snapshot();assert.equal(result.supersededWindows,1);
 assert.equal(result.supersededEvents,162);assert.equal(result.priorIncomplete,1);
 assert.equal(result.dropped,0);assert.equal(result.projectionFailures,0);
 assert.equal(result.focusBeforeCount,0);assert.equal(result.focusAfterCount,0);
 assert.equal(result.first.length,1);assert.equal(result.first[0].sequence,163);
 assert.equal(result.sequence,result.preArmEvents+result.supersededEvents+result.windowEvents);
 assert.equal(result.scopedIncomplete,false);assert.equal(result.incomplete,true);
 assert(!JSON.stringify(result).includes('private projection failure'));
});
test('an unarmed final document stays explicitly incomplete despite many observed pre-arm events',()=>{
 const f=collectorFixture();for(let i=0;i<100;i++)f.probe('click',{node:{}});
 const result=f.snapshot();assert.equal(result.armed,false);assert.equal(result.preArmEvents,100);
 assert.equal(result.first.length,0);assert.equal(result.tail.length,0);
 assert.equal(result.analysisCount,0);assert.equal(result.windowEvents,0);
 assert.equal(result.sequence,result.preArmEvents+result.supersededEvents+result.windowEvents);
 assert.equal(result.scopedIncomplete,true);assert.equal(result.incomplete,true);
 for(const key of ['sequence','preArmEvents','supersededWindows','supersededEvents','priorIncomplete'])assert(Number.isSafeInteger(result[key]));
});
test('disabled observation performs no context access or source transformation',async()=>{
 const context=new Proxy({}, {get(){throw Error('disabled access');}});
 const observer=await installResultReviewFocusObservation({context,enabled:false});
 await observer.finish(undefined,undefined);
});
async function routeFixture({sourceText=source,unrouteError=null,pendingFailure=null,ioError=false}={}){
 const directory=await mkdtemp(path.join(tmpdir(),'result-focus-contract-'));
 const calls={init:0,eval:0,attach:0,fulfill:[],unroute:0};let match,handler,rejectFetch;
 const held=pendingFailure?new Promise((_resolve,reject)=>{rejectFetch=reject;}):null;
 const context={async addInitScript(){calls.init++;},async route(m,h){match=m;handler=h;},
  async unroute(m,h){calls.unroute++;assert.equal(m,match);assert.equal(h,handler);if(rejectFetch)rejectFetch(pendingFailure);if(unrouteError)throw unrouteError;}};
 const observer=await installResultReviewFocusObservation({context,baseURL:'https://127.0.0.1:9988',enabled:true});
 const route={request:()=>({method:()=> 'GET'}),fetch:()=>held??Promise.resolve({status:()=>200,text:async()=>sourceText}),
  async fulfill(value){calls.fulfill.push(value);}};
 const page={async evaluate(){calls.eval++;return {schema:1,first:[],tail:[],incomplete:true,generationUnverified:true};}};
 const info={title:'the same completed game persists through review and swapped rematch',
  outputPath:name=>{if(ioError)throw Error('artifact unavailable');return path.join(directory,name);},async attach(){calls.attach++;}};
 return {observer,route,page,info,calls,match,handler,directory,
  receipt:async()=>JSON.parse(await readFile(path.join(directory,'result-review-focus-observation.json'),'utf8')),
  close:()=>rm(directory,{recursive:true,force:true})};
}
test('same-origin exact module routes transform once and teardown snapshots only once',async()=>{
 const f=await routeFixture();try{
  assert(f.match(new URL('https://127.0.0.1:9988/shell/app.js')));
  assert(!f.match(new URL('https://example.invalid/shell/app.js')));
  assert(!f.match(new URL('https://127.0.0.1:9988/not-shell/app.js')));
  await f.handler(f.route);assert.equal(hash(f.calls.fulfill[0].body),recipe.outputSha256);
  await f.observer.finish(f.page,f.info);await f.observer.finish(f.page,f.info);
  assert.equal(f.calls.eval,1);assert.equal(f.calls.unroute,1);assert.equal(f.calls.attach,1);
  assert.equal((await f.receipt()).modules[0].status,'transformed');
 }finally{await f.close();}
});
test('a changed module passes original bytes through but cannot acquire diagnostic validity',async()=>{
 const f=await routeFixture({sourceText:source+'\n'});try{
  await f.handler(f.route);assert.equal(f.calls.fulfill[0].body,source+'\n');
  await f.observer.finish(f.page,f.info);const r=await f.receipt();
  assert(r.issues.includes('module-binding'));assert.equal(r.incomplete,true);
 }finally{await f.close();}
});
test('pending fetch and unroute rejection stay incomplete without replacing the primary error',async()=>{
 const fetchError=new Error('original module fetch failure'),primary=new Error('original workflow assertion');
 const f=await routeFixture({pendingFailure:fetchError,unrouteError:new Error('unroute rejected')});try{
  const pending=assert.rejects(f.handler(f.route),error=>error===fetchError);
  let caught;try{throw primary;}catch(error){caught=error;await f.observer.finish(f.page,f.info);}
  await pending;assert.equal(caught,primary);const r=await f.receipt();
  assert(r.issues.includes('unroute-failed'));assert(r.issues.includes('route-request-failed'));assert.equal(r.incomplete,true);
 }finally{await f.close();}
});
test('artifact I/O rejection cannot replace a completed workflow primary',async()=>{
 const f=await routeFixture({ioError:true}),primary=new Error('original assertion');try{
  let caught;try{throw primary;}catch(error){caught=error;await f.observer.finish(f.page,f.info);}
  assert.equal(caught,primary);assert.equal(f.calls.eval,1);assert.equal(f.calls.unroute,1);
 }finally{await f.close();}
});
