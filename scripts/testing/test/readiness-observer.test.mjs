import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createReadinessRecorder,installReadinessObserver,installCaseReadiness,stopCaseReadiness,observeReadinessEvaluation,attachNodeReadiness,transformReadinessModule,finishCaseReadiness} from '../../../e2e/support/readiness-diagnostics.mjs';

const recipes=JSON.parse(readFileSync(new URL('../../../e2e/support/readiness-transformations.json',import.meta.url),'utf8'));
const rawSource=path=>readFileSync(new URL('../../../'+path,import.meta.url),'utf8');
const source=path=>{const raw=rawSource(path);const recipe=Object.values(recipes).find(recipe=>recipe.file===path);return recipe?transformReadinessModule(raw,recipe):raw;};
const mockContext=()=>({async addInitScript(){},async route(){},async unroute(){}});
const app=source('e2e/support/app.mjs');
const callbackText=app.slice(app.indexOf('to => {',app.indexOf('export const submitPlayableAction'))+7,app.indexOf('\n  },action.to))',app.indexOf('export const submitPlayableAction')));
const predicate=(document,hook)=>vm.runInNewContext(`(to=>{${callbackText}})`,{document,__righeltReadinessBegin:hook})({row:1,col:2});
const originalPredicate=document=>{
 const node=document.querySelector('[data-testid="game-board"] .cell[data-row="1"][data-col="2"]');
 const message=document.getElementById('shell-board-preview-label');
 return Boolean(node?.isConnected&&message?.isConnected&&message.getAttribute('aria-busy')!=='true'&&node.classList.contains('target')&&!node.classList.contains('unselectable'));
};
function dom({connected=true,busy=false,target=true,unselectable=false,error}={}){
 const reads=[];
 const node={get isConnected(){reads.push('node-connected');return connected;},classList:{contains(name){reads.push(name);if(error)throw error;return name==='target'?target:unselectable;}}};
 const message={get isConnected(){reads.push('message-connected');return true;},getAttribute(){reads.push('busy');return busy?'true':'false';}};
 return {reads,querySelector(){reads.push('query');return node;},getElementById(){reads.push('message');return message;}};
}
for(const values of [{},{connected:false},{busy:true},{target:false},{unselectable:true}])test('actual readiness predicate preserves ordered reads '+JSON.stringify(values),()=>{
 const a=dom(values),b=dom(values);assert.equal(predicate(a,()=>{throw Error('sink');}),originalPredicate(b));assert.deepEqual(a.reads,b.reads);
});
test('predicate rethrows original getter error when finish sink throws',()=>{
 const error=Error('getter'),a=dom({error}),b=dom({error});
 assert.throws(()=>predicate(a,()=>()=>{throw Error('sink');}),value=>value===error);
 assert.throws(()=>originalPredicate(b),value=>value===error);assert.deepEqual(a.reads,b.reads);
});
test('Node wrapper invokes operation once and preserves true, false and error identity',async()=>{
 await installCaseReadiness(mockContext(),'http://127.0.0.1:10193');
 try{for(const result of [true,false]){let calls=0;assert.equal(await observeReadinessEvaluation(()=>{calls++;return result;}),result);assert.equal(calls,1);}
 const error=Error('evaluate');let calls=0;await assert.rejects(observeReadinessEvaluation(()=>{calls++;throw error;}),value=>value===error);assert.equal(calls,1);
 }finally{stopCaseReadiness();}
});
test('Node freeze marks missing return incomplete and never backfills after completion',async()=>{
 await installCaseReadiness(mockContext(),'http://127.0.0.1:10193');let release;
 try{const operation=observeReadinessEvaluation(()=>new Promise(resolve=>{release=resolve;}));
 const first=attachNodeReadiness({}).readinessNode;assert.equal(first.pending,1);assert.equal(first.incomplete,true);
 release(true);await operation;assert.equal(attachNodeReadiness({}).readinessNode,first);assert.equal(first.pending,1);
 }finally{stopCaseReadiness();}
});
test('bounded general churn retains dedicated callback rows and marks overflow incomplete',()=>{
 let at=0;const recorder=createReadinessRecorder(()=>++at,1);const finish=recorder.begin('readiness-callback',true);finish(true,true);
 for(let i=0;i<1100;i++)recorder.record('render-board');const value=recorder.freezeOnce();
 assert.equal(value.records.length,1000);assert.equal(value.dropped,100);assert.equal(value.incomplete,true);assert.equal(value.critical.length,2);assert.equal(value.critical[1].result,true);
});
test('first snapshot is deeply immutable and survives later drain records',()=>{
 const recorder=createReadinessRecorder(()=>1,2);recorder.record('render-board');const first=recorder.freezeOnce();recorder.record('sequence-cache');
 assert.equal(recorder.freezeOnce(),first);assert.equal(first.records.length,1);assert.ok(Object.isFrozen(first));assert.ok(Object.isFrozen(first.records));assert.ok(Object.isFrozen(first.records[0]));assert.throws(()=>first.records.push({}));
});
test('throwing clocks and fields cannot escape recorder or mask original work',()=>{
 const recorder=createReadinessRecorder(()=>{throw Error('clock');},1);const fields={get start(){throw Error('field');}};
 assert.doesNotThrow(()=>recorder.record('render-board',fields));assert.doesNotThrow(()=>recorder.begin('render-board')(false));assert.equal(recorder.freezeOnce().incomplete,true);
});
test('Page installer freezes once before simulated asynchronous continuation',async()=>{
 const context={performance:{now:()=>10,timeOrigin:20}};vm.createContext(context);
 vm.runInContext(`(${installReadinessObserver.toString()})(${createReadinessRecorder.toString()})`,context);
 const before=context.__righeltReadinessFreeze();await Promise.resolve();context.__righeltReadinessBegin('render-board')(true);
 assert.equal(context.__righeltReadinessFreeze(),before);assert.equal(before.records.length,0);assert.equal(before.generationUnverified,true);assert.equal(before.incomplete,true);
});
const projectorSource=source('apps/web/board/sequence-status-preview.js');
function projector(finalize,hook){return vm.runInNewContext(projectorSource.replace(/^import .*;$/gm,'').replace('export function','function')+';createSequenceStatusProjector();',{
 finalizeResolvedTurn:finalize,resolveToStability:()=>{},getTurnOwnerSideForState:()=> 'P1',structuredClone:value=>value,__righeltReadinessBegin:hook});}
function snapshot(){let count=0;return {get count(){return count;},value:{continuation:{type:'rush'},outcome:{status:'ongoing'},pieces:[],get marker(){count++;return 1;}}};}
test('actual projector cache hit preserves reference, JSON getter counts and one resolver miss',()=>{
 let calls=0;const project=projector(({state})=>{calls++;return {nextState:state};},()=>()=>{throw Error('sink');});const input=snapshot();
 const first=project(input.value);assert.equal(input.count,1);assert.equal(project(input.value),first);assert.equal(input.count,2);assert.equal(calls,1);
});
test('actual projector rethrows identical resolver and JSON getter errors through failing hooks',()=>{
 const error=Error('resolver');const project=projector(()=>{throw error;},()=>()=>{throw Error('sink');});assert.throws(()=>project(snapshot().value),value=>value===error);
 const input=snapshot().value;Object.defineProperty(input,'marker',{enumerable:true,get(){throw error;}});assert.throws(()=>project(input),value=>value===error);
});
test('first diagnostic freeze precedes original route guard and asynchronous import in actual source',()=>{
 const spec=source('e2e/workflows/completion-preserving-retreat.spec.mjs');const start=spec.indexOf('async function readRetreatDiagnostics');const end=spec.indexOf('\n}',start);const body=spec.slice(start,end);
 assert.ok(body.indexOf('__righeltReadinessFreeze')<body.indexOf('location.hash.match'));assert.ok(body.indexOf('__righeltReadinessFreeze')<body.indexOf("await import('/shell/issue-diagnostics.js')"));
 assert.equal((body.match(/__righeltReadinessFreeze/g)||[]).length,1);
});

test('actual render wrapper preserves early guard, host getter counts and thrown identity',()=>{
 const text=source('apps/web/board/runtime/board-runtime.js');const start=text.indexOf('  const renderBoard = () => {');const end=text.indexOf('\n  };',start)+5;
 const instrumented=text.slice(start,end)+';renderBoard;';
 const original=instrumented.replace(/    let readinessFinish,readinessCompleted=false;[\s\S]*?    try\{\n/,'').replace(/\n    readinessCompleted=true;[\s\S]*?\}catch\{\}\}/,'');
 const run=(body,active,error)=>{
  const calls=[];const state=active?{}:null;const host={get canInteract(){calls.push('permission-get');return ()=>{calls.push('permission-call');return true;};},get canPresentActions(){calls.push('presentation-get');return ()=>{calls.push('presentation-call');return true;};}};
  const noop=name=>(()=>{calls.push(name);return {};});
  const context={state,mounted:true,host,syncRushGuidance:noop('rush'),getEffectiveSelectedPieceMovesForBoard:()=>({selectedPieceMoves:[],selectedPieceMovePreviews:[]}),boardAdapter:{render(){calls.push('render');if(error)throw error;}},rushGuidance:null,getCurrentSelection:noop('selection'),getOverlay:noop('overlay'),legalActions:[],removalEffects:[],getAllowFreeSelection:noop('free'),getActionType:noop('action'),selectedPieceOverlayPhase:null,controls:{onVisualsUpdated:noop('updated')},elements:{},getInspectionView:()=>null,networkInspections:{},networkOwners:{},structuredClone:value=>value,__righeltReadinessBegin:()=>()=>{throw Error('sink');}};
  const render=vm.runInNewContext(body,context);let caught;try{render();}catch(value){caught=value;}return {calls,caught};
 };
 for(const active of [false,true]){const a=run(original,active),b=run(instrumented,active);assert.deepEqual(b.calls,a.calls);assert.equal(b.caught,a.caught);if(active){assert.equal(b.calls.filter(value=>value==='permission-get').length,1);}else assert.deepEqual(b.calls,[]);}
 const error=Error('render');assert.equal(run(instrumented,true,error).caught,error);assert.equal(run(original,true,error).caught,error);
});

for(const [pathname,recipe] of Object.entries(recipes))test('served transformation is exact and fails closed '+pathname,()=>{
 const raw=rawSource(recipe.file);assert.equal(typeof transformReadinessModule(raw,recipe),'string');
 assert.throws(()=>transformReadinessModule(raw+' ',recipe),/source hash/);
 const badRange=structuredClone(recipe);badRange.operations[0].before+='x';assert.throws(()=>transformReadinessModule(raw,badRange),/range/);
 const badAnchor=structuredClone(recipe);badAnchor.operations[0].anchorCount++;assert.throws(()=>transformReadinessModule(raw,badAnchor),/anchor/);
 assert.throws(()=>transformReadinessModule(raw,{...recipe,outputSha256:'0'.repeat(64)}),/output hash/);
});
test('only exact same-origin module routes are transformed and original response is retained',async()=>{
 let pattern,handler,disposed=false,init=0;const context={async route(p,h){pattern=p;handler=h;},async addInitScript(){init++;},async unroute(p,h){assert.equal(p,pattern);assert.equal(h,handler);disposed=true;}};
 const dispose=await installCaseReadiness(context,'http://127.0.0.1:10193');try{
  const [pathname,recipe]=Object.entries(recipes)[0];assert.equal(pattern(new URL('http://127.0.0.1:10193'+pathname)),true);assert.equal(pattern(new URL('http://elsewhere.test'+pathname)),false);assert.equal(pattern(new URL('http://127.0.0.1:10193/not-observed.js')),false);
  const response={async text(){return rawSource(recipe.file);}};let fulfilled,fetches=0;
  await handler({request:()=>({url:()=> 'http://127.0.0.1:10193'+pathname}),async fetch(){fetches++;return response;},async fulfill(value){fulfilled=value;},async abort(){assert.fail('unexpected abort');}});
  assert.equal(fetches,1);assert.equal(fulfilled.response,response);assert.equal(fulfilled.body,transformReadinessModule(rawSource(recipe.file),recipe));assert.equal(init,1);
 }finally{await dispose();stopCaseReadiness();}assert.equal(disposed,true);
});

test('module source mismatch aborts the real route and marks frozen evidence incomplete',async()=>{
 let handler;const context={async route(p,h){handler=h;},async addInitScript(){},async unroute(){}};const dispose=await installCaseReadiness(context,'http://127.0.0.1:10193');
 try{let aborts=0;await handler({request:()=>({url:()=> 'http://127.0.0.1:10193'+Object.keys(recipes)[0]}),async fetch(){return {async text(){return 'wrong source';}};},async fulfill(){assert.fail('must not fulfill changed source');},async abort(reason){assert.equal(reason,'failed');aborts++;}});
  const first=attachNodeReadiness({}).readinessModules;assert.equal(aborts,1);assert.equal(first.errors.length,1);assert.equal(first.incomplete,true);assert.ok(Object.isFrozen(first));assert.equal(attachNodeReadiness({}).readinessModules,first);
 }finally{await dispose();stopCaseReadiness();}
});
test('module evidence remains bounded and overflow cannot report complete',async()=>{
 let handler;const context={async route(p,h){handler=h;},async addInitScript(){},async unroute(){}};const dispose=await installCaseReadiness(context,'http://127.0.0.1:10193');
 try{for(let i=0;i<130;i++)await handler({request:()=>({url:()=> 'http://127.0.0.1:10193'+Object.keys(recipes)[0]}),async fetch(){throw Error('transport');},async abort(){}});
  const value=attachNodeReadiness({}).readinessModules;assert.equal(value.errors.length,128);assert.equal(value.dropped,2);assert.equal(value.incomplete,true);
 }finally{await dispose();stopCaseReadiness();}
});

test('actual owned-route removal failure is categorical, drains pending rejection, and preserves primary error',async()=>{
 let handler,rejectFetch,cleanup,aborts=0;const primary=Error('original workflow failure');
 const context={async route(p,h){handler=h;},async addInitScript(){},async unroute(){rejectFetch(Error('pending fetch rejection'));throw Error('unroute rejected');}};
 const dispose=await installCaseReadiness(context,'http://127.0.0.1:10193');
 const task=handler({request:()=>({url:()=> 'http://127.0.0.1:10193'+Object.keys(recipes)[0]}),fetch:()=>new Promise((resolve,reject)=>{rejectFetch=reject;}),async abort(){aborts++;throw Error('abort rejected');}});
 const frozen=attachNodeReadiness({}).readinessModules;
 const info={async attach(name,value){assert.equal(name,'readiness-route-cleanup');cleanup=JSON.parse(value.body);}};
 await assert.rejects((async()=>{try{throw primary;}finally{await finishCaseReadiness(dispose,info);}})(),error=>error===primary);
 await task;assert.equal(aborts,1);assert.equal(cleanup.incomplete,true);assert.equal(cleanup.unrouteRemoved,false);assert.equal(cleanup.pendingAfterDrain,0);assert.equal(cleanup.moduleErrors,1);assert.ok(cleanup.categories.includes('owned-route-removal-failed'));
 assert.equal(frozen.errors.length,0);assert.equal(frozen.pending,1); // FIRST snapshot remains unchanged.
});
test('unexpected disposer and attachment rejection preserve primary error and emit categorical incomplete evidence',async()=>{
 const primary=Error('primary'),warnings=[],savedWarn=console.warn;console.warn=value=>warnings.push(value);
 try{await assert.rejects((async()=>{try{throw primary;}finally{await finishCaseReadiness(async()=>{throw Error('dispose');},{async attach(){throw Error('io');}});}})(),error=>error===primary);}
 finally{console.warn=savedWarn;stopCaseReadiness();}
 assert.ok(warnings.some(value=>value.includes('unexpected-dispose-failed')));assert.ok(warnings.some(value=>value.includes('cleanup-evidence-unavailable')));
});
test('successful owned-route cleanup has a truthful separate receipt and leaves first snapshots immutable',async()=>{
 const dispose=await installCaseReadiness(mockContext(),'http://127.0.0.1:10193');const first=attachNodeReadiness({});let receipt;
 await finishCaseReadiness(dispose,{async attach(name,value){receipt=JSON.parse(value.body);}});
 assert.equal(receipt.unrouteRemoved,true);assert.equal(receipt.pendingAfterDrain,0);assert.equal(receipt.incomplete,false);assert.deepEqual(receipt.categories,[]);assert.equal(first.readinessNode.pending,0);assert.equal(first.readinessModules.missingModules.length,2);
});
