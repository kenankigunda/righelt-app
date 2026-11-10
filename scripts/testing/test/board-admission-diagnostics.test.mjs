import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {recoveryBindingHarness} from './support/recovery-binding-harness.mjs';
import {installBoardAdmissionCollector,transformBoardAdmissionModule,installBoardAdmissionDiagnostics,cloneBoardSourceHandoff,createBoardSourceConsoleRetention,SOURCE_PRESS_PREFIX,SOURCE_PRESS_MAX_BYTES,COMPUTER_RECOVERY_CATEGORIES,createComputerRecoveryHandoff,createComputerRecoveryJSONRead,readComputerRecoverySnapshot,persistComputerRecoveryEvidence,runComputerRecoveryPersistence,COMPUTER_RECOVERY_FIXTURE_BUDGET_MS,COMPUTER_RECOVERY_CLEANUP_RESERVE_MS} from '../../../e2e/support/board-admission-diagnostics.mjs';

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
 const unchanged={"/board-adapters/engine-board-adapter.js":"37ae4d7c79eb76c04725868ffd98d53a3951eec9f9613851709688deb9e6a769","/shell/live-transport.js":"d42244e02a56343a5e191a3cec3d31d63bca12c0f846c50ae2d2c18ea2d446e4","/board/hosts/shell-host.js":"6f8f475dfe5108ead572c51375b3bafb85a94ee998ef91e2abd01f738cd575db","/shell/app.js":"2056d4f12757981eed7082fe4cf3dce51c20fd72df196f0599889d25a220b0b9"};
 for(const [key,expected] of Object.entries(unchanged)){assert.equal(createHash('sha256').update(JSON.stringify(recipes[key])).digest('hex'),expected);}
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
test('case source opt-in and sealed inline capture preserve the original two actions and assertions',async()=>{
 const current=await readFile(new URL('../../../e2e/workflows/recovery-freeze-regression.spec.mjs',import.meta.url),'utf8');
 // Original reviewed 0a959 fixture and independently reviewed 3b99 composition.
 // Keep the original golden: only invert the sealed test-owned observation block.
 const hash=text=>createHash('sha256').update(text).digest('hex');
 const originalSHA='165ec16bb620c0038a8059a2d513401a5a258069ea6ae397130bb58fb5844d30';
 const reviewedCurrentSHA='fcf3791e85b1a3243d451cf3993ba631fe152b88e8ac2b0b9a144ffe21ee8646';
 // Preserve the old composed-source golden by exactly inverting the seven
 // accepted Recovery fault-lifecycle/reconnect fixture changes, not actions.
 const reviewedFixtureBaseSHA='95388c539469a08b581a1058ef79298c978cdaf859e12c5d1b328dd97bd8ca3b';
 const recoveryFixtureUnion=[
  {
    "before": "import {observeReadinessEvaluation} from '../support/readiness-diagnostics.mjs';\nimport {createFaultLifecycle,disposeFaultContexts,fetchFaultResponse} from '../support/fault-lifecycle.mjs';\nimport {installBoardAdmissionDiagnostics} from '../support/board-admission-diagnostics.mjs';\nimport {waitForOpponentReady,waitForComputerDecision} from '../support/computer-projection.mjs';\n",
    "after": "import {observeReadinessEvaluation} from '../support/readiness-diagnostics.mjs';\nimport {installBoardAdmissionDiagnostics} from '../support/board-admission-diagnostics.mjs';\nimport {waitForOpponentReady,waitForComputerDecision} from '../support/computer-projection.mjs';\n"
  },
  {
    "before": " try {\n let socketsUnavailable=false,losePush=true;const commands=[], sockets=[],pushProofs=[];\n const faults=createFaultLifecycle();\n const faultResources={faults:new Map([[page,[faults]]]),contexts:new Set()};\n const actionFor=command=>(command.kind==='shared'?command.payload.values:command).payload?.action;\n let holdConfirmation=false,releaseConfirmation,confirmationRequested=false;\n",
    "after": " try {\n let socketsUnavailable=false,losePush=true;const commands=[], sockets=[],pushProofs=[];\n const actionFor=command=>(command.kind==='shared'?command.payload.values:command).payload?.action;\n let holdConfirmation=false,releaseConfirmation,confirmationRequested=false;\n"
  },
  {
    "before": " await page.getByRole(\"button\",{name:\"Play both sides\",exact:true}).click();\n await switchGamePanel(page,\"board\");\n await page.route(`**/api/shell/games/${gameId}/**`,route=>faults.run(async()=>{\n  const request=route.request();\n  if(isOperationRequest(request,'reconcile')){\n   const response=await fetchFaultResponse(route);\n   if(!response)return;\n   if(holdConfirmation){confirmationRequested=true;await confirmationGate;}\n   await route.fulfill({response});return;\n",
    "after": " await page.getByRole(\"button\",{name:\"Play both sides\",exact:true}).click();\n await switchGamePanel(page,\"board\");\n await page.route(`**/api/shell/games/${gameId}/**`,async route=>{\n  const request=route.request();\n  if(isOperationRequest(request,'reconcile')){\n   const response=await route.fetch();\n   if(holdConfirmation){confirmationRequested=true;await confirmationGate;}\n   await route.fulfill({response});return;\n"
  },
  {
    "before": "  const first=losePush;\n  if(first){holdConfirmation=true;socketsUnavailable=true;losePush=false;sockets.forEach(socket=>socket.close({code:1012,reason:\"Test deployment transition\"}));}\n  const response=await fetchFaultResponse(route);\n  if(!response)return;\n  const body=await response.json();\n  const accepted=body.commandOutcomes?.find(outcome=>outcome.clientCommandId===envelope.clientCommandId&&outcome.fingerprint===envelope.fingerprint&&outcome.outcome==='accepted');\n  expect(accepted,'The healthy HTTP server must retain the accepted original push receipt').toBeTruthy();\n",
    "after": "  const first=losePush;\n  if(first){holdConfirmation=true;socketsUnavailable=true;losePush=false;sockets.forEach(socket=>socket.close({code:1012,reason:\"Test deployment transition\"}));}\n  const response=await route.fetch(),body=await response.json();\n  const accepted=body.commandOutcomes?.find(outcome=>outcome.clientCommandId===envelope.clientCommandId&&outcome.fingerprint===envelope.fingerprint&&outcome.outcome==='accepted');\n  expect(accepted,'The healthy HTTP server must retain the accepted original push receipt').toBeTruthy();\n"
  },
  {
    "before": "  if(holdConfirmation)await confirmationGate;\n  await route.fulfill({response});proof.deliveredAt=Date.now();\n }));\n try {\n let game=await currentGame(page,gameId);const push=game.legalActions.find(a=>a.type===\"push\");expect(push).toBeTruthy();\n\n await submitPlayableAction(page,push);\n",
    "after": "  if(holdConfirmation)await confirmationGate;\n  await route.fulfill({response});proof.deliveredAt=Date.now();\n });\n let game=await currentGame(page,gameId);const push=game.legalActions.find(a=>a.type===\"push\");expect(push).toBeTruthy();\n try {\n\n await submitPlayableAction(page,push);\n"
  },
  {
    "before": "  holdConfirmation=false;releaseConfirmation();\n  // Drain intercepted requests before the browser fixture closes.\n  await disposeFaultContexts(faultResources,[page]);\n  await info.attach(\"held-push-confirmations\",{body:JSON.stringify(pushProofs,null,2),contentType:\"application/json\"});\n }\n",
    "after": "  holdConfirmation=false;releaseConfirmation();\n  // Drain intercepted requests before the browser fixture closes.\n  await page.unrouteAll({behavior:\"wait\"});\n  await info.attach(\"held-push-confirmations\",{body:JSON.stringify(pushProofs,null,2),contentType:\"application/json\"});\n }\n"
  },
  {
    "before": " await page.route(`**/api/shell/games/${gameId}/**`,async route=>{\n  if(!isOperationRequest(route.request(),'reconcile')){await route.continue();return;}\n  // Reconcile is a POST. This fixture only observes an empty command batch,\n  // so an ECONNRESET may repeat the same read once without replaying a command.\n  const requestBody=route.request().postDataJSON();\n  expect(route.request().method()).toBe('POST');\n  expect(requestBody.protocolVersion).toBe(2);expect(requestBody.commands).toEqual([]);\n  const response=await route.fetch({maxRetries:1});if(hold){held();await gate;}await route.fulfill({response});\n });\n try {\n",
    "after": " await page.route(`**/api/shell/games/${gameId}/**`,async route=>{\n  if(!isOperationRequest(route.request(),'reconcile')){await route.continue();return;}\n  const response=await route.fetch();if(hold){held();await gate;}await route.fulfill({response});\n });\n try {\n"
  },
  {
    "before": " await expect(message).toContainText(\"Select a retreat\");\n const acceptedRetreat=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/apply')&&actionFor(response.request().postDataJSON())?.type==='retreat');\n const automaticFollow=page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/apply')&&actionFor(request.postDataJSON())?.type==='follow');\n acceptedRetreat.catch(()=>{});automaticFollow.catch(()=>{});\n await submitPlayableAction(page,retreat);\n const retreatResponse=await acceptedRetreat,retreatBody=await retreatResponse.json(),retreatCommand=retreatResponse.request().postDataJSON();\n expect(retreatBody.commandOutcomes).toContainEqual(expect.objectContaining({clientCommandId:retreatCommand.clientCommandId,fingerprint:retreatCommand.fingerprint,outcome:'accepted'}));\n expect(retreatBody.game.board.state.continuation.phase).toBe('follow');\n // Read the immutable acknowledged decision: the sole mandatory continuation\n // may finish before a later live read. No second native activation is needed.\n expect(retreatBody.game.legalActions).toHaveLength(1);\n const follow=retreatBody.game.legalActions[0];expect(follow.type).toBe('follow');\n const followCommand=(await automaticFollow).postDataJSON();\n expect(actionFor(followCommand)).toEqual(follow);\n expect(followCommand.payload.computer).toBeUndefined();\n expect(followCommand.expectedState).toEqual(retreatBody.game.board.state);\n expect(followCommand.expectedGameplayRevision).toBe(retreatBody.game.gameplayRevision);\n await expect(page.locator('.board-wrap[data-reconnecting=\"true\"]')).toHaveCount(0,{timeout:10000});\n await expect.poll(async()=> (await currentGame(page,gameId)).moves.length).toBe(3);\n game=await currentGame(page,gameId);expect(game.board.state.continuation).toBeNull();\n expect(game.moves.map(move=>move.action)).toEqual([push,retreat,follow]);\n expect(game.moves[2].clientCommandId).toBe(followCommand.clientCommandId);\n expect(new Set(game.moves.map(m=>m.clientCommandId)).size).toBe(3);",
    "after": " await expect(message).toContainText(\"Select a retreat\");\n await submitPlayableAction(page,retreat);\n await expect.poll(async()=> (await currentGame(page,gameId)).board.state.continuation?.phase).toBe(\"follow\");\n await expect(page.locator('.board-wrap[data-reconnecting=\"true\"]')).toHaveCount(0,{timeout:10000});\n game=await currentGame(page,gameId);const follow=game.legalActions.find(a=>a.type===\"follow\");expect(follow).toBeTruthy();\n // The required continuation actor is already selected, even when a pushed\n // defender shares its square with the attacker and has no generic source class.\n await submitPlayableAction(page,follow);\n await expect.poll(async()=> (await currentGame(page,gameId)).moves.length).toBe(3);\n game=await currentGame(page,gameId);expect(game.board.state.continuation).toBeNull();\n expect(game.moves.map(move=>move.action)).toEqual([push,retreat,follow]);\n expect(new Set(game.moves.map(m=>m.clientCommandId)).size).toBe(3);"
  }
];
 const inlineSHA='8eb845f8799df703d46f19d983eb32a8e7e4bd29598d0a3d11321e618085abbe';
 const beginMarker='  { // Begin case-local expansion of the existing second submitPlayableAction.';
 const endMarker='  } // End case-local expansion.';
 const callbackImport="import {observeReadinessEvaluation} from '../support/readiness-diagnostics.mjs';\n";
 const checkpoint='  await admissionDiagnostics.checkpoint();\n';
 const sourceRead='try { globalThis.__boardAdmissionSourceRead?.(selected,el); } catch {}';
 const originalSecond="  await submitPlayableAction(page,self.legalActions.find(action=>action.type==='move'));";
 const helper=await readFile(new URL('../../../e2e/support/app.mjs',import.meta.url),'utf8');
 const predicateStart=helper.indexOf('  await expect.poll(() => observeReadinessEvaluation',helper.indexOf('export const submitPlayableAction'));
 const predicateEnd=helper.indexOf('  await target.click();',predicateStart);
 assert.ok(predicateStart>=0&&predicateEnd>predicateStart);
 const parentPredicate=helper.slice(predicateStart,predicateEnd);
 const normalize=(source,inversions=recoveryFixtureUnion)=>{
  for(const {before,after} of inversions){assert.equal(source.split(before).length-1,1,'exact reviewed Recovery fixture union');source=source.replace(before,after);}
  assert.equal(source.split(beginMarker).length-1,1,'one sealed inline action');
  assert.equal(source.split(endMarker).length-1,1,'one inline end');
  assert.equal(source.split(callbackImport).length-1,1,'existing readiness import');
  assert.equal(source.split(',sourceAttemptOrdinal:2').length-1,1,'source attempt two retained');
  assert.equal(source.split(checkpoint).length-1,1,'pre-reload checkpoint retained');
  assert.ok(source.includes('  const saved=await currentGame(page,self.id);\n'+checkpoint+'  await page.reload();'),'checkpoint stays before reload');
  const start=source.indexOf(beginMarker),end=source.indexOf(endMarker,start)+endMarker.length;
  const inline=source.slice(start,end);
  assert.equal(hash(inline),inlineSHA,'approved inline capture and original actions are immutable');
  assert.equal(inline.split(sourceRead).length-1,1,'existing source callback retained');
  assert.ok(inline.includes(parentPredicate),'same existing parent readiness predicate');
  const rawBody=source.slice(source.indexOf("test('Horus finishes a real turn"));
  assert.equal(rawBody.split('await submitPlayableAction(page,').length-1,1,'first action remains a helper call');
  const normalized=source.replace(inline,originalSecond).replace(callbackImport,'').replace(',sourceAttemptOrdinal:2','').replace(checkpoint,'');
  assert.equal(hash(normalized),originalSHA,'all original source outside the sealed observation remains exact');
  const body=normalized.slice(normalized.indexOf("test('Horus finishes a real turn"));
  assert.equal(body.split('await submitPlayableAction(page,').length-1,2,'exactly the original two actions after inversion');
  assert.equal(hash(source),reviewedFixtureBaseSHA,'all original source outside reviewed Recovery fixture union remains exact');
  return normalized;
 };
 assert.equal(hash(current),reviewedCurrentSHA,'honest composed-source identity, not a replacement for the old golden');
 normalize(current);
 assert.throws(()=>normalize(current,recoveryFixtureUnion.slice(0,-1)),/all original source/,'missing Playback fixture inversion must fail the original golden');
 assert.throws(()=>normalize(current,[...recoveryFixtureUnion.slice(0,-1),{before:recoveryFixtureUnion.at(-1).after,after:recoveryFixtureUnion.at(-1).before}]),/exact reviewed Recovery fixture union/,'reversed Playback fixture inversion must fail closed');
 const reload="  await page.reload();await expect(page.getByTestId('game-board')).toBeVisible();";
 assert.equal(current.split(reload).length-1,1);
 const beforeSaved='  const saved=await currentGame(page,self.id);';
 assert.equal(current.split(beforeSaved).length-1,1);
 assert.throws(()=>normalize(current.replace(beforeSaved,'  await page.mouse.click(1,1);\n'+beforeSaved)),/all original source/,'extra native action must fail');
 const originalAssertion='expect(reloaded.gameplayRevision).toBe(saved.gameplayRevision)';
 assert.equal(current.split(originalAssertion).length-1,1);
 assert.throws(()=>normalize(current.replace(originalAssertion,'expect(reloaded.gameplayRevision).toBe(saved.gameplayRevision+1)')),/all original source/,'changed original business assertion must fail');
 const inlineConfirm='  await target.click();\n'+endMarker;
 assert.equal(current.split(inlineConfirm).length-1,1);
 assert.throws(()=>normalize(current.replace(inlineConfirm,'  await target.click();\n  await target.click();\n'+endMarker)),/approved inline capture/,'extra inline action must fail');
 const inlineAssertion="expect(sourceAdmission.after.selected,'Existing source click must admit its source before any destination action').toBe(true)";
 assert.equal(current.split(inlineAssertion).length-1,1);
 assert.throws(()=>normalize(current.replace(inlineAssertion,inlineAssertion.replace('toBe(true)','toBe(false)'))),/approved inline capture/,'changed inline business assertion must fail');
 assert.throws(()=>normalize(current.replace(sourceRead,'')),/approved inline capture/,'lost parent source callback must fail');
 assert.throws(()=>normalize(current.replace(checkpoint,'')),/pre-reload checkpoint retained/,'lost checkpoint must fail');
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

// Case-local recovery observation never changes the original catch or default recipes.
test('closed computer recovery descriptors, retention and original catch semantics',async()=>{
 const recipe=JSON.parse(await readFile(new URL('../../../e2e/support/computer-session-recovery-transformation.json',import.meta.url),'utf8'))['/shell/computer-session.js'];
 const source=await readFile(new URL('../../../apps/web/shell/computer-session.js',import.meta.url),'utf8');
 transformBoardAdmissionModule(source,recipe);
 assert.throws(()=>transformBoardAdmissionModule(source+' ',recipe),/source hash/);
 assert.throws(()=>transformBoardAdmissionModule(source,{...recipe,outputSha256:'0'.repeat(64)}),/output hash/);
 const bad=structuredClone(recipe);bad.operations[0].start++;assert.throws(()=>transformBoardAdmissionModule(source,bad),/range/);
 const known=COMPUTER_RECOVERY_CATEGORIES.map(code=>({code}));let getters=0;
 const unsafe=[new Proxy({message:'stale_state'},{getOwnPropertyDescriptor(target,key){if(key==='code')throw Error('PRIVATE');return Object.getOwnPropertyDescriptor(target,key);}}),{code:'PRIVATE-ID'},Object.create({code:'stale_state'}),{get code(){getters++;return 'stale_state';}},new Proxy({},{getOwnPropertyDescriptor(){throw Error('PRIVATE');}}),42,null,{code:()=>{}},{message:'PRIVATE'}];
 for(const [error,wanted] of [...known.map(e=>[e,e.code]),...unsafe.map(e=>[e,null])]){
  const h=collector({recoveryCategories:COMPUTER_RECOVERY_CATEGORIES});h.sandbox.__boardAdmissionRecovery(error);
  const row=h.sandbox.__boardAdmissionObservation.firstComputerRecovery;assert.equal(row.observed,true);assert.equal(row.errorCategory,wanted);assert(!JSON.stringify(row).includes('PRIVATE'));
  h.sandbox.__boardAdmissionRecovery({code:'storage_reset'});assert.equal(row.errorCategory,wanted);
 }
 assert.equal(getters,0);
 const injected=collector({recoveryCategories:COMPUTER_RECOVERY_CATEGORIES});injected.sandbox.__boardAdmissionRecord('computer-session-recovery-error',{errorCategory:'PRIVATE',message:'PRIVATE',identityId:'PRIVATE'});assert(!JSON.stringify(injected.sandbox.__boardAdmissionObservation).includes('PRIVATE'));
 const op=recipe.operations[0];
 for(const sinkThrows of [false,true]){
  const original=Error('stale_state'),seen=[];const env={run:1,epoch:1,error:original,context:{key:'k'},recovery:null,publish:value=>seen.push(value),__boardAdmissionRecovery(){if(sinkThrows)throw Error('sink');}};env.globalThis=env;
  vm.runInNewContext(op.after,env);assert.equal(env.error,original);assert.equal(env.recovery,'k');assert.equal(seen.length,1);assert.equal(seen[0].message,original.message);
 }
});

const recoveryPage=()=>{
 const events=new EventEmitter(),frame={},context={};
 return{mainFrame:()=>frame,context:()=>context,on(type,fn){events.on(type,fn);},off(type,fn){assert.ok(events.listeners(type).includes(fn));events.off(type,fn);},navigate(){events.emit('framenavigated',frame);},emitConsole(text){events.emit('console',{text:()=>text,page:()=>this,worker:()=>null,type:()=> 'debug'});},listenerCount:type=>type?events.listenerCount(type):events.eventNames().reduce((n,k)=>n+events.listenerCount(k),0),async exposeBinding(){return{async dispose(){}};}};
};
const recoveryPacket=ticket=>({...ticket,documentNonce:'controlled-document',timeOrigin:123,observation:{version:1,documentNonce:'controlled-document',timeOrigin:123,recoveryNamespace:ticket.namespace,first:[],tail:[],activation:[],incomplete:false,firstComputerRecovery:null}});
test('final computer recovery handoff is immutable, page/game/document-bound and consumed once',()=>{
 const page=recoveryPage(),owner=createComputerRecoveryHandoff(page,'nonce');owner.bindGame('owned');const ticket=owner.begin(page),packet=recoveryPacket(ticket);owner.capture(page,packet);packet.observation.firstComputerRecovery={observed:true,errorCategory:'rules_timeout'};
 const value=owner.consume();assert.equal(value.incomplete,false);assert.equal(value.observation.firstComputerRecovery,null);assert(Object.isFrozen(value.observation));assert.throws(()=>{value.observation.timeOrigin=999;},TypeError);assert.equal(owner.consume().reason,'handoff-reused');
});
test('missing, failed, timed out, foreign or reused final delivery cannot mean no error',()=>{
 const make=()=>{const page=recoveryPage(),owner=createComputerRecoveryHandoff(page,'nonce');owner.bindGame('owned');return{page,owner,ticket:owner.begin(page)};};
 for(const reason of ['read-failed','read-timed-out','read-missing']){const{owner}=make();owner.failed(reason);assert.equal(owner.consume().reason,reason);}
 for(const change of [p=>p.namespace='foreign',p=>p.readId='foreign',p=>p.gameId='foreign',p=>p.observation.documentNonce='foreign-document',p=>p.observation.recoveryNamespace='foreign']){const{page,owner,ticket}=make(),packet=recoveryPacket(ticket);change(packet);owner.capture(page,packet);assert.equal(owner.consume().incomplete,true);}
 const absent=make();assert.equal(absent.owner.consume().reason,'handoff-missing');const foreign=make();foreign.owner.capture({},recoveryPacket(foreign.ticket));assert.equal(foreign.owner.consume().reason,'foreign-page');
 const reused=make();reused.owner.capture(reused.page,recoveryPacket(reused.ticket));reused.owner.capture(reused.page,recoveryPacket(reused.ticket));assert.equal(reused.owner.consume().reason,'handoff-reused');
});
test('handoff rejects callable/accessor/cyclic data without invoking it or adding browser work',()=>{
 for(const alter of [v=>{Object.defineProperty(v,'namespace',{get(){assert.fail('envelope accessor invoked');},enumerable:true});},v=>{v.observation.bad=()=>{};},v=>{Object.defineProperty(v.observation,'bad',{get(){assert.fail('accessor invoked');},enumerable:true});},v=>{v.observation.bad=v.observation;}]){
  const page=recoveryPage(),owner=createComputerRecoveryHandoff(page,'nonce');owner.bindGame('owned');const packet=recoveryPacket(owner.begin(page));alter(packet);owner.capture(page,packet);assert.equal(owner.consume().reason,'handoff-invalid');
 }
});
test('computer evidence persistence attempts independent sinks and owned route cleanup, preserving primary and secondary errors',async()=>{
 const primary=Error('original'),writeError=Error('write'),attachError=Error('attach'),routeError=Error('route'),calls=[];
 await assert.rejects(persistComputerRecoveryEvidence({handoff:{incomplete:false},payload:{},primaryError:primary,info:{outputPath:()=>'/owned/evidence',attach:async()=>{calls.push('attach');throw attachError;}},write:async()=>{calls.push('write');throw writeError;},removeRoute:async()=>{calls.push('route');throw routeError;}}),error=>{assert.deepEqual(error.errors,[primary,writeError,attachError,routeError]);return true;});assert.deepEqual(calls,['write','attach','route']);
});

async function finalReadFixture({computer=true,timeout=false,readFailure=false,deferred=false}={}){
 const files=[],attached=[],events=[],timers=[];let reads=0,unroutes=0,release,owner;
 const deferredRead=new Promise(resolve=>{release=resolve;});
 const h=recoveryBindingHarness({gameId:'owned',breakProducer:readFailure,onRead:()=>{reads++;events.push('browser-read');},beforeSignal:async()=>{if(timeout){queueMicrotask(()=>{owner.finalRecoveryHandoff.journalTimedOut();release();});}if(timeout||deferred)await deferredRead;}}),page=h.page;
 const addInit=page.addInitScript;
 page.addInitScript=async(fn,arg)=>{
  if(fn.name==='installBoardAdmissionCollector'){
   // This controlled leaf models the separate DOM collector environment; the
   // actual binding initializer, producer, codec and receiver execute intact.
   const realm=h.realm();realm.__boardAdmissionObservation.recoveryNamespace=arg.recoveryNamespace;realm.__boardAdmissionObservation.firstComputerRecovery=null;
   return{async dispose(){}};
  }
  return addInit(fn,arg);
 };
 page.route=async()=>{};page.unroute=async()=>{unroutes++;};
 page.evaluate=async(fn,arg)=>{const prior=reads;if(readFailure)throw Error('original read failed');const value=vm.runInContext('('+fn.toString()+')(argument)',Object.assign(h.realm(),{argument:arg}));if(reads===prior)reads++;return value;};
 const info={title:'the real computer defender leaves a completion-preserving native Follow',status:'passed',expectedStatus:'passed',outputPath:name=>'/owned/'+name,async attach(name,value){attached.push({name,...value});}};
 owner=await installBoardAdmissionDiagnostics(page,info,{baseURL:'http://owned',computerSessionRecovery:computer});owner.finalRecoveryHandoff?.bindGame('owned');
 const source=await readFile(new URL('../../../e2e/workflows/completion-preserving-retreat.spec.mjs',import.meta.url),'utf8');let afterEach;
 const start=source.indexOf('test.afterEach('),end=source.indexOf('\nasync function request(',start);
 vm.runInNewContext(source.slice(start,end),{test:{afterEach:fn=>{afterEach=fn;}},COMPUTER_UI_FRAME_MEASURE:'measure',computerFollowWorkflow:info.title,computerRetreatWorkflow:'other',createComputerRecoveryJSONRead,readComputerRecoverySnapshot,writeFile:async(file,body)=>{files.push({file,body});},attachNodeReadiness:x=>x,console:{warn(){}},setTimeout(fn,ms){timers.push(ms);if(timeout)queueMicrotask(()=>{fn();release();});return 1;},clearTimeout(){}});
 let hookError;try{await afterEach({page,computerRecoveryAdmission:computer?owner:undefined},info);}catch(error){hookError=error;}
 return{page,info,owner,hookError,files,attached,events,timers,release,reads:()=>reads,unroutes:()=>unroutes};
}
test('actual existing final afterEach read hands off recovery once; computer persist never performs duplicate read',async()=>{
 const f=await finalReadFixture();assert.equal(f.hookError,undefined);assert.equal(f.reads(),1);
 // Persist uses a controlled file sink; original implementation would add the
 // second page.evaluate seen in the primary CI trace. No browser timing claim.
 const originalWritePath=f.info.outputPath;const directory=await import('node:os').then(x=>x.tmpdir());const temp=await import('node:fs/promises').then(x=>x.mkdtemp(directory+'/recovery-handoff-'));f.info.outputPath=name=>temp+'/'+name;
 try{await f.owner.persist();assert.equal(f.reads(),1);assert.equal(f.unroutes(),1);const payload=JSON.parse(await readFile(temp+'/board-admission-observation.json','utf8'));assert.equal(payload.handoff.incomplete,false);assert.equal(payload.observation.firstComputerRecovery,null);}finally{f.info.outputPath=originalWritePath;await import('node:fs/promises').then(x=>x.rm(temp,{recursive:true,force:true}));}
});
test('owned binding timeout or failed final read produces incomplete Node persistence with no fallback browser read',async()=>{
 for(const settings of [{timeout:true},{readFailure:true}]){
  const f=await finalReadFixture(settings),directory=await import('node:os').then(x=>x.tmpdir()),temp=await import('node:fs/promises').then(x=>x.mkdtemp(directory+'/recovery-handoff-'));f.info.outputPath=name=>temp+'/'+name;
  try{assert.ok(f.hookError);await assert.rejects(f.owner.persist(),/Computer recovery evidence incomplete/);assert.equal(f.reads(),settings.timeout?0:1,'timeout before accepted ticket reads no state; producer failure reads once, neither falls back');assert.equal(f.unroutes(),1);const payload=JSON.parse(await readFile(temp+'/board-admission-observation.json','utf8'));assert.equal(payload.handoff.incomplete,true);assert.equal(payload.observation,null);if(settings.timeout)assert.deepEqual(f.timers,[]);}finally{await import('node:fs/promises').then(x=>x.rm(temp,{recursive:true,force:true}));}
 }
});
test('generic/default persistence retains its existing browser read and is not redirected to computer handoff',async()=>{
 let reads=0,unroutes=0;const temp=await import('node:fs/promises').then(async fs=>fs.mkdtemp((await import('node:os')).tmpdir()+'/board-default-'));
 const page={async addInitScript(){},async route(){},async evaluate(){reads++;return{activation:[],incomplete:false};},async unroute(){unroutes++;}},info={title:'generic',outputPath:name=>temp+'/'+name,async attach(){}};
 try{const diagnostic=await installBoardAdmissionDiagnostics(page,info,{baseURL:'http://owned'});assert.equal(diagnostic.finalRecoveryHandoff,null);await diagnostic.persist();assert.equal(reads,1);assert.equal(unroutes,1);}finally{await import('node:fs/promises').then(x=>x.rm(temp,{recursive:true,force:true}));}
});
test('controlled old duplicate-read premise uses two browser evaluations after the same existing final read',async()=>{
 const f=await finalReadFixture({computer:false}),temp=await import('node:fs/promises').then(async fs=>fs.mkdtemp((await import('node:os')).tmpdir()+'/board-old-read-'));f.info.outputPath=name=>temp+'/'+name;
 try{assert.equal(f.reads(),1);await f.owner.persist();assert.equal(f.reads(),2,'unchanged generic path demonstrates the old second terminal read');assert.throws(()=>assert.equal(f.reads(),1),assert.AssertionError,'old duplicate-read premise fails the single-read regression');}finally{await import('node:fs/promises').then(x=>x.rm(temp,{recursive:true,force:true}));}
});

test('same-Page document replacement invalidates delivered or pending handoff; late timeout delivery cannot repopulate it',()=>{
 for(const beforeCapture of [true,false]){const page=recoveryPage(),owner=createComputerRecoveryHandoff(page,'nonce');owner.bindGame('owned');const packet=recoveryPacket(owner.begin(page));if(!beforeCapture)owner.capture(page,packet);page.navigate();if(beforeCapture)owner.capture(page,packet);assert.equal(owner.consume().reason,'foreign-document');assert.equal(page.listenerCount(),0);}
 const page=recoveryPage(),owner=createComputerRecoveryHandoff(page,'nonce');owner.bindGame('owned');const packet=recoveryPacket(owner.begin(page));owner.failed('read-timed-out');owner.capture(page,packet);assert.equal(owner.consume().reason,'read-timed-out');assert.equal(page.listenerCount(),0);
});

test('computer setup failure releases only owned navigation listener and preserves original setup error',async()=>{
 const primary=Error('init failed'),page={...recoveryPage(),async addInitScript(){throw primary;}};
 await assert.rejects(installBoardAdmissionDiagnostics(page,{},{baseURL:'http://owned',computerSessionRecovery:true}),error=>error===primary);assert.equal(page.listenerCount(),0);
 const cleanup=Error('off failed'),broken={...recoveryPage(),off(){throw cleanup;},async addInitScript(){throw primary;}};
 await assert.rejects(installBoardAdmissionDiagnostics(broken,{},{baseURL:'http://owned',computerSessionRecovery:true}),error=>{
  const leaves=value=>value instanceof AggregateError?value.errors.flatMap(leaves):[value],all=leaves(error);
  assert.equal(all[0],primary,'original setup failure remains first through binding and listener cleanup');assert.ok(all.includes(cleanup),'actual cleanup failure remains retained');return true;
 });
});
test('actual installer awaits binding cleanup after later collector-init or route setup failure',async()=>{
 for(const stage of ['collector-init','route'])for(const cleanupFails of [false,true]){
  const primary=Error(stage+' failed'),cleanup=Error('publisher cleanup failed'),events=[];
  let releaseDisposal,disposalEntered;
  const gate=new Promise(resolve=>{releaseDisposal=resolve;}),entered=new Promise(resolve=>{disposalEntered=resolve;});
  const page={...recoveryPage(),
   async exposeBinding(){events.push('publisher-installed');return{async dispose(){events.push('publisher-dispose-enter');disposalEntered();await gate;events.push('publisher-dispose-return');if(cleanupFails)throw cleanup;}};},
   async addInitScript(fn){
    if(fn.name==='installBoardAdmissionCollector'){events.push('collector-init');if(stage==='collector-init')throw primary;return;}
    events.push('binding-init-installed');return{async dispose(){events.push('binding-init-disposed');}};
   },
   async route(){events.push('route-setup');throw primary;},
  };
  let completed=false;
  const work=installBoardAdmissionDiagnostics(page,{},{baseURL:'http://owned',computerSessionRecovery:true});
  work.then(()=>{completed=true;},()=>{completed=true;});
  try{
   assert.equal(await Promise.race([entered.then(()=>true),work.then(()=>false,()=>false)]),true,'later setup failure must enter actual binding disposal');
   assert.equal(completed,false,'original installer must await disposal rather than leave a detached cleanup task');
   assert.deepEqual(events.slice(0,3),['publisher-installed','binding-init-installed','collector-init']);
   assert.equal(events.includes('route-setup'),stage==='route');
  }finally{releaseDisposal();}
  await assert.rejects(work,error=>{
   if(!cleanupFails)return error===primary;
   const leaves=value=>value instanceof AggregateError?value.errors.flatMap(leaves):[value],all=leaves(error);
   assert.equal(all[0],primary);assert.ok(all.includes(cleanup));return true;
  });
  assert.ok(events.includes('publisher-dispose-return'));assert.ok(events.includes('binding-init-disposed'));
  assert.equal(page.listenerCount(),0,'both transport and original handoff listeners are removed');
 }
});

test('actual returned persist still saves, attaches and unroutes after binding disposal failure',async()=>{
 for(const sinkFailures of [false,true]){
  const fs=await import('node:fs/promises'),directory=await import('node:os').then(x=>x.tmpdir()),temp=await fs.mkdtemp(directory+'/binding-disposal-persist-');
  const bindingError=Error('publisher disposal failed'),attachError=Error('attachment failed'),routeError=Error('route cleanup failed'),events=[];let publisherDisposals=0;
  const page={...recoveryPage(),
   async exposeBinding(){return{async dispose(){publisherDisposals++;events.push('binding-dispose');throw bindingError;}};},
   async addInitScript(fn){if(fn.name==='installBoardAdmissionCollector')return;return{async dispose(){events.push('binding-init-dispose');}};},
   async route(){},async unroute(){events.push('unroute');if(sinkFailures)throw routeError;},
  };
  const info={title:'computer',outputPath:name=>{events.push('save');return temp+'/'+name;},async attach(){events.push('attach');if(sinkFailures)throw attachError;}};
  let diagnostic;
  try{
   diagnostic=await installBoardAdmissionDiagnostics(page,info,{baseURL:'http://owned',computerSessionRecovery:true});
   const owner=diagnostic.finalRecoveryHandoff;owner.bindGame('owned');owner.capture(page,recoveryPacket(owner.begin(page)));
   await assert.rejects(diagnostic.persist(),error=>{
    const leaves=value=>value instanceof AggregateError?value.errors.flatMap(leaves):[value],all=leaves(error);
    assert.ok(error instanceof AggregateError);assert.ok(all.includes(bindingError),'actual binding cleanup error is preserved at returned persist boundary');
    if(sinkFailures){assert.ok(all.includes(attachError));assert.ok(all.includes(routeError));}return true;
   });
   assert.deepEqual(events,['binding-dispose','binding-init-dispose','save','attach','unroute']);
   const saved=JSON.parse(await fs.readFile(temp+'/board-admission-observation.json','utf8'));
   assert.equal(saved.handoff.incomplete,true);assert.equal(saved.handoff.cleanupIncomplete,true);
   assert.equal(page.listenerCount(),0);assert.equal(publisherDisposals,1);
   await assert.rejects(owner.disposeBindingDelivery());assert.equal(publisherDisposals,1,'idempotent disposal must not repeat a failed public cleanup');
   owner.end();
  }finally{await fs.rm(temp,{recursive:true,force:true});}
 }
});

test('actual computer installer keeps empty activation coverage incomplete despite complete final delivery',async()=>{
 let init,handler;const page={...recoveryPage(),async addInitScript(fn,value){init=value;},async route(pattern,value){handler=value;},async unroute(){}};
 const temp=await import('node:fs/promises').then(async fs=>fs.mkdtemp((await import('node:os')).tmpdir()+'/computer-coverage-')),info={title:'computer',outputPath:name=>temp+'/'+name,async attach(){}};
 try{
  const diagnostic=await installBoardAdmissionDiagnostics(page,info,{baseURL:'http://owned',computerSessionRecovery:true});
  const modules=JSON.parse(await readFile(new URL('../../../e2e/support/computer-session-recovery-transformation.json',import.meta.url),'utf8'));
  for(const[pathname,recipe]of Object.entries(modules)){
   const source=await readFile(new URL('../../../'+recipe.file,import.meta.url),'utf8');
   await handler({request:()=>({url:()=> 'http://owned'+pathname}),fetch:async()=>({text:async()=>source}),fulfill:async()=>{},abort:async()=>assert.fail('actual module must transform')});
  }
  diagnostic.finalRecoveryHandoff.bindGame('owned');const ticket=diagnostic.finalRecoveryHandoff.begin(page);assert.equal(init.recoveryNamespace,ticket.namespace);diagnostic.finalRecoveryHandoff.capture(page,recoveryPacket(ticket));
  await diagnostic.persist();const payload=JSON.parse(await readFile(temp+'/board-admission-observation.json','utf8'));
  assert.deepEqual(payload.missingModules,[]);assert.deepEqual(payload.errors,[]);assert.equal(payload.observation.incomplete,false);assert.deepEqual(payload.observation.activation,[]);
  assert.equal(payload.handoff.incomplete,false,'final delivery is complete');assert.equal(payload.incomplete,true,'original generic activation coverage limitation is preserved');
 }finally{await import('node:fs/promises').then(fs=>fs.rm(temp,{recursive:true,force:true}));}
});
test('browser init creates an opaque readonly document nonce; exact nonce accepts clock jitter and rejects a different document with equal clocks',()=>{
 const document={addEventListener(){},querySelector(){return null;}},context={document,performance:{timeOrigin:1000},crypto:{randomUUID:()=> 'browser-owned-opaque-document'}};
 vm.createContext(context);vm.runInContext(`(${installBoardAdmissionCollector.toString()})({recoveryCategories:${JSON.stringify(COMPUTER_RECOVERY_CATEGORIES)},recoveryNamespace:'nonce'});`,context);
 const marker=Object.getOwnPropertyDescriptor(context,'__boardAdmissionRecoveryDocument');assert.equal(marker.value,'browser-owned-opaque-document');assert.equal(marker.writable,false);assert.equal(marker.configurable,false);assert.equal(context.__boardAdmissionObservation.documentNonce,marker.value);
 const page=recoveryPage(),owner=createComputerRecoveryHandoff(page,'nonce');owner.bindGame('owned');const ticket=owner.begin(page);
 const observation=structuredClone(context.__boardAdmissionObservation);owner.capture(page,{...ticket,documentNonce:marker.value,timeOrigin:1001,observation});const delivered=owner.consume();
 assert.equal(delivered.incomplete,false,'same document is accepted despite the demonstrated1ms clock difference');assert.equal(delivered.timeOrigin,1001);assert.equal(delivered.observationTimeOrigin,1000);assert.equal(delivered.observation.timeOrigin,1000);
 const foreignPage=recoveryPage(),foreign=createComputerRecoveryHandoff(foreignPage,'nonce');foreign.bindGame('owned');const otherTicket=foreign.begin(foreignPage);foreign.capture(foreignPage,{...otherTicket,documentNonce:'current-document',timeOrigin:1000,observation});assert.equal(foreign.consume().reason,'foreign-document','equal clocks cannot qualify a different document nonce');
});

test('controlled binding timeout rejects the late ticket without a producer or fallback read',async()=>{
 const f=await finalReadFixture({timeout:true,deferred:true}),fs=await import('node:fs/promises'),temp=await fs.mkdtemp((await import('node:os')).tmpdir()+'/computer-late-');f.info.outputPath=name=>temp+'/'+name;
 try{
  assert.equal(f.files.length,0,'no fallback journal is invented after rejected binding delivery');assert.deepEqual(f.timers,[]);
  f.release();await Promise.resolve();await Promise.resolve();
  assert.ok(f.hookError);await assert.rejects(f.owner.persist({remainingMs:()=>5000}),/Computer recovery evidence incomplete/);
  const value=JSON.parse(await readFile(temp+'/board-admission-observation.json','utf8'));
  assert.equal(value.handoff.incomplete,true);assert.equal(value.handoff.journalReadTimedOut,true);
  assert.equal(f.files.length,0);assert.equal(f.reads(),0,'the expired ticket is refused before the producer; releasing it cannot create later evidence');assert.equal(f.unroutes(),1);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});

const flushDelivery=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
function virtualRecoveryBudget({setupElapsedMs=1000,writeNever=false,listenerThrows=false}={}){
 let time=0,sequence=0,resolve,reject;const timers=new Map(),calls=[],page=recoveryPage();
 if(listenerThrows)page.off=()=>{throw Error('listener cleanup');};
 const handoff=createComputerRecoveryHandoff(page,'budget-namespace');handoff.bindGame('owned');const ticket=handoff.begin(page);
 const original=new Promise((yes,no)=>{resolve=yes;reject=no;});handoff.retain(page,original);
 let payload;
 const diagnostic={finalRecoveryHandoff:handoff,async persist(options){
  await handoff.awaitDelivery(options);const value=handoff.consume();payload={handoff:value};
  return persistComputerRecoveryEvidence({handoff:value,payload,info:{outputPath:()=>'/controlled',attach:async()=>{calls.push('attach');}},write:async()=>{calls.push('write');if(writeNever)await new Promise(()=>{});},removeRoute:async()=>{calls.push('route');}});
 }};
 const clock={now:()=>time,setTimer(fn,ms){const id=++sequence;timers.set(id,{at:time+ms,fn});return id;},clearTimer(id){timers.delete(id);}};
 let outcome={pending:true};const work=runComputerRecoveryPersistence(diagnostic,{setupElapsedMs,...clock});work.then(value=>{outcome={value};},error=>{outcome={error};});
 return {handoff,page,calls,ticket,resolve:()=>resolve({boardRecovery:recoveryPacket(ticket)}),reject,work,get outcome(){return outcome;},get payload(){return payload;},timers,async advance(ms){time+=ms;for(const[id,timer]of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}await flushDelivery();}};
}
test('shared fixture budget debits setup, excludes body, and reserves approved cleanup inside the original5s',async()=>{
 assert.equal(COMPUTER_RECOVERY_FIXTURE_BUDGET_MS,5000);assert.equal(COMPUTER_RECOVERY_CLEANUP_RESERVE_MS,750);
 const f=virtualRecoveryBudget();await flushDelivery();assert.deepEqual([...f.timers.values()].map(x=>x.at).sort((a,b)=>a-b),[3250,4000]);
 await f.advance(3249);f.resolve();await flushDelivery();await f.work;
 assert.equal(f.payload.handoff.incomplete,false);assert.deepEqual(f.calls,['write','attach','route']);assert.equal(f.page.listenerCount(),0);assert.equal(f.timers.size,0);
});
test('never-resolving original delivery explicitly expires before cleanup reserve and cannot be rescued late',async()=>{
 const f=virtualRecoveryBudget();await flushDelivery();await f.advance(3250);
 await assert.rejects(f.work,/Computer recovery evidence incomplete/);assert.equal(f.payload.handoff.reason,'read-budget-exhausted');assert.deepEqual(f.calls,['write','attach','route']);
 f.resolve();await flushDelivery();assert.equal(f.handoff.consume().reason,'handoff-reused');assert.equal(f.payload.handoff.incomplete,true);assert.equal(f.page.listenerCount(),0);assert.equal(f.timers.size,0);
});
test('hard shared remaining deadline fails hanging sink while independent route and listener cleanup have been attempted',async()=>{
 const f=virtualRecoveryBudget({writeNever:true});await flushDelivery();f.resolve();await flushDelivery();assert.deepEqual(f.calls,['write','attach','route']);
 await f.advance(4000);await assert.rejects(f.work,/fixture budget exhausted/);assert.equal(f.page.listenerCount(),0);assert.equal(f.timers.size,0);
});
test('actual original read rejection and same-Page navigation remain sticky across later delivery',async()=>{
 for(const kind of ['reject','navigate']){
  const f=virtualRecoveryBudget();await flushDelivery();if(kind==='reject')f.reject(Error('original response rejected'));else{f.page.navigate();f.resolve();}await flushDelivery();
  await assert.rejects(f.work,/Computer recovery evidence incomplete/);assert.equal(f.payload.handoff.reason,kind==='reject'?'read-failed':'foreign-document');assert.equal(f.page.listenerCount(),0);assert.deepEqual(f.calls,['write','attach','route']);
 }
});
test('fixture ownership end rejects late delivery and preserves listener cleanup failure',async()=>{
 const page=recoveryPage(),owner=createComputerRecoveryHandoff(page,'end');owner.bindGame('owned');const ticket=owner.begin(page);let finish;owner.retain(page,new Promise(resolve=>{finish=resolve;}));owner.end();finish({boardRecovery:recoveryPacket(ticket)});await flushDelivery();assert.equal(owner.consume().reason,'fixture-ended');assert.equal(page.listenerCount(),0);
 const f=virtualRecoveryBudget({listenerThrows:true});await flushDelivery();await f.advance(4000);await assert.rejects(f.work,error=>error instanceof AggregateError&&error.errors.some(e=>e.message.includes('fixture budget'))&&error.errors.some(e=>e.message.includes('listener cleanup')));
});
test('actual fixture source shares the one5s constant and debits setup before excluding the use body',async()=>{
 const source=await readFile(new URL('../../../e2e/workflows/completion-preserving-retreat.spec.mjs',import.meta.url),'utf8');
 assert(source.includes('const setupStarted=performance.now();'));assert(source.includes('const setupElapsedMs=performance.now()-setupStarted;'));
 assert(source.includes('try{await use(diagnostic);}finally{await runComputerRecoveryPersistence(diagnostic,{setupElapsedMs});}'));assert(source.includes('{timeout:COMPUTER_RECOVERY_FIXTURE_BUDGET_MS}'));
});

const timeoutCollector=()=>collector({recoveryNamespace:'rules-owned-document'},{crypto:{randomUUID:()=> 'opaque-rules-document'}});
function actualRulesScheduler(source,sink){
 const callbacks=new Map(),delays=[],workers=[];let id=0;
 const timers={setTimeout(fn,delay){callbacks.set(++id,fn);delays.push(delay);return id;},clearTimeout(key){callbacks.delete(key);}};
 const sandbox={SYNC_TIMING:{requestTimeoutMs:5000},__boardAdmissionRulesTimeout:sink};
 const start=source.indexOf('const cancelled ='),end=source.indexOf('export const createRulesExecutor =');assert(start>=0&&end>start);
 const body=source.slice(start,end);assert.equal(body.split('import.meta.url').length-1,1);
 // Bind the real module URL as an explicit VM metadata collaborator. The fake
 // workerFactory is passed below; scheduler/timeout/job code remains actual.
 const moduleURL=new URL('../../../apps/web/board/rules-runtime.js',import.meta.url).href;
 vm.runInNewContext(body.replace('import.meta.url',JSON.stringify(moduleURL)).replace('export class RulesRuntime','class RulesRuntime')+'\nglobalThis.ActualRulesRuntime=RulesRuntime;',sandbox);
 const runtime=new sandbox.ActualRulesRuntime({timers,workerFactory:()=>{const worker={sent:[],terminated:0,postMessage(value){this.sent.push(value);},terminate(){this.terminated++;}};workers.push(worker);return worker;}});
 return{runtime,callbacks,delays,workers};
}
async function rulesTimeoutRecipe(){
 const all=JSON.parse(await readFile(new URL('../../../e2e/support/computer-session-recovery-transformation.json',import.meta.url),'utf8'));
 return{all,recipe:all['/board/rules-runtime.js'],source:await readFile(new URL('../../../apps/web/board/rules-runtime.js',import.meta.url),'utf8')};
}
test('computer timeout recipe is strictly bound, exactly invertible and preserves the original computer catch entry',async()=>{
 const{all,recipe,source}=await rulesTimeoutRecipe();
 assert.equal(createHash('sha256').update(JSON.stringify(all['/shell/computer-session.js'])).digest('hex'),'dbac69c1672ae52cbb515f93d0bed3bdb2db889bc1c5824b9704a43955dc0022');
 assert.equal(recipe.operations.length,1);const op=recipe.operations[0];assert.equal(op.anchorCount,1);
 const output=transformBoardAdmissionModule(source,recipe);assert.equal(output.slice(op.start,op.start+op.after.length),op.after);
 assert.equal(output.slice(0,op.start)+op.before+output.slice(op.start+op.after.length),source);
 assert.throws(()=>transformBoardAdmissionModule(source+' ',recipe),/source hash/);assert.throws(()=>transformBoardAdmissionModule(source,{...recipe,outputSha256:'0'.repeat(64)}),/output hash/);
 assert.throws(()=>transformBoardAdmissionModule(source,{...recipe,operations:[{...op,start:op.start+1}]}),/range/);assert.throws(()=>transformBoardAdmissionModule(source,{...recipe,operations:[{...op,anchorCount:2}]}),/anchor count/);
});
test('actual transformed scheduler observes only running timeout while preserving original errors, payloads and queued drain',async()=>{
 const{recipe,source}=await rulesTimeoutRecipe(),transformed=transformBoardAdmissionModule(source,recipe),effects=[];
 for(const mode of ['original','absent','record','throw']){
  const h=timeoutCollector(),sink=mode==='record'?h.sandbox.__boardAdmissionRulesTimeout:mode==='throw'?()=>{throw Error('sink');}:undefined;
  const f=actualRulesScheduler(mode==='original'?source:transformed,sink),aInput={private:'PRIVATE-A'},bInput={private:'PRIVATE-B'};
  const a=f.runtime.project('admit:PRIVATE-game',aInput),b=f.runtime.project('project:PRIVATE-game',bInput);a.catch(()=>{});b.catch(()=>{});
  assert.equal(f.workers.length,1);assert.equal(f.callbacks.size,1);assert.equal(f.workers[0].sent[0].input,aInput);
  [...f.callbacks.values()][0]();await assert.rejects(a,error=>error.code==='rules_timeout'&&error.message==='Rules calculation timed out');
  assert.equal(f.workers.length,2);const message=f.workers[1].sent[0],value={ok:true};assert.equal(message.input,bInput);assert.equal(message.scope,'project:PRIVATE-game');
  f.workers[1].onmessage({data:{id:message.id,scope:message.scope,type:message.type,result:value}});assert.equal(await b,value);
  effects.push({workers:f.workers.length,terminations:f.workers.map(w=>w.terminated),delays:f.delays,jobs:f.runtime.jobs.size,running:f.runtime.running});
  if(mode==='record'){
   const rows=JSON.parse(JSON.stringify(h.log.rulesTimeouts.rows));assert.deepEqual(rows,[{sequence:1,jobId:1,type:'project',scopeKind:'admit',active:true,now:456}]);
   assert.equal(JSON.stringify(h.log.rulesTimeouts).includes('PRIVATE'),false);assert.equal(h.log.first.length,0);assert.equal(h.log.incomplete,false);
  }else assert.equal(h.log.rulesTimeouts.rows.length,0);
 }
 for(const effect of effects)assert.deepEqual(effect,effects[0]);
});
test('actual cancelled stale timeout is marked inactive and cannot fail the newer running job',async()=>{
 const{recipe,source}=await rulesTimeoutRecipe(),h=timeoutCollector(),f=actualRulesScheduler(transformBoardAdmissionModule(source,recipe),h.sandbox.__boardAdmissionRulesTimeout);
 const a=f.runtime.project('admit:PRIVATE-old',{});a.catch(()=>{});const stale=[...f.callbacks.values()][0];f.runtime.cancel('admit:PRIVATE-old');await assert.rejects(a,e=>e.code==='rules_cancelled');
 const b=f.runtime.project('project:PRIVATE-current',{});stale();assert.equal(f.workers[1].terminated,0);assert.equal(h.log.rulesTimeouts.rows[0].active,false);
 const m=f.workers[1].sent[0];f.workers[1].onmessage({data:{id:m.id,scope:m.scope,type:m.type,result:'same'}});assert.equal(await b,'same');
});
test('timeout scalar buffer is computer-only, caps64 with accurate drops and does not invoke getters or alter old buffers',()=>{
 assert.equal(collector().sandbox.__boardAdmissionRulesTimeout,undefined);const h=timeoutCollector(),valid={jobId:1,type:'project',scopeKind:'admit',active:true};let getters=0;
 for(let i=0;i<64;i++)h.sandbox.__boardAdmissionRulesTimeout({...valid,jobId:i+1});assert.equal(h.log.rulesTimeouts.rows.length,64);assert.equal(h.log.rulesTimeouts.dropped,0);
 h.sandbox.__boardAdmissionRulesTimeout(valid);assert.equal(h.log.rulesTimeouts.dropped,1);assert.equal(h.log.rulesTimeouts.incomplete,true);
 const fresh=timeoutCollector();for(const value of [{...valid,jobId:0},{...valid,type:'PRIVATE'},{...valid,scopeKind:'PRIVATE'},{...valid,active:1},{...valid,payload:'PRIVATE'},{...valid,get jobId(){getters++;return 1;}}])fresh.sandbox.__boardAdmissionRulesTimeout(value);
 assert.equal(getters,0);assert.equal(fresh.log.rulesTimeouts.dropped,6);assert.equal(fresh.log.rulesTimeouts.rows.length,0);assert.equal(JSON.stringify(fresh.log).includes('PRIVATE'),false);
 assert.equal(fresh.log.first.length,0);assert.equal(fresh.log.incomplete,false);fresh.record('original',{});assert.equal(fresh.log.first[0].sequence,1);
});
test('same existing immutable handoff carries bounded timeout rows without an additional reader',()=>{
 const h=timeoutCollector();h.sandbox.__boardAdmissionRulesTimeout({jobId:1,type:'project',scopeKind:'admit',active:true});const page=recoveryPage(),owner=createComputerRecoveryHandoff(page,'rules-owned-document');owner.bindGame('owned');const ticket=owner.begin(page),packet=recoveryPacket(ticket);
 packet.documentNonce=h.log.documentNonce;packet.observation=JSON.parse(JSON.stringify(h.log));owner.capture(page,packet);const value=owner.consume();assert.equal(value.incomplete,false);assert.equal(value.observation.rulesTimeouts.rows.length,1);assert(Object.isFrozen(value.observation.rulesTimeouts.rows[0]));assert.equal(page.listenerCount(),0);
});


test('actual computer installer reports timeout-buffer loss with otherwise complete activation and delivery',async()=>{
 let init,handler;const page={...recoveryPage(),async addInitScript(fn,value){init=value;},async route(pattern,value){handler=value;},async unroute(){}};
 const fs=await import('node:fs/promises'),temp=await fs.mkdtemp((await import('node:os')).tmpdir()+'/computer-timeout-coverage-'),info={title:'computer',outputPath:name=>temp+'/'+name,async attach(){}};
 try{
  const diagnostic=await installBoardAdmissionDiagnostics(page,info,{baseURL:'http://owned',computerSessionRecovery:true});
  const modules=JSON.parse(await readFile(new URL('../../../e2e/support/computer-session-recovery-transformation.json',import.meta.url),'utf8'));
  for(const[pathname,recipe]of Object.entries(modules)){
   const source=await readFile(new URL('../../../'+recipe.file,import.meta.url),'utf8');
   await handler({request:()=>({url:()=> 'http://owned'+pathname}),fetch:async()=>({text:async()=>source}),fulfill:async()=>{},abort:async()=>assert.fail('actual module must transform')});
  }
  const h=collector({recoveryNamespace:init.recoveryNamespace},{crypto:{randomUUID:()=> 'actual-timeout-coverage-document'}});
  const cell={dataset:{row:'3',col:'0'},isConnected:true,closest:selector=>selector==='.cell'?cell:h.root};
  const down={type:'pointerdown',isTrusted:true,pointerId:7,target:cell,currentTarget:h.sandbox.document,composedPath:()=>[cell,h.root,h.sandbox.document]};
  h.listeners.get('pointerdown:capture')(down);h.listeners.get('pointerdown:bubble')(down);
  assert.ok(h.log.activation.length>0);assert.equal(h.log.incomplete,false);
  for(let i=0;i<65;i++)h.sandbox.__boardAdmissionRulesTimeout({jobId:i+1,type:'project',scopeKind:'admit',active:true});
  assert.equal(h.log.rulesTimeouts.rows.length,64);assert.equal(h.log.rulesTimeouts.dropped,1);assert.equal(h.log.rulesTimeouts.incomplete,true);assert.equal(h.log.incomplete,false,'old generic log semantics are unchanged');
  diagnostic.finalRecoveryHandoff.bindGame('owned');const ticket=diagnostic.finalRecoveryHandoff.begin(page),packet=recoveryPacket(ticket);
  packet.documentNonce=h.log.documentNonce;packet.observation=JSON.parse(JSON.stringify(h.log));diagnostic.finalRecoveryHandoff.capture(page,packet);
  await diagnostic.persist();const payload=JSON.parse(await readFile(temp+'/board-admission-observation.json','utf8'));
  assert.deepEqual(payload.missingModules,[]);assert.deepEqual(payload.errors,[]);assert.equal(payload.handoff.incomplete,false);assert.equal(payload.observation.incomplete,false);assert.ok(payload.observation.activation.length>0);
  assert.equal(payload.incomplete,true,'separate timeout-buffer loss cannot be hidden by otherwise complete coverage');
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
