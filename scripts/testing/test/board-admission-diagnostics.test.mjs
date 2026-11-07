import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {installBoardAdmissionCollector,transformBoardAdmissionModule,installBoardAdmissionDiagnostics,cloneBoardSourceHandoff,createBoardSourceConsoleRetention,SOURCE_PRESS_PREFIX,SOURCE_PRESS_MAX_BYTES} from '../../../e2e/support/board-admission-diagnostics.mjs';

const recipes=JSON.parse(await readFile(new URL('../../../e2e/support/board-admission-transformations.json',import.meta.url),'utf8'));
for(const [pathname,recipe] of Object.entries(recipes))test(`exact source and protected transform ${pathname}`,async()=>{
 const source=await readFile(new URL('../../../'+recipe.file,import.meta.url),'utf8');
 // Resolve from repo root, not the support directory.
 assert.ok(source.length>0);
 const transformed=transformBoardAdmissionModule(source,recipe);
 assert.ok(transformed.startsWith(recipe.prefix));
 assert.throws(()=>transformBoardAdmissionModule(source+'\n',recipe),/source hash mismatch/);
 const broken={...recipe,operations:recipe.operations.map((op,i)=>i?op:{...op,anchorCount:2})};
 assert.throws(()=>transformBoardAdmissionModule(source,broken),/anchor count mismatch/);
});

test('value wrapper preserves getter identity and skipped guard branches with a throwing sink',()=>{
 const recipe=recipes['/board/runtime/board-runtime.js'];
 const operation=recipe.operations.find(op=>op.after.includes('submit-no-state'));
 assert.ok(operation);
 const original=operation.before.match(/if \((.*)\) \{/)[1];
 const instrumented=operation.after.match(/if \((.*)\) \{/)[1];
 const run=(expression,{state,submitting=false,permission=false})=>{
  let getterCalls=0,functionCalls=0;
  const host={get canInteract(){getterCalls++;return()=>{functionCalls++;return permission;};}};
  const fn=new Function('state','destroyed','interactionBlocked','submitting','overlayMode','OVERLAY_MODE','host',recipe.prefix+'return Boolean('+expression+');');
  const result=fn(state,false,false,submitting,'interactive',{INTERACTIVE:'interactive'},host);
  return {result,getterCalls,functionCalls};
 };
 const previous=globalThis.__boardAdmissionRecord;globalThis.__boardAdmissionRecord=()=>{throw new Error('sink');};
 try{
  for(const inputs of [{state:null},{state:{},permission:false},{state:{},permission:true},{state:{},submitting:true}])assert.deepEqual(run(instrumented,inputs),run(original,inputs));
  assert.deepEqual(run(instrumented,{state:{},permission:false}),{result:true,getterCalls:1,functionCalls:1});
  assert.deepEqual(run(instrumented,{state:{},permission:true}),{result:false,getterCalls:1,functionCalls:1});
  assert.deepEqual(run(instrumented,{state:{},submitting:true}),{result:true,getterCalls:0,functionCalls:0});
 }
 finally{if(previous===undefined)delete globalThis.__boardAdmissionRecord;else globalThis.__boardAdmissionRecord=previous;}
});

test('transport conditional observes only the original human or computer branch',()=>{
 const recipe=recipes['/shell/live-transport.js'];
 const op=recipe.operations.find(op=>op.after.includes('transport-position-only'));
 const expression=op.after.match(/if \((.*)\) \{/)[1];
 const run=(positionOnly,computer)=>{
  const reads=[];const current={positionOnly,get gameplayMutationsBlocked(){reads.push('human');return false;},get sharedMutationsBlocked(){reads.push('computer');return false;}};
  new Function('current','command',recipe.prefix+'return Boolean('+expression+');')(current,{computer});return reads;
 };
 assert.deepEqual(run(true,false),[]);assert.deepEqual(run(false,false),['human']);assert.deepEqual(run(false,true),['computer']);
});

test('transport admission instrumentation retains the diagnostic body and original getter decisions',async()=>{
 const recipe=recipes['/shell/live-transport.js'];
 const operation=recipe.operations.find(op=>op.after.includes('transport-position-only'));
 const source=await readFile(new URL('../../../'+recipe.file,import.meta.url),'utf8');
 const start=source.indexOf(operation.before);
 const end=source.indexOf('      const isClosure = ',start);
 assert.ok(start>=0&&end>start);
 const original=source.slice(start,end);
 const instrumented=operation.after+original.slice(operation.before.length);
 const retainedBody='        reportRecoveryDiagnostic(gameId, \'admission_blocked\', { reason: \'sync_recovering\' });\n        throw Object.assign(new Error("sync_recovering"), { code: "sync_recovering" });\n      }\n';
 assert.equal(original.slice(operation.before.length),retainedBody);
 assert.equal(instrumented.slice(operation.after.length),retainedBody);
 const run=(code,{positionOnly,computer,blocked})=>{
  const reads=[],reports=[];
  const current={get positionOnly(){reads.push('position');return positionOnly;},
   get gameplayMutationsBlocked(){reads.push('human');return blocked;},
   get sharedMutationsBlocked(){reads.push('computer');return blocked;}};
  const command={get computer(){reads.push('kind');return computer;}};
  const reportRecoveryDiagnostic=(...args)=>reports.push(args);
  let result;
  try{result=new Function('current','command','reportRecoveryDiagnostic','gameId',recipe.prefix+code+'return "admitted";')(current,command,reportRecoveryDiagnostic,'test-game');}
  catch(error){result={message:error.message,code:error.code};}
  return {result,reads,reports};
 };
 const previous=globalThis.__boardAdmissionRecord;globalThis.__boardAdmissionRecord=()=>{throw new Error('sink');};
 try{
  for(const input of [{positionOnly:true,computer:false,blocked:false},
   {positionOnly:false,computer:false,blocked:false},{positionOnly:false,computer:false,blocked:true},
   {positionOnly:false,computer:true,blocked:false},{positionOnly:false,computer:true,blocked:true}]){
   assert.deepEqual(run(instrumented,input),run(original,input));
  }
  assert.deepEqual(run(instrumented,{positionOnly:true,computer:false,blocked:false}),{
   result:{message:'sync_recovering',code:'sync_recovering'},reads:['position'],
   reports:[['test-game','admission_blocked',{reason:'sync_recovering'}]],
  });
  assert.deepEqual(run(instrumented,{positionOnly:false,computer:false,blocked:true}).reads,['position','kind','human']);
  assert.deepEqual(run(instrumented,{positionOnly:false,computer:true,blocked:true}).reads,['position','kind','computer']);
  const failure=new Error('original transport getter');
  for(const code of [original,instrumented]){
   let reads=0;const current={get positionOnly(){reads++;throw failure;}};
   const invoke=new Function('current','command','reportRecoveryDiagnostic','gameId',recipe.prefix+code);
   assert.throws(()=>invoke(current,{computer:false},()=>{},'test-game'),error=>error===failure);
   assert.equal(reads,1);
  }
 }finally{if(previous===undefined)delete globalThis.__boardAdmissionRecord;else globalThis.__boardAdmissionRecord=previous;}
});

const collector=(options={},overrides={})=>{
 const messages=[],listeners=new Map(),root={isConnected:true};const sandbox={TextEncoder,cloneBoardSourceHandoff,SOURCE_PRESS_PREFIX,SOURCE_PRESS_MAX_BYTES,console:{debug:value=>messages.push(value)},addEventListener:(type,fn)=>listeners.set('window:'+type,fn),performance:{timeOrigin:123,now:()=>456},document:{querySelector:()=>root,addEventListener:(type,listener,options)=>listeners.set(type+':'+(options.capture?'capture':'bubble'),listener)}};
 Object.assign(sandbox,overrides);
 vm.createContext(sandbox);vm.runInContext('('+installBoardAdmissionCollector.toString()+')('+JSON.stringify({targetRow:3,targetCol:0,...options})+')',sandbox);
 return {sandbox,listeners,root,messages,log:sandbox.__boardAdmissionObservation,record:sandbox.__boardAdmissionRecord};
};
test('bounded collection exposes drops and cannot leak arbitrary payload fields',()=>{
 const {record,log}=collector();for(let i=0;i<300;i++)record('test',{value:true,rawState:'secret',gameId:'secret'},{});
 assert.equal(log.first.length,64);assert.equal(log.tail.length,64);assert.equal(log.dropped,172);assert.equal(log.incomplete,true);
 assert.equal('rawState' in log.first[0],false);assert.equal('gameId' in log.first[0],false);
});
test('first matching activation survives later activation and rolling churn',()=>{
 const {record,log,listeners}=collector();const root={},cell={dataset:{row:'3',col:'0'},closest:()=>root};const event={type:'pointerdown',isTrusted:true,target:{closest:()=>cell}};
 listeners.get('pointerdown:capture')(event);for(let i=0;i<100;i++)record('old');const first=log.firstActivation[0].sequence;
 listeners.get('pointerdown:capture')(event);record('new');
 assert.equal(log.firstActivation[0].sequence,first);assert.equal(log.activationGeneration,2);assert.equal(log.supersededActivations,1);assert.equal(log.incomplete,true);assert.equal(log.activation.at(-1).event,'new');
});
test('throwing projection data marks observation incomplete without throwing into app code',()=>{
 const {record,log}=collector();const data={get value(){throw new Error('getter');}};assert.doesNotThrow(()=>record('broken',data));assert.equal(log.incomplete,true);
});

test('outside pointer release is retained separately from the remembered cell bounce',()=>{
 const {record,log,listeners,root,sandbox}=collector();
 const cell={dataset:{row:'3',col:'0'},isConnected:true,closest:selector=>selector==='.cell'?cell:root};
 const outside={isConnected:true,closest:()=>null};
 const down={type:'pointerdown',isTrusted:true,pointerId:7,target:cell,currentTarget:sandbox.document,composedPath:()=>[cell,root,sandbox.document]};
 listeners.get('pointerdown:capture')(down);listeners.get('pointerdown:bubble')(down);
 const up={type:'pointerup',isTrusted:true,pointerId:7,target:outside,currentTarget:sandbox.document,composedPath:()=>[outside,sandbox.document]};
 listeners.get('pointerup:capture')(up);listeners.get('pointerup:bubble')(up);
 record('shell-release-bounce',{connected:true},cell);
 const rows=log.activation,press=rows.find(row=>row.event==='native-pointerdown'),release=rows.find(row=>row.event==='native-pointerup'),bounce=rows.at(-1);
 assert.equal(press.pathContainsCurrentRoot,true);assert.equal(release.pathContainsCurrentRoot,false);
 assert.notEqual(press.targetToken,release.targetToken);assert.equal(press.subjectToken,bounce.subjectToken);
 assert.equal(release.targetConnected,true);assert.equal(release.currentRootConnected,true);
 assert.ok(rows.some(row=>row.event==='native-pointerup'&&row.dispatchPhase==='bubble'));
 assert.ok(Array.isArray(release.pathTokens));assert.equal(release.pointerId,7);
});

test('preview echo guard preserves evaluated getter and serialization counts',()=>{
 const recipe=recipes['/board/runtime/board-runtime.js'];
 const operation=recipe.operations.find(op=>op.after.includes('preview-echo-present'));
 const before=operation.before.split('\n').find(line=>line.includes('if (body.state &&'));
 const after=operation.after.split('\n').find(line=>line.includes('preview-echo-present'));
 const original=before.match(/if \((.*)\) return;/)[1],instrumented=after.match(/if \((.*)\) return;/)[1];
 const run=(expression,present,matching)=>{
  let reads=0,serializations=0;const state=present?{toJSON(){serializations++;return {same:matching};}}:null;
  const body={get state(){reads++;return state;}};
  const result=new Function('body','requestedSnapshot',recipe.prefix+'return Boolean('+expression+');')(body,'{"same":true}');
  return {result,reads,serializations};
 };
 const previous=globalThis.__boardAdmissionRecord;globalThis.__boardAdmissionRecord=()=>{throw new Error('sink');};
 try{
  for(const args of [[false,false],[true,false],[true,true]])assert.deepEqual(run(instrumented,...args),run(original,...args));
  assert.deepEqual(run(instrumented,true,true),{result:false,reads:2,serializations:1});
  const failure=new Error('original getter');
  for(const expression of [original,instrumented]){
   let reads=0;const body={get state(){reads++;throw failure;}};
   assert.throws(()=>new Function('body','requestedSnapshot',recipe.prefix+'return Boolean('+expression+');')(body,''),error=>error===failure);assert.equal(reads,1);
  }
 }finally{if(previous===undefined)delete globalThis.__boardAdmissionRecord;else globalThis.__boardAdmissionRecord=previous;}
});
test('preview lifetime discard operands retain original short-circuit decisions',()=>{
 const recipe=recipes['/board/runtime/board-runtime.js'];
 const operation=recipe.operations.find(op=>op.after.includes('preview-destroyed'));
 const before=operation.before.split('\n').find(line=>line.includes('if (destroyed || revision !=='));
 const after=operation.after.split('\n').find(line=>line.includes('preview-destroyed'));
 const original=before.match(/if \((.*)\) return;/)[1],instrumented=after.match(/if \((.*)\) return;/)[1];
 const names=['destroyed','revision','snapshotRevision','requestId','selectedPieceMovesRequestId','selectedPieceId','requestedPieceId'];
 const cases=[[true,1,1,2,2,'p','p'],[false,1,3,2,2,'p','p'],[false,1,1,2,4,'p','p'],[false,1,1,2,2,'p','q'],[false,1,1,2,2,'p','p']];
 const previous=globalThis.__boardAdmissionRecord;
 try{
  for(const [i,values] of cases.entries()){
   const observed=[];globalThis.__boardAdmissionRecord=event=>observed.push(event);
   const result=new Function(...names,recipe.prefix+'return Boolean('+instrumented+');')(...values);
   assert.equal(result,new Function(...names,'return Boolean('+original+');')(...values));
   const expected=['preview-destroyed','preview-revision-stale','preview-request-stale','preview-piece-stale'].slice(0,Math.min(i+1,4));
   assert.deepEqual(observed,expected);
  }
 }finally{if(previous===undefined)delete globalThis.__boardAdmissionRecord;else globalThis.__boardAdmissionRecord=previous;}
});


test('selected-piece toggle guard preserves identity getter and skipped toggle calls',()=>{
 const recipe=recipes['/board/runtime/board-runtime.js'];
 const op=recipe.operations.find(op=>op.after.includes('selected-piece-id-equal'));
 const original=op.before.match(/if \((.*)\) \{/)[1];
 const observed=op.after.match(/if \((.*)\) \{/)[1];
 const run=(expression,equal)=>{
  let reads=0,calls=0;const selectedPieceId='selected';
  const clickedPiece={get id(){reads++;return equal?'selected':'other';}};
  const canToggleSelectedPieceOverlay=()=>{calls++;return true;};
  const result=new Function('clickedPiece','selectedPieceId','canToggleSelectedPieceOverlay',recipe.prefix+'return Boolean('+expression+');')(clickedPiece,selectedPieceId,canToggleSelectedPieceOverlay);
  return {result,reads,calls};
 };
 const previous=globalThis.__boardAdmissionRecord;globalThis.__boardAdmissionRecord=()=>{throw new Error('sink');};
 try{for(const equal of [false,true])assert.deepEqual(run(observed,equal),run(original,equal));
 assert.deepEqual(run(observed,false),{result:false,reads:1,calls:0});
 assert.deepEqual(run(observed,true),{result:true,reads:1,calls:1});
 }finally{if(previous===undefined)delete globalThis.__boardAdmissionRecord;else globalThis.__boardAdmissionRecord=previous;}
});

test('actual ensure helper preserves a check-to-click restoration counterexample',async()=>{
 const sourceText=await readFile(new URL('../../../e2e/support/app.mjs',import.meta.url),'utf8');
 const begin=sourceText.indexOf('export const ensureActionActorSelected = ');
 const end=sourceText.indexOf('export const selectPlayableAction',begin);
 assert.ok(begin>=0&&end>begin);
 const helperText=sourceText.slice(begin,end).replace('export const ensureActionActorSelected = ','');
 const events=[];const sandbox={globalThis:null,expect:()=>({toHaveClass:async()=>{}})};
 sandbox.globalThis=sandbox;sandbox.__boardAdmissionRecord=(...args)=>{events.push(args.slice(0,2));throw new Error('sink');};
 vm.createContext(sandbox);
 const helper=vm.runInContext('('+helperText.trim().replace(/;$/,'')+')',sandbox);
 let selected=false,clicks=0,reads=0,toggled=false;
 const element={classList:{contains:()=>{reads++;return selected;}}};
 const source={evaluate:async callback=>{const value=callback(element);selected=true;return value;},click:async()=>{clicks++;if(selected)toggled=true;}};
 await helper(source);
 assert.equal(reads,1);assert.equal(clicks,1);assert.equal(toggled,true);
 assert.equal(events[0][0],'fixture-ensure-source-read');assert.equal(events[0][1].value,false);
 // This models the permitted boundary only. It does not prove the CI race,
 // change the helper's choice, or suppress the user's explicit toggle click.
});


test('helper first and latest read snapshots survive bounded rolling eviction',()=>{
 const {record,log}=collector();const node={};
 record('fixture-ensure-source-read',{value:false},node);const first=log.firstSourceRead;
 for(let i=0;i<200;i++)record('churn');
 record('fixture-ensure-source-read',{value:true},node);
 assert.equal(log.firstSourceRead,first);assert.equal(log.firstSourceRead.value,false);
 assert.equal(log.lastSourceRead.value,true);assert.equal(log.sourceReadCount,2);
 assert.equal(log.firstSourceRead.subjectToken,log.lastSourceRead.subjectToken);
 assert.equal(log.incomplete,true);assert.ok(log.dropped>0);
});

const sourceCell=(root,row=3,col=6)=>{const cell={dataset:{row:String(row),col:String(col)},isConnected:true};cell.closest=selector=>selector==='.cell'?cell:root;return cell;};
const nativeEvent=(type,target,root,document)=>({type,isTrusted:true,pointerId:7,button:0,buttons:type.endsWith('down')?1:0,target,currentTarget:document,composedPath:()=>[target,root,document]});
const armSource=h=>{const first=sourceCell(h.root),second=sourceCell(h.root);h.sandbox.__boardAdmissionSourceRead(false,first);h.sandbox.__boardAdmissionSourceRead(false,second);return second;};

test('actual source callback preserves one class read, click choice, errors and skipped branches',async()=>{
 const text=await readFile(new URL('../../../e2e/support/app.mjs',import.meta.url),'utf8');
 const begin=text.indexOf('export const selectPlayableAction = '),end=text.indexOf('export const submitPlayableAction',begin);assert.ok(begin>0&&end>begin);
 const body=text.slice(begin,end).replace('export const selectPlayableAction = ','').trim().replace(/;$/,'');
 for(const selected of [false,true]){
  let reads=0,contains=0,clicks=0,probes=0;
  const element={get classList(){reads++;return {contains:()=>{contains++;return selected;}};}};
  const source={evaluate:async fn=>fn(element),click:async()=>clicks++};
  const target={evaluate:async fn=>fn({classList:{contains:()=>true}})};
  const sandbox={expect:()=>({not:{toHaveAttribute:async()=>{}},toHaveClass:async()=>{}}),__boardAdmissionSourceRead:()=>{probes++;throw Error('secret-sink');}};
  const fn=vm.runInNewContext('('+body+')',sandbox);
  const page={locator:selector=>selector==='html'?{getAttribute:async()=> 'none'}:selector.includes('data-row="3"')?source:target};
  assert.equal(await fn(page,{type:'move',from:{row:3,col:6},to:{row:2,col:6}}),target);
  assert.equal(reads,1);assert.equal(contains,1);assert.equal(clicks,selected?0:1);assert.equal(probes,1);
  reads=0;probes=0;await fn(page,{type:'retreat',from:{row:3,col:6},to:{row:2,col:6}});assert.equal(reads,0);assert.equal(probes,0);
  const failure=Error('original-getter');Object.defineProperty(element,'classList',{get(){throw failure;}});
  await assert.rejects(fn(page,{type:'move',from:{row:3,col:6},to:{row:2,col:6}}),error=>error===failure);
 }
});
test('second source read arms before input and mouse/pointer duplicates never replace it',()=>{
 const h=collector({sourceAttemptOrdinal:2});const first=sourceCell(h.root);h.sandbox.__boardAdmissionSourceRead(true,first);
 assert.equal(h.log.sourceWindow.observed,false);assert.equal(h.log.sourceWindow.incomplete,true);
 const source=sourceCell(h.root);h.sandbox.__boardAdmissionSourceRead(false,source);
 const marker=h.log.sourceWindow.first[0];assert.equal(marker.value,false);assert.equal(marker.count,2);assert.equal(marker.event,'fixture-source-class-read');
 for(const type of ['mousedown','pointerdown','mouseup','pointerup','click'])h.listeners.get(type+':capture')(nativeEvent(type,source,h.root,h.sandbox.document));
 assert.equal(h.log.sourceWindow.first[0],marker);assert.equal(h.log.sourceWindow.attemptsObserved,2);assert.equal(h.log.sourceWindow.markerRecorded,true);
 assert.equal(h.log.activationGeneration,0);assert.equal(h.log.sourceWindow.incomplete,false);
 assert.ok(h.log.sourceWindow.first.some(row=>row.event==='native-mousedown'));
});
test('source window retains earliest press and latest rows with explicit bounds and privacy',()=>{
 const h=collector({sourceAttemptOrdinal:2});armSource(h);const marker=h.log.sourceWindow.first[0];
 for(let i=0;i<300;i++)h.record('churn',{value:true,gameId:'secret-token',rawState:'secret-token'});
 assert.equal(h.log.sourceWindow.first.length,64);assert.equal(h.log.sourceWindow.tail.length,64);assert.equal(h.log.sourceWindow.dropped,173);
 assert.equal(h.log.sourceWindow.first[0],marker);assert.equal(h.log.sourceWindow.incomplete,true);assert.equal(h.log.incomplete,true);
 assert.equal(JSON.stringify(h.log.sourceWindow).includes('secret-token'),false);
});
test('missing, collected or unsupported weak source stays nullable and incomplete',()=>{
 for(const WeakRef of [undefined,class{deref(){return undefined;}},class{deref(){throw Error('secret-reference');}}]){
  const h=collector({sourceAttemptOrdinal:2},{WeakRef});const source=armSource(h);
  assert.doesNotThrow(()=>h.listeners.get('mousedown:capture')(nativeEvent('mousedown',source,h.root,h.sandbox.document)));
  assert.equal(h.log.sourceWindow.incomplete,true);assert.ok(h.log.sourceWindow.projectionFailures>0);
  assert.equal(h.log.sourceWindow.first.at(-1).sourceConnected,null);assert.equal(JSON.stringify(h.log).includes('secret-reference'),false);
 }
});
test('source and native metadata projection errors are nonthrowing and explicitly incomplete',()=>{
 const h=collector({sourceAttemptOrdinal:2});h.sandbox.__boardAdmissionSourceRead(false,sourceCell(h.root));
 const broken={get dataset(){throw Error('secret-source');}};
 assert.doesNotThrow(()=>h.sandbox.__boardAdmissionSourceRead(false,broken));assert.equal(h.log.sourceWindow.markerRecorded,false);assert.equal(h.log.sourceWindow.incomplete,true);
 const event={get target(){throw Error('secret-event');}};
 assert.doesNotThrow(()=>h.listeners.get('mouseup:capture')(event));assert.equal(h.log.sourceWindow.lastFailure,'native-projection-failed');
 assert.equal(JSON.stringify(h.log).includes('secret-'),false);
});
test('source absence stays unobserved and invalid ordinals fail closed',()=>{
 const h=collector({sourceAttemptOrdinal:2});h.sandbox.__boardAdmissionSourceRead(false,sourceCell(h.root));
 assert.equal(h.log.sourceWindow.observed,false);assert.equal(h.log.sourceWindow.markerRecorded,false);assert.equal(h.log.sourceWindow.incomplete,true);
 for(const sourceAttemptOrdinal of [0,-1,1.5,'2'])assert.throws(()=>collector({sourceAttemptOrdinal}),/Invalid source attempt ordinal/);
 const normal=collector();assert.equal(normal.sandbox.__boardAdmissionSourceRead,undefined);assert.equal(normal.listeners.has('mousedown:capture'),false);
});
test('source window measures distinct press, replacement and release roots without synthesizing state',()=>{
 const h=collector({sourceAttemptOrdinal:2});const oldSource=armSource(h);
 h.listeners.get('mousedown:capture')(nativeEvent('mousedown',oldSource,h.root,h.sandbox.document));
 const nextRoot={isConnected:true},nextSource=sourceCell(nextRoot);oldSource.isConnected=false;h.sandbox.document.querySelector=()=>nextRoot;
 h.record('runtime-bind',{sameNodes:false},nextRoot);
 h.listeners.get('mouseup:capture')(nativeEvent('mouseup',nextSource,nextRoot,h.sandbox.document));
 const rows=Array.from(h.log.sourceWindow.first),down=rows.find(row=>row.event==='native-mousedown'),bind=rows.find(row=>row.event==='runtime-bind'),up=rows.find(row=>row.event==='native-mouseup');
 assert.ok(down.sequence<bind.sequence&&bind.sequence<up.sequence);assert.equal(down.sourceConnected,true);assert.equal(up.sourceConnected,false);
 assert.notEqual(down.cellRootToken,up.cellRootToken);assert.equal(h.log.sourceWindow.incomplete,false);
});
test('case source opt-in leaves the original two move actions and assertion body byte-identical',async()=>{
 const current=await readFile(new URL('../../../e2e/workflows/recovery-freeze-regression.spec.mjs',import.meta.url),'utf8');
 // Reviewed 0a959 fixture bytes, independent of the checkout's current HEAD.
 const normalized=current.replace(',sourceAttemptOrdinal:2','').replace('  await admissionDiagnostics.checkpoint();\n','');
 assert.equal(createHash('sha256').update(normalized).digest('hex'),'165ec16bb620c0038a8059a2d513401a5a258069ea6ae397130bb58fb5844d30');
 const body=current.slice(current.indexOf("test('Horus finishes a real turn"));assert.equal(body.split('await submitPlayableAction(page,').length-1,2);
 assert.equal(current.split('sourceAttemptOrdinal:2').length-1,1);
});


const sourcePacket=()=>{const h=collector({sourceAttemptOrdinal:2});armSource(h);return cloneBoardSourceHandoff({version:1,timeOrigin:123,sourceWindow:h.log.sourceWindow});};
const consolePage=()=>{const listeners=new Set(),foreign=()=>{};listeners.add(foreign);return {listeners,foreign,on(type,fn){assert.equal(type,'console');listeners.add(fn);},off(type,fn){assert.equal(type,'console');listeners.delete(fn);},emit(text){for(const fn of [...listeners])fn({text:()=>text});}};};

test('native pagehide emits once only after an observed marker without invoking toJSON or getters',()=>{
 const h=collector({sourceAttemptOrdinal:2});const hide=h.listeners.get('window:pagehide');
 hide({isTrusted:true});assert.equal(h.messages.length,0);armSource(h);
 vm.runInContext('globalThis.jsonCalls=0;Object.prototype.toJSON=function(){jsonCalls++;throw Error("custom-json");};Array.prototype.toJSON=Object.prototype.toJSON;',h.sandbox);
 hide({isTrusted:false});assert.equal(h.messages.length,0);hide({isTrusted:true});hide({isTrusted:true});
 assert.equal(h.messages.length,1);assert.equal(h.sandbox.jsonCalls,0);
 const packet=cloneBoardSourceHandoff(JSON.parse(h.messages[0].slice(SOURCE_PRESS_PREFIX.length)));
 assert.equal(packet.sourceWindow.observed,true);assert.equal(packet.timeOrigin,123);
 const broken=collector({sourceAttemptOrdinal:2});armSource(broken);let gets=0;
 Object.defineProperty(broken.log.sourceWindow.first[0],'now',{get(){gets++;throw Error('secret-getter');}});
 assert.doesNotThrow(()=>broken.listeners.get('window:pagehide')({isTrusted:true}));assert.equal(gets,0);assert.equal(broken.messages.length,0);assert.equal(broken.log.sourceWindow.incomplete,true);
 const consoleBroken=collector({sourceAttemptOrdinal:2},{console:{debug(){throw Error('secret-console');}}});armSource(consoleBroken);
 assert.doesNotThrow(()=>consoleBroken.listeners.get('window:pagehide')({isTrusted:true}));assert.equal(consoleBroken.log.sourceWindow.incomplete,true);
});
test('first immutable handoff survives reload without merging epochs or replacing it on duplicates',()=>{
 const page=consolePage(),capture=createBoardSourceConsoleRetention(page,2),packet=sourcePacket();
 page.emit(SOURCE_PRESS_PREFIX+JSON.stringify(packet));packet.sourceWindow.first[0].value=true;
 const live=collector({sourceAttemptOrdinal:2});live.log.timeOrigin=456;
 const first=capture.snapshot(live.log);assert.equal(first.retainedPreReloadSourceWindow.sourceWindow.first[0].value,false);
 assert.equal(Object.isFrozen(first.retainedPreReloadSourceWindow.sourceWindow.first),true);assert.equal(first.retention.retainedTimeOrigin,123);assert.equal(first.retention.liveTimeOrigin,456);assert.equal(first.retention.epochsMerged,false);assert.equal(first.retention.incomplete,false);
 page.emit(SOURCE_PRESS_PREFIX+JSON.stringify(sourcePacket()));assert.equal(capture.snapshot(live.log).retention.lastFailure,'handoff-duplicate');
 const other=JSON.parse(JSON.stringify(sourcePacket()));other.timeOrigin=456;for(const row of [...other.sourceWindow.first,...other.sourceWindow.tail])row.timeOrigin=456;
 page.emit(SOURCE_PRESS_PREFIX+JSON.stringify(other));const after=capture.snapshot(live.log);
 assert.equal(after.retainedPreReloadSourceWindow,first.retainedPreReloadSourceWindow);assert.equal(after.retention.lastFailure,'handoff-epoch-conflict');assert.equal(after.retention.incomplete,true);
 capture.stop();capture.stop();assert.deepEqual([...page.listeners],[page.foreign]);
});
test('handoff parser rejects malformed, oversized, unknown, nonfinite and out-of-bound data',()=>{
 const valid=()=>JSON.parse(JSON.stringify(sourcePacket()));
 const wrongVersion=valid();wrongVersion.version=2;
 const secret=valid();secret.sourceWindow.first[0].rawState='secret-token';
 const nonfinite=valid();nonfinite.timeOrigin=null;
 const overflow=valid();overflow.sourceWindow.first=Array(65).fill(overflow.sourceWindow.first[0]);
 const wrongOrdinal=valid();wrongOrdinal.sourceWindow.expectedOrdinal=3;
 const epoch=valid();epoch.sourceWindow.first[0].timeOrigin=456;
 const invalid=['{',... [wrongVersion,secret,nonfinite,overflow,wrongOrdinal,epoch].map(value=>JSON.stringify(value)),'x'.repeat(SOURCE_PRESS_MAX_BYTES+1)];
 for(const body of invalid){const page=consolePage(),capture=createBoardSourceConsoleRetention(page,2);assert.doesNotThrow(()=>page.emit(SOURCE_PRESS_PREFIX+body));const snapshot=capture.snapshot(null);assert.equal(snapshot.retainedPreReloadSourceWindow,null);assert.equal(snapshot.retention.incomplete,true);assert.equal(JSON.stringify(snapshot).includes('secret-token'),false);capture.stop();}
 const accessor=sourcePacket();let reads=0;Object.defineProperty(accessor.sourceWindow,'observed',{get(){reads++;throw Error('secret');}});
 assert.throws(()=>cloneBoardSourceHandoff(accessor),/Invalid source-window/);assert.equal(reads,0);
});
test('actual serialized bootstrap retains old-window handoff and removes only its owned listener on failure',async()=>{
 const page=consolePage();let context,definition,attachment;
 const createDocument=epoch=>{const root={isConnected:true},events=new Map(),sandbox={TextEncoder,performance:{timeOrigin:epoch,now:()=>456},document:{querySelector:()=>root,addEventListener(){}},addEventListener:(type,fn)=>events.set(type,fn),console:{debug:text=>page.emit(text)}};vm.createContext(sandbox);return {sandbox,events,root};};
 context=createDocument(123);
 page.addInitScript=async value=>{definition=value;vm.runInContext(value.content,context.sandbox);};page.route=async()=>{};
 page.evaluate=async()=>context.sandbox.__boardAdmissionObservation;page.unroute=async()=>{throw Error('intentional-route-fault');};
 const info={title:'Horus finishes a real turn and releases its worker before self-play and reload',outputPath(){throw Error('intentional-write-fault');},async attach(name,value){attachment=JSON.parse(value.body);}};
 const capture=await installBoardAdmissionDiagnostics(page,info,{baseURL:'http://127.0.0.1:10193',targetRow:2,targetCol:6,sourceAttemptOrdinal:2});
 const first=sourceCell(context.root),second=sourceCell(context.root);context.sandbox.__boardAdmissionSourceRead(false,first);context.sandbox.__boardAdmissionSourceRead(false,second);
 context.events.get('pagehide')({isTrusted:true});context=createDocument(456);vm.runInContext(definition.content,context.sandbox);
 await assert.doesNotReject(capture.persist());
 assert.equal(attachment.retainedPreReloadSourceWindow.timeOrigin,123);assert.equal(attachment.observation.timeOrigin,456);assert.equal(attachment.retention.epochsMerged,false);assert.equal(attachment.retention.incomplete,false);
 assert.equal(attachment.observation.sourceWindow.observed,false);assert.equal(attachment.retainedPreReloadSourceWindow.sourceWindow.observed,true);
 assert.equal(attachment.incomplete,true); // Missing module/activation coverage is never waived.
 assert.deepEqual([...page.listeners],[page.foreign]);
 const badInfo={get title(){throw Error('secret-info');},outputPath(){throw Error('secret-path');},async attach(){throw Error('secret-attach');}};
 const secondCapture=await installBoardAdmissionDiagnostics(page,badInfo,{baseURL:'http://127.0.0.1:10193',targetRow:2,targetCol:6,sourceAttemptOrdinal:2});
 const priorError=console.error;
 try{console.error=()=>{throw Error('secret-console');};await assert.doesNotReject(secondCapture.persist());}
 finally{console.error=priorError;}
 assert.deepEqual([...page.listeners],[page.foreign]);
});

test('explicit checkpoint keeps immutable source epoch without relying on pagehide',async()=>{
 const page=consolePage();let document=collector({sourceAttemptOrdinal:2});armSource(document);
 page.addInitScript=async()=>{};page.route=async()=>{};page.unroute=async()=>{};
 let reads=0,attachment;page.evaluate=async()=>{reads++;return reads===1?document.sandbox.__boardAdmissionSourceSnapshot():document.log;};
 const info={title:'Horus finishes a real turn and releases its worker before self-play and reload',outputPath(){throw Error('intentional-write');},async attach(name,value){attachment=JSON.parse(value.body);}};
 const capture=await installBoardAdmissionDiagnostics(page,info,{baseURL:'http://127.0.0.1:10193',targetRow:2,targetCol:6,sourceAttemptOrdinal:2});
 await capture.checkpoint();assert.equal(reads,1);document=collector({sourceAttemptOrdinal:2});document.log.timeOrigin=456;
 await capture.persist();assert.equal(reads,2);assert.equal(attachment.retainedPreReloadSourceWindow.timeOrigin,123);assert.equal(attachment.observation.timeOrigin,456);assert.equal(attachment.retention.incomplete,false);assert.equal(attachment.retention.epochsMerged,false);assert.deepEqual([...page.listeners],[page.foreign]);
});
