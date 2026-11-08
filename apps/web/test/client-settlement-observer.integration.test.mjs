import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createLiveTransportStore} from '../shell/live-transport.js';
import {createSyncStore} from '../shell/sync-store.js';
import {readRetreatCapture} from '../../../e2e/support/retreat-completion-fixture.mjs';
import {installClientSettlementRecorder,settlementMatches,transformClientSettlement,installClientSettlementObserver} from '../../../e2e/support/client-settlement-observer.mjs';
import {transformBoardAdmissionModule,installBoardAdmissionDiagnostics} from '../../../e2e/support/board-admission-diagnostics.mjs';
const read=path=>readFileSync(new URL('../../../'+path,import.meta.url),'utf8');
const raw=read('apps/web/shell/app.js');
const oldRecipe=JSON.parse(read('e2e/support/board-admission-transformations.json'))['/shell/app.js'];
const recipe=JSON.parse(read('e2e/support/client-settlement-transformation.json'))['/shell/app.js'];
const old=transformBoardAdmissionModule(raw,oldRecipe),observed=transformClientSettlement(raw,old,recipe);
const callback=source=>{const start=source.indexOf('        canInteract: ');return source.slice(start+'        canInteract: '.length,source.indexOf('\n      }),',start)).trim().replace(/,$/,'');};
const guardSource=raw.match(/const canControlLiveBoard = ([^\n]+);/)[1];
function harness(store){
 const root={isConnected:true};let currentRoot=root,scopeGame='owned';
 const context={performance:{timeOrigin:1234},document:{getElementById:()=>currentRoot},transport:store,game:{id:'owned'},boardEl:root,getCurrentViewedGameId:()=>scopeGame,mountedBoardGameId:'owned',currentRoute:{},scenarioCapture:null,hostInvite:null,getBoardGame:value=>value,isOngoingGame:g=>g?.board?.state?.outcome?.status==='ongoing',account:{canPlay:()=>true},Object,WeakMap};
 vm.createContext(context);vm.runInContext(`(${installClientSettlementRecorder.toString()})({namespace:'fixture'});`,context);
 context.canControlLiveBoard=vm.runInContext(`(${guardSource})`,context);
 const run=vm.runInContext(`(${callback(observed)})`,context),original=vm.runInContext(`(${callback(old)})`,context);
 context.__retreatClientSettlement.bind(run,root);
 const snapshot=()=>context.__retreatClientSettlement.snapshot();
 const scope=()=>{const r=snapshot().latest;return{namespace:'fixture',timeOrigin:1234,transportEpoch:r.transportEpoch,rootEpoch:r.rootEpoch,gameId:'owned'};};
 return{run,original,snapshot,scope,context,root,setRoot(root){currentRoot=root;},replaceRoot(){currentRoot={isConnected:true};},changeGame(){scopeGame='other';}};
}
function game(){const state=readRetreatCapture().states.afterPush;return{id:'owned',createdAt:'2026-11-07T00:00:00.000Z',updatedAt:'2026-11-07T00:00:00.000Z',gameplayRevision:1,board:{state},currentSnapshot:state,moves:[],turns:[],player1:{identityId:'reader'},player2:{identityId:'other'},myRole:'Both players',selfPlayMode:true,control:'turn-owner',canRecordMove:true,canEndTurn:false,inHistoryMode:false};}
function storeFixture(t){let requests=0,release;const g=game(),storage={getItem:k=>k==='righelt.identity.id.v1'?'reader':null,setItem(){},removeItem(){}};
 const store=createLiveTransportStore({storage,commandJournal:{list:async()=>[]},fetcher:async()=>{requests++;await new Promise(resolve=>{release=resolve;});return Response.json({ok:true,protocolVersion:2,gameId:g.id,eventSeq:5,gameplayRevision:1,game:g,commandOutcomes:[]});}});t.after(()=>store.retire());store.applyLiveGameUpdate({game:g,eventSeq:4,baseline:true});return{store,g,requests:()=>requests,release:()=>release?.()};}
test('actual host + actual store: known receipt is not client consumption; ordinary state_sync settles without telemetry',t=>{
 const f=storeFixture(t),h=harness(f.store);assert.equal(h.run(),true);const scope=h.scope();
 assert.equal(settlementMatches(h.snapshot(),scope,5),false,'old immediate ready DOM/host at4 is not sufficient for known receipt5');
 const before=JSON.stringify(f.store.getAuthoritativeGame('owned'));f.store.applyLiveGameUpdate({game:f.g,eventSeq:5,baseline:true});assert.equal(h.run(),true);
 assert.equal(settlementMatches(h.snapshot(),scope,5),true);assert.equal(f.requests(),0);assert.equal(JSON.stringify(f.store.getAuthoritativeGame('owned')),before);
 assert.equal(h.snapshot().latest.positionOnly,false,'optional positionOnly absent on actual happy view explicitly means not position-only');
});
test('actual store HTTP recovery keeps barrier closed until applied authority and recovery ownership settle',async t=>{
 const f=storeFixture(t),h=harness(f.store);h.run();const scope=h.scope();f.store.setConnectionRecovering('owned',true,{reason:'behind_server'});assert.equal(h.run(),false);assert.equal(settlementMatches(h.snapshot(),scope,5),false);
 const pending=f.store.reconcileGame('owned');for(let i=0;i<20&&!f.requests();i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(f.requests(),1);assert.equal(settlementMatches(h.snapshot(),scope,5),false);f.release();await pending;h.run();assert.equal(f.store.getLastEventSeq('owned'),5);assert.equal(settlementMatches(h.snapshot(),scope,5),true);assert.equal(f.requests(),1);
});
test('observer preserves original single view read, host result/throw and never acquires work; frozen snapshots cannot mutate store',t=>{
 const f=storeFixture(t);let reads=0;const getter=f.store.getGameViewModel;f.store.getGameViewModel=(...args)=>{reads++;return getter(...args);};const h=harness(f.store);
 const expected=h.original();assert.equal(reads,1);assert.equal(h.run(),expected);assert.equal(reads,2);
 const packet=h.snapshot(),before=JSON.stringify(f.store.getAuthoritativeGame('owned'));for(let i=0;i<50;i++)h.snapshot();assert.equal(reads,2);assert.throws(()=>{packet.latest.appliedEventSeq=999;},TypeError);assert.equal(JSON.stringify(f.store.getAuthoritativeGame('owned')),before);assert.equal(f.requests(),0);
 const error=Error('original getter');f.store.getGameViewModel=()=>{throw error;};assert.throws(h.run,e=>e===error);assert.throws(h.original,e=>e===error);
});
test('every required blocker and missing scalar fails closed; namespace/document/store/root/game cannot transfer readiness',t=>{
 const f=storeFixture(t),h=harness(f.store);f.store.applyLiveGameUpdate({game:f.g,eventSeq:5,baseline:true});h.run();const scope=h.scope(),p=h.snapshot();assert(settlementMatches(p,scope,5));
 for(const key of ['rulesChecking','storageBlocked','unsavedCommand','confirmationOverdue','recovering','upgradeRequired','sharedMutationsBlocked','gameplayMutationsBlocked','inHistoryMode','positionOnly']){assert.equal(settlementMatches({...p,latest:{...p.latest,[key]:true}},scope,5),false,key);const r={...p.latest};delete r[key];assert.equal(settlementMatches({...p,latest:r},scope,5),false,key+' missing');}
 for(const key of ['namespace','timeOrigin','transportEpoch','rootEpoch'])assert.equal(settlementMatches(p,{...scope,[key]:'other'},5),false);
 h.changeGame();h.run();assert.equal(settlementMatches(h.snapshot(),scope,5),false);h.replaceRoot();assert.equal(settlementMatches(h.snapshot(),scope,5),false,'removed/replaced root is rejected even before next host callback');h.run();assert.equal(h.snapshot().failures,1);assert.equal(settlementMatches(h.snapshot(),scope,5),false);
});
test('source binding preserves existing board golden and exact inverse; raw/input/anchor/count/output/prefix mismatches reject',()=>{
 let inverse=observed;for(const op of [...recipe.operations].reverse())inverse=inverse.slice(0,op.start)+op.before+inverse.slice(op.start+op.after.length);assert.equal(inverse,old);
 assert.throws(()=>transformClientSettlement(raw+' ',old,recipe),/raw source/);assert.throws(()=>transformClientSettlement(raw,old+' ',recipe),/source hash/);
 for(const mutated of [{...recipe,outputSha256:'0'.repeat(64)},{...recipe,prefix:'wrong'},{...recipe,operations:[{...recipe.operations[0],anchorCount:2}]},{...recipe,operations:[{...recipe.operations[0],before:'wrong'}]}])assert.throws(()=>transformClientSettlement(raw,old,mutated));
 assert.equal((callback(observed).match(/getGameViewModel\(/g)||[]).length,1);assert.equal((callback(observed).match(/getLastEventSeq\(/g)||[]).length,1);
});
test('scalar privacy: no whole model, identity, journal, function or accessor is accepted',t=>{
 const f=storeFixture(t),h=harness(f.store);h.run();const p=h.snapshot();assert(!JSON.stringify(p).includes('pieces'));assert(!JSON.stringify(p).includes('reader'));assert(!Object.hasOwn(p.latest,'identityId'));assert(!Object.hasOwn(p.latest,'state'));
 const values={...p.latest};for(const k of ['namespace','timeOrigin','sequence','transportEpoch','rootEpoch'])delete values[k];Object.defineProperty(values,'state',{get(){throw Error('must not read');},enumerable:true});h.context.__retreatClientSettlement.capture(f.store,h.run,values);assert.equal(h.snapshot().latest,null);assert.equal(h.snapshot().failures,1);
});
test('existing board route default remains byte-exact; optional fixture seam composes and rejects unknown source',async()=>{
 async function invoke(moduleTransform){let handler,body,aborted=false;const page={addInitScript:async()=>{},route:async(pattern,value)=>{handler=value;}};
  await installBoardAdmissionDiagnostics(page,{}, {baseURL:'http://owned.local',moduleTransform});
  await handler({request:()=>({url:()=> 'http://owned.local/shell/app.js'}),fetch:async()=>({text:async()=>raw}),fulfill:async value=>{body=value.body;},abort:async()=>{aborted=true;}});return{body,aborted};}
 const original=await invoke();assert.equal(original.body,old);assert.equal(original.aborted,false);
 const composed=await invoke((path,source,body)=>transformClientSettlement(source,body,recipe));assert.equal(composed.body,observed);assert.equal(composed.aborted,false);
 const broken=await invoke(()=>{throw Error('unknown source');});assert.equal(broken.body,undefined);assert.equal(broken.aborted,true);
});
test('missing read-only sequence getter fails fixture closed while preserving actual host return',t=>{
 const f=storeFixture(t),h=harness(f.store);f.store.applyLiveGameUpdate({game:f.g,eventSeq:5,baseline:true});h.run();const scope=h.scope();assert(settlementMatches(h.snapshot(),scope,5));
 f.store.getLastEventSeq=undefined;assert.equal(h.run(),true);assert.equal(h.snapshot().latest,null);assert.equal(settlementMatches(h.snapshot(),scope,5),false);
});
test('controlled original-guard counterexample: stale prepared destination refuses one click until current client receipt consumption',t=>{
 const f=storeFixture(t),h=harness(f.store);h.run();const scope=h.scope();
 const runtime=read('apps/web/board/runtime/board-runtime.js');const guard='if (selectedSource && !hasInspection() && selectedPieceOverlayPhase === "actionPreviews" && legalTarget && host.canInteract?.(state) === false) return;';assert.equal(runtime.split(guard).length-1,1);
 let submits=0;const click=vm.runInNewContext(`() => { ${guard} submit(); }`,{selectedSource:{row:4,col:0},hasInspection:()=>false,selectedPieceOverlayPhase:'actionPreviews',legalTarget:true,host:{canInteract:h.run},state:f.g.board.state,submit(){submits++;}});
 f.store.setConnectionRecovering('owned',true,{reason:'behind_server'});click();assert.equal(submits,0,'actual original guard rejects prepared but recovering native path');assert.equal(settlementMatches(h.snapshot(),scope,5),false);
 assert.throws(()=>assert.equal(submits,1),assert.AssertionError,'old immediate one-click premise fails before client settlement');
 f.store.applyLiveGameUpdate({game:f.g,eventSeq:5,baseline:true});h.run();assert.equal(settlementMatches(h.snapshot(),scope,5),false,'applied sequence alone cannot clear recovery');
 f.store.setConnectionRecovering('owned',false);h.run();assert.equal(settlementMatches(h.snapshot(),scope,5),true);click();assert.equal(submits,1,'only later deliberate activation submits; rejected activation was never queued');
});
test('source-proof read-only sequence lookup and optional flags are explicit; capture failure cannot change guard behavior',t=>{
 const source=read('apps/web/shell/live-transport.js');assert(source.includes('const getLastEventSeq = (gameId) => lastEventSeqByGameId.get(gameId) ?? 0;'));
 assert(source.includes('next.rulesChecking = Boolean(optimistic.admissionProjection || optimistic.projectionJob?.pending);'));
 assert(recipe.operations[0].after.includes('inHistoryMode:view?.inHistoryMode === true,positionOnly:view?.positionOnly === true'));
 const f=storeFixture(t),h=harness(f.store);assert.equal(h.run(),h.original());
 // A throwing passive sink must not turn a permitted original action into denial.
 const c={...h.context,__retreatClientSettlement:{capture(){throw Error('sink');},invalidate(){throw Error('sink');}}};const run=vm.runInNewContext(`(${callback(observed)})`,c);assert.equal(run(),h.original());
});
test('fixture uses only remainder of original unsafe receipt allowance and leaves DOM/body budgets intact',()=>{
 const spec=read('e2e/workflows/completion-preserving-retreat.spec.mjs');
 const started=spec.indexOf('const settlementDeadline=performance.now()+SYNC_TIMING.confirmationBudgetMs;');
 assert(started>=0&&started<spec.indexOf("await receipt(page,gameId,unsafe,'rejected')"));
 assert(spec.indexOf('const unchangedResponse=',started)<spec.indexOf('await humanAdmission.wait(',started));
 assert(spec.includes('await humanAdmission.wait(clientScope,Math.max(...knownSeqs),settlementDeadline)'));
 assert(spec.includes("[rejected.eventSeq,rejectedOutcomes[0].eventSeq,rejectedReceipt.eventSeq,rejectedReceipt.outcome.eventSeq,unchangedResponse.eventSeq]"));
 const support=read('e2e/support/client-settlement-observer.mjs');assert(support.includes('const remaining=deadline-performance.now();if(!(remaining>0))throw'));assert(support.includes('{timeout:remaining}'));assert(!support.includes('setTimeout'));assert(!support.includes('fetch('));
 const actual=read('e2e/support/app.mjs');assert(actual.includes('timeout:2000'));assert(spec.includes('{timeout:60000}'));
});
test('transitional missing fields remain unknown rather than false; no guessed readiness or fatal initial-mount assumption',()=>{
 const owner={getLastEventSeq:()=>0,getGameViewModel:()=>({id:'owned',positionOnly:true})};const h=harness(owner);assert.equal(h.run(),false);const p=h.snapshot();assert.equal(p.failures,0);assert.equal(p.latest.rulesChecking,null);assert.equal(p.latest.syncStatus,null);assert.equal(settlementMatches(p,h.scope(),0),false);
});

test('actual waiter forwards only remaining original allowance and rejects expired deadline before page wait',async()=>{
 const calls=[];const page={async addInitScript(){},async waitForFunction(predicate,args,options){calls.push({predicate,args,options});}};
 const owner=await installClientSettlementObserver(page,{}),scope={namespace:'owned',gameId:'owned'};
 await owner.wait(scope,5,performance.now()+1000);
 assert.equal(calls.length,1);assert(calls[0].options.timeout>0&&calls[0].options.timeout<=1000,'forwarded timeout is only the original remaining allowance');
 assert.equal(calls[0].args.scope,scope);assert.equal(calls[0].args.expectedSeq,5);
 await assert.rejects(owner.wait(scope,5,performance.now()-1),/Original unsafe receipt allowance exhausted/);
 assert.equal(calls.length,1,'expired allowance must fail before any page wait');
});

test('actual createSyncStore public boundary preserves sequence getter and natural transformed host capture',t=>{
 const g=game(),storage={getItem:k=>k==='righelt.identity.id.v1'?'reader':null,setItem(){},removeItem(){}};let requests=0;
 const store=createSyncStore({storage,commandJournal:{list:async()=>[]},fetcher:async()=>{requests++;throw Error('unexpected request');},createSyncClient:()=>({disconnectAll(){},retire(){}})});t.after(()=>store.retire());
 assert.equal(typeof store.getLastEventSeq,'function','actual sync wrapper spreads the transport getter, independently of onReady config callback');
 store.applyLiveGameUpdate({game:g,eventSeq:5,baseline:true});assert.equal(store.getLastEventSeq('owned'),5);
 const h=harness(store);assert.equal(h.run(),true);assert.equal(h.snapshot().failures,0);assert.equal(settlementMatches(h.snapshot(),h.scope(),5),true);assert.equal(requests,0);
});
test('failure categories distinguish argument evaluation, root and scalar rejection without error or payload exposure',()=>{
 const owner={getLastEventSeq:()=>4,getGameViewModel:()=>game()};
 const cases=[['argument-evaluation',h=>h.context.__retreatClientSettlement.invalidate()],['root-missing',h=>{h.context.__retreatClientSettlement.bind(h.run,null);h.context.__retreatClientSettlement.capture(owner,h.run,{});}],['root-disconnected',h=>{h.root.isConnected=false;h.context.__retreatClientSettlement.capture(owner,h.run,{});}],['root-mismatch',h=>{h.replaceRoot();h.context.__retreatClientSettlement.capture(owner,h.run,{});}],['owner-invalid',h=>h.context.__retreatClientSettlement.capture(null,h.run,{})],['field-unexpected',h=>h.context.__retreatClientSettlement.capture(owner,h.run,{secret:'must not appear'})],['field-unknown',h=>h.context.__retreatClientSettlement.capture(owner,h.run,{})]];
 for(const[category,action]of cases){const h=harness(owner);action(h);const p=h.snapshot();assert.equal(p.failures,1,category);assert.equal(p.categories[category],1);assert.equal(p.latest,null);assert(!JSON.stringify(p).includes('must not appear'));assert.deepEqual(Object.keys(p.categories),[category]);}
});
test('actual bindElements same-runtime DOM replacement reproduces stale root then qualifies only the newly bound root',t=>{
 const rawRuntime=read('apps/web/board/runtime/board-runtime.js'),oldRuntimeRecipe=JSON.parse(read('e2e/support/board-admission-transformations.json'))['/board/runtime/board-runtime.js'];
 const priorRuntime=transformBoardAdmissionModule(rawRuntime,oldRuntimeRecipe),runtimeRecipe=JSON.parse(read('e2e/support/client-settlement-transformation.json'))['/board/runtime/board-runtime.js'];
 const currentRuntime=transformClientSettlement(rawRuntime,priorRuntime,runtimeRecipe);
 const bindSource=source=>{const i=source.indexOf('  const bindElements =');return source.slice(i,source.indexOf('\n  };',i)+5)+';bindElements;';};
 function replace(h,source){const next={isConnected:true};h.root.isConnected=false;h.setRoot(next);const noop=()=>{};
  const context={elements:{boardEl:h.root},host:{canInteract:h.run},mounted:true,bindPreviewLifecycle:noop,messageHeightController:null,createMessageHeightController:()=>({destroy:noop}),boardAdapter:{mount:noop},handleBoardPreviewClick:noop,handleBoardCellClick:noop,handleBoardCellHoverStart:noop,handleBoardCellHoverEnd:noop,renderBoard:h.run,renderStatus:noop,boardAdmissionProbe:noop,__retreatClientSettlement:h.context.__retreatClientSettlement};
  vm.runInNewContext(bindSource(source),context)({boardEl:next,overlayLinesEl:{},boardPreviewLabelEl:null,boardTurnIndicatorEl:null});return next;
 }
 const f=storeFixture(t);f.store.applyLiveGameUpdate({game:f.g,eventSeq:5,baseline:true});
 const before=harness(f.store);before.run();const beforeScope=before.scope();replace(before,priorRuntime);
 assert.equal(before.snapshot().categories['root-disconnected'],1,'original binding omission reproduces exact categorized native failure');assert.equal(settlementMatches(before.snapshot(),beforeScope,5),false);
 assert.throws(()=>assert.equal(settlementMatches(before.snapshot(),beforeScope,5),true),assert.AssertionError,'original fixture premise fails with real retained runtime bind source');
 const repaired=harness(f.store);repaired.run();const oldScope=repaired.scope();replace(repaired,currentRuntime);
 assert.equal(repaired.snapshot().failures,0);assert.equal(repaired.snapshot().latest.appliedEventSeq,5);assert.equal(settlementMatches(repaired.snapshot(),oldScope,5),false,'replacement after scope still cannot inherit prior root authority');assert.equal(settlementMatches(repaired.snapshot(),repaired.scope(),5),true);
 let inverse=currentRuntime;for(const op of [...runtimeRecipe.operations].reverse())inverse=inverse.slice(0,op.start)+op.before+inverse.slice(op.start+op.after.length);assert.equal(inverse,priorRuntime);
 assert(read('apps/web/board/hosts/shell-host.js').includes('  canInteract,\n'),'host passes original callback identity through unchanged');
});
test('root binding cannot transfer to stale host or replaced store even for the same game',t=>{
 const f=storeFixture(t);f.store.applyLiveGameUpdate({game:f.g,eventSeq:5,baseline:true});
 const stale=harness(f.store);stale.run();const otherHost=()=>true;stale.context.__retreatClientSettlement.bind(otherHost,stale.root);stale.run();assert.equal(stale.snapshot().categories['host-stale'],1);assert.equal(stale.snapshot().latest,null);
 const replaced=harness(f.store);replaced.run();const replacement={...f.store};replaced.context.transport=replacement;assert.equal(replaced.run(),true,'observer does not alter original owner result');assert.equal(replaced.snapshot().categories['store-mismatch'],1);assert.equal(replaced.snapshot().latest,null);
});
test('both app and runtime source bindings reject mismatches and invert to unchanged existing observer goldens',()=>{
 const additions=JSON.parse(read('e2e/support/client-settlement-transformation.json')),originals=JSON.parse(read('e2e/support/board-admission-transformations.json'));
 assert.deepEqual(Object.keys(additions).sort(),['/board/runtime/board-runtime.js','/shell/app.js']);
 for(const[path,r]of Object.entries(additions)){const raw=read(r.file),input=transformBoardAdmissionModule(raw,originals[path]),output=transformClientSettlement(raw,input,r);let inverse=output;
  for(const op of [...r.operations].reverse())inverse=inverse.slice(0,op.start)+op.before+inverse.slice(op.start+op.after.length);assert.equal(inverse,input,path);
  assert.throws(()=>transformClientSettlement(raw+' ',input,r));assert.throws(()=>transformClientSettlement(raw,input+' ',r));
  for(const bad of [{...r,prefix:'bad'},{...r,outputSha256:'0'.repeat(64)},{...r,operations:[{...r.operations[0],anchorCount:2}]},{...r,operations:[{...r.operations[0],before:'bad'}]}])assert.throws(()=>transformClientSettlement(raw,input,bad),undefined,path);
 }
});

// Execute the installed protocol bodies; only serialization/handle conversion
// are inert leaves because these controls never launch a browser or own handles.
function actualPlaywrightWaitProtocol(snapshot){
 const own=createRequire(new URL('../../../package.json',import.meta.url)),testRequire=createRequire(own.resolve('@playwright/test/package.json')),pwRequire=createRequire(testRequire.resolve('playwright/package.json')),corePath=pwRequire.resolve('playwright-core/package.json').replace(/package\.json$/,'');
 const client=readFileSync(corePath+'lib/client/frame.js','utf8'),server=readFileSync(corePath+'lib/server/frames.js','utf8'),sha=value=>createHash('sha256').update(value).digest('hex');assert.equal(sha(client),'49a0d5aa0c154b4fd588eda16a25cc93909923f91c06ce9afdd384506b703991');assert.equal(sha(server),'a0a5c3655b86edeb1e6acb8133d40769dda53c246340271251598dac5ff48594');
 const methodStart='  async waitForFunction(pageFunction, arg, options = {}) {';assert.equal(client.split(methodStart).length-1,1);const begin=client.indexOf(methodStart),end=client.indexOf('\n  }',begin)+4;assert(end>begin);const clientMethod=client.slice(begin,end);
 const predicateStart='        let evaledExpression;',predicateEnd='        let fulfill;';assert.equal(server.split(predicateStart).length-1,1);const a=server.indexOf(predicateStart),b=server.indexOf(predicateEnd,a);assert(b>a);const predicateSource=server.slice(a,b),makePredicate=vm.runInNewContext('({expression2,isFunction2,arg2})=>{'+predicateSource+'return predicate;}',{__retreatClientSettlement:{snapshot}});
 let poll;const protocol=[],samples=[];
 const channel={waitForFunction(params){protocol.push(params);const predicate=makePredicate({expression2:params.expression,isFunction2:params.isFunction,arg2:params.arg});return new Promise(resolve=>{poll=()=>{const value=predicate();samples.push({type:typeof value,truthy:Boolean(value)});if(value)resolve({handle:value});};poll();});}};
 const imported={serializeArgument:value=>value,JSHandle:{from:value=>value}},owner=vm.runInNewContext('({'+clientMethod+'})',{import_assert:{assert},import_jsHandle:imported});owner._channel=channel;owner._timeout=options=>options.timeout;
 return{page:{addInitScript:async()=>{},waitForFunction:owner.waitForFunction.bind(owner)},poll:()=>poll(),protocol,samples};
}
test('actual installed Playwright protocol keeps the exported waiter pending until receipt and blockers truly settle',async t=>{
 const f=storeFixture(t),h=harness(f.store);h.run();const scope=h.scope(),protocol=actualPlaywrightWaitProtocol(h.snapshot);const owner=await installClientSettlementObserver(protocol.page,{});let settled=false;
 const pending=owner.wait(scope,5,performance.now()+1000);pending.then(()=>{settled=true;});for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(settled,false,'A string evaluating to a function object must not satisfy the real client settlement barrier');assert.deepEqual(protocol.samples,[{type:'boolean',truthy:false}]);assert.equal(protocol.protocol[0].isFunction,true);assert.equal(protocol.protocol[0].arg.scope,scope);assert.equal(protocol.protocol[0].arg.expectedSeq,5);
 f.store.applyLiveGameUpdate({game:f.g,eventSeq:5,baseline:true});f.store.setConnectionRecovering('owned',true,{reason:'behind_server'});h.run();protocol.poll();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(settled,false,'Consumed sequence alone cannot admit recovery');
 f.store.setConnectionRecovering('owned',false);h.run();protocol.poll();await pending;assert.equal(settled,true);assert(protocol.samples.every(row=>row.type==='boolean'));assert.equal(f.requests(),0,'Waiter only observes the existing recorder');
});
test('actual installed protocol keeps missing recorder evidence pending and never compiles scope data into the predicate',async t=>{
 const f=storeFixture(t),h=harness(f.store);f.store.applyLiveGameUpdate({game:f.g,eventSeq:5,baseline:true});h.run();const scope=h.scope();let packet=null;const protocol=actualPlaywrightWaitProtocol(()=>packet),owner=await installClientSettlementObserver(protocol.page,{});let settled=false;
 const pending=owner.wait(scope,5,performance.now()+1000);pending.then(()=>{settled=true;});for(let i=0;i<10;i++)await Promise.resolve();assert.equal(settled,false);assert.equal(protocol.protocol[0].isFunction,true);assert(!protocol.protocol[0].expression.includes(scope.gameId));assert(!protocol.protocol[0].expression.includes(scope.namespace));packet=h.snapshot();protocol.poll();await pending;assert.equal(settled,true);assert.equal(protocol.protocol.length,1,'Same original wait, no restart');
});
