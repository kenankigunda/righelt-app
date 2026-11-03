import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
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
 const expression=op.after.match(/if \((.*)\) throw/)[1];
 const run=(positionOnly,computer)=>{
  const reads=[];const current={positionOnly,get gameplayMutationsBlocked(){reads.push('human');return false;},get sharedMutationsBlocked(){reads.push('computer');return false;}};
  new Function('current','command',recipe.prefix+'return Boolean('+expression+');')(current,{computer});return reads;
 };
 assert.deepEqual(run(true,false),[]);assert.deepEqual(run(false,false),['human']);assert.deepEqual(run(false,true),['computer']);
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
