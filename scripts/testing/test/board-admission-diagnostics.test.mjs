import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {installBoardAdmissionCollector,transformBoardAdmissionModule} from '../../../e2e/support/board-admission-diagnostics.mjs';

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

const collector=()=>{
 const listeners=new Map(),root={isConnected:true};const sandbox={performance:{timeOrigin:123,now:()=>456},document:{querySelector:()=>root,addEventListener:(type,listener,options)=>listeners.set(type+':'+(options.capture?'capture':'bubble'),listener)}};
 vm.createContext(sandbox);vm.runInContext('('+installBoardAdmissionCollector.toString()+')({targetRow:3,targetCol:0})',sandbox);
 return {sandbox,listeners,root,log:sandbox.__boardAdmissionObservation,record:sandbox.__boardAdmissionRecord};
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


// Closed observation categories are an external diagnostic/privacy contract, not runtime policy.
const approvedErrorNames=['Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','EvalError','AggregateError'];
const approvedErrorCategories=['rules_cancelled','invalid_rules_response','rules_worker_failed','rules_timeout','session_changed','stale_state','journal_timeout','sync_recovering','storage_reset','storage_generation_unverified','invalid_saved_command','cleanup_unverified','untracked_saved_command','invalid_cleanup_receipt'];
test('runtime error fields accept only closed local categories and never arbitrary strings or extra payload',()=>{
 const {record,log}=collector();
 for(const name of approvedErrorNames)record('runtime-host-error',{errorName:name,errorCode:'stale_state',errorMessage:'journal_timeout'});
 for(const code of approvedErrorCategories)record('runtime-host-error',{errorName:'Error',errorCode:code,errorMessage:code});
 for(const [index,name] of approvedErrorNames.entries())assert.equal(log.first[index].errorName,name);
 for(const [index,code] of approvedErrorCategories.entries()){const row=log.first[approvedErrorNames.length+index];assert.equal(row.errorCode,code);assert.equal(row.errorMessage,code);}
 const privateText='person@example.invalid game-private-secret';
 for(const value of [privateText,'rules_cancelled-extra','x'.repeat(64),'x'.repeat(4096),{},3,false,undefined]){
  record('runtime-host-error',{errorName:value,errorCode:value,errorMessage:value,value:privateText,gameId:privateText,rawState:privateText});
  const row=log.first.at(-1);assert.equal(row.errorName,null);assert.equal(row.errorCode,null);assert.equal(row.errorMessage,null);
  assert.equal('value' in row,false);assert.equal('gameId' in row,false);assert.equal('rawState' in row,false);
 }
 assert.equal(JSON.stringify(log).includes(privateText),false);
});
test('runtime error collector reads only own data descriptors and tolerates throwing proxies',()=>{
 const {record,log}=collector();let getterReads=0,traps=0;
 const data={};for(const key of ['errorName','errorCode','errorMessage','rawState'])Object.defineProperty(data,key,{enumerable:true,get(){getterReads++;throw new Error('private getter');}});
 record('runtime-host-error',data);assert.equal(getterReads,0);
 record('runtime-host-error',Object.create({errorName:'Error',errorCode:'stale_state',errorMessage:'stale_state'}));
 record('runtime-host-error',new Proxy({},{getOwnPropertyDescriptor(){traps++;throw new Error('private trap');}}));assert.equal(traps,3);
 for(const row of log.first){assert.equal(row.errorName,null);assert.equal(row.errorCode,null);assert.equal(row.errorMessage,null);}
 assert.equal(log.incomplete,false);
});
test('actual transformed host catch preserves original object, getter counts and finally with unsafe errors',async()=>{
 const recipe=recipes['/board/runtime/board-runtime.js'];
 const source=await readFile(new URL('../../../'+recipe.file,import.meta.url),'utf8');
 const transformed=transformBoardAdmissionModule(source,recipe);
 const segment=text=>{const start=text.indexOf('    } catch (error) {',text.indexOf('const body = await host.applyAction'));const end=text.indexOf('\n  };',start);assert.ok(start>=0&&end>start);return text.slice(start,end);};
 const original=segment(source),observed=segment(transformed),operation=recipe.operations.find(op=>op.after.includes('runtime-host-error'));
 assert.equal(observed.replace(operation.after,''),original);
 const run=(body,make,sinkThrows=false)=>{
  const reads={message:0,name:0,code:0,traps:0};const sentinel={};const error=make(reads,sentinel),effects=[],rows=[];
  const previous=globalThis.__boardAdmissionRecord;globalThis.__boardAdmissionRecord=(event,data)=>{rows.push({event,data});if(sinkThrows)throw new Error('private sink');};
  let propagated;
  try{new Function('failure','setResult','setSubmitting','renderStatus','destroyed','revision','snapshotRevision',recipe.prefix+'try { throw failure;\n'+body)(error,value=>effects.push(['result',value]),value=>effects.push(['submitting',value]),()=>effects.push(['render']),false,1,1);}
  catch(value){propagated=value;}
  finally{if(previous===undefined)delete globalThis.__boardAdmissionRecord;else globalThis.__boardAdmissionRecord=previous;}
  return{error,effects,rows,reads,propagated,sentinel};
 };
 const cases=[
  ()=>Object.assign(new Error('rules_cancelled'),{name:'TypeError',code:'rules_cancelled'}),
  ()=>new TypeError('private person@example.invalid'),
  reads=>{const error=new Error();for(const key of ['message','name','code'])Object.defineProperty(error,key,{get(){reads[key]++;return key==='message'?'stale_state':'private getter';},configurable:true});return error;},
  ()=>42,
  ()=>Object.create({name:'Error',message:'stale_state',code:'stale_state'}),
  reads=>new Proxy(new Error('stale_state'),{getOwnPropertyDescriptor(){reads.traps++;throw new Error('private trap');}}),
  (reads,sentinel)=>{const error=new Error();Object.defineProperty(error,'message',{get(){reads.message++;throw sentinel;}});return error;},
 ];
 for(const make of cases){
  const baseline=run(original,make),actual=run(observed,make),throwingSink=run(observed,make,true);
  assert.deepEqual(actual.effects,baseline.effects);assert.deepEqual(throwingSink.effects,baseline.effects);
  for(const key of ['message','name','code'])assert.equal(actual.reads[key],baseline.reads[key]);
  assert.equal(actual.rows.length,1);assert.equal(actual.rows[0].event,'runtime-host-error');
  if(baseline.propagated){assert.equal(baseline.propagated,baseline.sentinel);assert.equal(actual.propagated,actual.sentinel);assert.equal(throwingSink.propagated,throwingSink.sentinel);}else{assert.equal(actual.propagated,undefined);assert.equal(throwingSink.propagated,undefined);}
  assert.deepEqual(actual.effects.slice(-2),[['submitting',false],['render']]);
  assert.equal(JSON.stringify(actual.rows).includes('private'),false);
 }
 const data=run(observed,cases[0]);assert.deepEqual(data.rows[0].data,{errorName:'TypeError',errorCode:'rules_cancelled',errorMessage:'rules_cancelled'});
 const primitive=run(observed,cases[3]);assert.deepEqual(primitive.rows[0].data,{errorName:null,errorCode:null,errorMessage:null});
 const proxy=run(observed,cases[5]);assert.equal(proxy.reads.traps,3);assert.deepEqual(proxy.rows[0].data,{errorName:null,errorCode:null,errorMessage:null});
 const timeout=run(observed,()=>Object.assign(new Error('Rules calculation timed out'),{code:'rules_timeout'}));assert.deepEqual(timeout.rows[0].data,{errorName:null,errorCode:'rules_timeout',errorMessage:'rules_timeout'});
 for(const code of approvedErrorCategories){const row=run(observed,()=>Object.assign(new Error(code),{code})).rows[0].data;assert.equal(row.errorCode,code);assert.equal(row.errorMessage,code);}
});
test('error categories remain source-derived and changed output remains hash protected',async()=>{
 const sources=await Promise.all(['apps/web/board/rules-runtime.js','apps/web/shell/live-transport.js','apps/web/shell/command-journal.js'].map(file=>readFile(new URL('../../../'+file,import.meta.url),'utf8')));
 for(const category of approvedErrorCategories)assert.ok(sources.some(source=>source.includes("'"+category+"'")||source.includes('"'+category+'"')),category);
 const recipe=recipes['/board/runtime/board-runtime.js'],source=await readFile(new URL('../../../'+recipe.file,import.meta.url),'utf8');
 const altered={...recipe,operations:recipe.operations.map(op=>op.after.includes('runtime-host-error')?{...op,after:op.after+' '}:op)};
 assert.throws(()=>transformBoardAdmissionModule(source,altered),/output hash mismatch/);
 const wrongOutput={...recipe,outputSha256:'0'.repeat(64)};assert.throws(()=>transformBoardAdmissionModule(source,wrongOutput),/output hash mismatch/);
 assert.equal(recipe.operations.filter(op=>op.after.includes('runtime-host-error')).length,1);assert.equal(recipe.operations.length,23);
 const unchanged={"/board-adapters/engine-board-adapter.js":"37ae4d7c79eb76c04725868ffd98d53a3951eec9f9613851709688deb9e6a769","/shell/live-transport.js":"bb99f37831cf1acd3e0a3c6b43016a49ef8d3c40863e472ca9cf57d92d5255a1","/board/hosts/shell-host.js":"6f8f475dfe5108ead572c51375b3bafb85a94ee998ef91e2abd01f738cd575db","/shell/app.js":"f82bab11aeca8158dbbce13d81a591f9d567212f0c0c08fc459bc1d52d8f3781"};
 for(const [key,expected] of Object.entries(unchanged)){assert.equal(createHash('sha256').update(JSON.stringify(recipes[key])).digest('hex'),expected);}
});
