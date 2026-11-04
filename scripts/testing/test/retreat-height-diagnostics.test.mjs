import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {transformRetreatHeightModule,installRetreatHeightCollector,installRetreatHeightDiagnostics,finishRetreatHeightDiagnostics,retreatHeightFixture} from '../../../e2e/support/retreat-height-diagnostics.mjs';

const recipes=JSON.parse(await readFile(new URL('../../../e2e/support/retreat-height-transformations.json',import.meta.url),'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const operation=(module,needle)=>recipes[module].operations.find(row=>row.before.includes(needle));
const evaluate=(recipe,code,context={})=>vm.runInNewContext(recipe.prefix+code,{...context,__retreatHeightRecord(){throw Error('sink failed');}});
for(const [pathname,recipe] of Object.entries(recipes))test(`actual module transforms exactly: ${pathname}`,async()=>{
 const source=await readFile(new URL('../../../'+recipe.file,import.meta.url),'utf8');
 assert.equal(hash(source),recipe.sourceSha256);
 const output=transformRetreatHeightModule(source,recipe);
 assert.equal(hash(output),recipe.outputSha256);
 assert.equal(recipe.operations.length,pathname.includes('adapter')?2:pathname.includes('runtime')?5:8);
});

test('source, range, anchor and output mismatches fail closed',async()=>{
 const recipe=recipes['/board/message-height.js'],source=await readFile(new URL('../../../'+recipe.file,import.meta.url),'utf8');
 assert.throws(()=>transformRetreatHeightModule(source+' ',recipe),/hash mismatch/);
 for(const mutate of [copy=>copy.operations[0].start++,copy=>copy.operations[0].anchorCount++,copy=>copy.outputSha256='invalid']){
  const copy=structuredClone(recipe);mutate(copy);assert.throws(()=>transformRetreatHeightModule(source,copy));
 }
});

test('adapter evaluates the original coordinate reader and callback once, preserving reference',()=>{
 const recipe=recipes['/board-adapters/engine-board-adapter.js'],op=operation('/board-adapters/engine-board-adapter.js','onCellHoverStart(');
 for(const code of [op.before,op.after]){
  let reads=0,calls=0;const coord={row:3,col:2};let received;
  evaluate(recipe,code,{currentCell:{},readCoordFromCell(){reads++;return coord;},onCellHoverStart(value){calls++;received=value;}});
  assert.equal(reads,1);assert.equal(calls,1);assert.equal(received,coord);
 }
});

test('coordinate-reader exceptions retain their exact original identity',()=>{
 const recipe=recipes['/board-adapters/engine-board-adapter.js'],op=operation('/board-adapters/engine-board-adapter.js','onCellHoverStart('),primary=Error('original reader');
 for(const code of [op.before,op.after])assert.throws(()=>evaluate(recipe,code,{currentCell:{},readCoordFromCell(){throw primary;},onCellHoverStart(){assert.fail('callback must be skipped');}}),error=>error===primary);
});

test('actual target assignment spreads each getter once without cloning the resulting target again',()=>{
 const recipe=recipes['/board/runtime/board-runtime.js'],op=operation('/board/runtime/board-runtime.js','const setSelectedTarget');
 for(const code of [op.before,op.after]){
  let rowReads=0,colReads=0;const target={get row(){rowReads++;return 3;},get col(){colReads++;return 2;}};
  const result=evaluate(recipe,`let selectedTarget,selectedTargetOrigin;${code};setSelectedTarget(target,'hover');({target:selectedTarget,origin:selectedTargetOrigin});`,{target});
  assert.equal(rowReads,1);assert.equal(colReads,1);assert.equal(result.target.row,3);assert.equal(result.target.col,2);assert.equal(result.origin,'hover');
 }
});

test('actual explanation guard retains a skipped target read and positive branch behavior',()=>{
 const recipe=recipes['/board/runtime/board-runtime.js'],op=operation('/board/runtime/board-runtime.js','if (explanation');
 for(const explanation of [false,true])for(const code of [op.before,op.after]){
  let reads=0;const context={explanation,hits:0,__retreatHeightRecord(){throw Error('sink');}};
  Object.defineProperty(context,'selectedTarget',{get(){reads++;return null;}});
  vm.runInNewContext(recipe.prefix+code+'hits++;}',context);
  assert.equal(reads,explanation?1:0);assert.equal(context.hits,explanation?1:0);
 }
});

test('confirmation type getter and original action-label arguments remain unchanged',()=>{
 const recipe=recipes['/board/runtime/board-runtime.js'],op=operation('/board/runtime/board-runtime.js','setBoardPreviewAction(');
 for(const code of [op.before,op.after]){
  let reads=0;const state={},target={row:3,col:2};let args,result;
  evaluate(recipe,code,{preferredPreview:{get type(){reads++;return 'retreat';}},state,selectedTarget:target,actionPreviewLabel(...values){args=values;return 'original label';},setBoardPreviewAction(value){result=value;}});
  assert.equal(reads,1);assert.equal(args[1],state);assert.equal(args[2],target);assert.equal(result,'original label');
 }
});

test('existing width and height geometry getters run once with no diagnostic reread',()=>{
 const recipe=recipes['/board/message-height.js'];
 for(const needle of ['const width=','const from='])for(const code of [operation('/board/message-height.js',needle).before,operation('/board/message-height.js',needle).after]){
  let calls=0,reads=0;const prop=needle.includes('width')?'width':'height';
  const result=evaluate(recipe,code+`;${prop==='width'?'width':'from'};`,{slot:{getBoundingClientRect(){calls++;return Object.defineProperty({},prop,{get(){reads++;return 41;}});}}});
  assert.equal(calls,1);assert.equal(reads,1);assert.equal(result,41);
 }
});

test('height target preserves original replica and live measurements, including thrown errors',()=>{
 const recipe=recipes['/board/message-height.js'],op=operation('/board/message-height.js','const naturalTarget='),primary=Error('original geometry');
 for(const code of [op.before,op.after]){
  let floors=0,liveReads=0;const context={slot:{},floor(){floors++;return 10;},live:{getBoundingClientRect(){liveReads++;return {height:20};}},messageHeightTarget(value){return Math.max(value.primaryRoutine,value.fallbackRoutine,value.current);},outerPadding:4};
  assert.equal(evaluate(recipe,code+';naturalTarget;',context),24);assert.equal(floors,2);assert.equal(liveReads,1);
  assert.throws(()=>evaluate(recipe,code,{...context,floor(){throw primary;}}),error=>error===primary);
 }
});

test('height input preserves the original media query getter and transition argument identity',()=>{
 const recipe=recipes['/board/message-height.js'],op=operation('/board/message-height.js','const change=');
 for(const code of [op.before,op.after]){
  let calls=0,reads=0,arg;const result={kind:'animate'};
  const value=evaluate(recipe,code+';change;',{slot:{},from:40,target:50,initial:false,metricChange:false,forceSnap:false,pointer:false,key:true,win:{matchMedia(){calls++;return {get matches(){reads++;return false;}};}},messageHeightTransition(input){arg=input;return result;}});
  assert.equal(calls,1);assert.equal(reads,1);assert.equal(arg.pressing,true);assert.equal(value,result);
 }
});

test('animation guard preserves skipped getter, original getter counts, result and error identity',()=>{
 const recipe=recipes['/board/message-height.js'],op=operation('/board/message-height.js',"if(change.kind==='animate'"),primary=Error('original animation');
 for(const kind of ['snap','animate'])for(const code of [op.before,op.after]){
  let kinds=0,getters=0,calls=0;const animation={};const slot={get animate(){getters++;return ()=>{calls++;return animation;};}};
  const value=evaluate(recipe,`let animation=null;${code};animation;`,{slot,from:40,target:50,change:{get kind(){kinds++;return kind;},duration:280,easing:'ease'}});
  assert.equal(kinds,1);assert.equal(getters,kind==='animate'?2:0);assert.equal(calls,kind==='animate'?1:0);assert.equal(value,kind==='animate'?animation:null);
 }
 for(const code of [op.before,op.after])assert.throws(()=>evaluate(recipe,`let animation;${code}`,{slot:{animate(){throw primary;}},from:1,target:2,change:{kind:'animate',duration:1,easing:'ease'}}),error=>error===primary);
});

test('deferred height return and its original kind getter are preserved',()=>{
 const recipe=recipes['/board/message-height.js'],op=operation('/board/message-height.js',"if(change.kind==='defer'");
 for(const kind of ['defer','animate'])for(const code of [op.before,op.after]){
  let reads=0;const result=evaluate(recipe,`(function(){${code};return 'continued';})()`,{slot:{},change:{get kind(){reads++;return kind;}}});
  assert.equal(reads,1);assert.equal(result,kind==='defer'?undefined:'continued');
 }
});

const collector=()=>{let clock=0;const context={performance:{timeOrigin:123,now:()=>++clock}};vm.runInNewContext(`(${installRetreatHeightCollector.toString()})()`,context);return context;};
test('hover window arms on the real coordinate data without requiring a click',()=>{
 const c=collector();c.__retreatHeightRecord('hover-start',{value:{row:2,col:3}},{});c.__retreatHeightRecord('hover-start',{value:{row:3,col:2}},{});
 const snapshot=c.__retreatHeightFreeze();assert.equal(snapshot.armed,true);assert.equal(snapshot.windowFirst.length,1);assert.equal(snapshot.windowFirst[0].event,'hover-start');
});

test('collector skips diagnostic accessor reads and tolerates throwing proxy projections',()=>{
 const c=collector();let reads=0;const coord={get row(){reads++;return 3;},col:2};
 c.__retreatHeightRecord('hover-start',{value:coord},{});
 c.__retreatHeightRecord('bad',new Proxy({},{ownKeys(){throw Error('proxy');}}),{});
 assert.equal(reads,0);const snapshot=c.__retreatHeightFreeze();assert.equal(snapshot.incomplete,true);assert.equal(snapshot.armed,false);
});

test('bounded rings report dropped observations and freeze the first immutable snapshot',()=>{
 const c=collector();c.__retreatHeightRecord('hover-start',{value:{row:3,col:2}},{});
 for(let n=0;n<300;n++)c.__retreatHeightRecord('height-write',{from:n,to:n+1},{});
 const snapshot=c.__retreatHeightFreeze();assert.equal(snapshot.first.length,32);assert.equal(snapshot.tail.length,32);assert.equal(snapshot.windowFirst.length,64);assert.equal(snapshot.windowTail.length,64);assert.equal(snapshot.incomplete,true);assert.ok(snapshot.dropped>0);assert.ok(snapshot.windowDropped>0);
 assert.ok(Object.isFrozen(snapshot));assert.ok(Object.isFrozen(snapshot.windowFirst[0].data));
 const last=snapshot.windowTail.at(-1).sequence;c.__retreatHeightRecord('later',{value:1},{});assert.equal(c.__retreatHeightFreeze(),snapshot);assert.equal(snapshot.windowTail.at(-1).sequence,last);
});

test('unexpected optional persistence rejection cannot replace the original primary error',async()=>{
 const primary=Error('original workflow'),prior=console.error;console.error=()=>{};
 try{await assert.rejects(async()=>{try{throw primary;}finally{await finishRetreatHeightDiagnostics({persist(){throw Error('diagnostic cleanup');}});}},error=>error===primary);}
 finally{console.error=prior;}
});

test('owned routing is same-origin and failure-safe cleanup remains explicit and idempotent',async()=>{
 let pattern,handler,evaluations=0,unroutes=0,attachments=0;const receipts=[];
 const page={async addInitScript(){},async route(p,h){pattern=p;handler=h;},async evaluate(){evaluations++;return {armed:true,incomplete:false};},async unroute(p,h){assert.equal(p,pattern);assert.equal(h,handler);unroutes++;throw Error('unroute');}};
 const info={outputPath(){return '/private/tmp/righelt-retreat-diagnostic-missing-output/never-created/observation.json';},async attach(_name,{body}){attachments++;receipts.push(JSON.parse(body));}};
 const diagnostic=await installRetreatHeightDiagnostics(page,info,{baseURL:'http://127.0.0.1:10193'});
 assert.equal(pattern(new URL('https://other.invalid/board/message-height.js')),false);assert.equal(pattern(new URL('http://127.0.0.1:10193/board/message-height.js')),true);
 const prior=console.error;console.error=()=>{};
 try{await diagnostic.persist();await diagnostic.persist();}finally{console.error=prior;}
 assert.equal(evaluations,1);assert.equal(unroutes,1);assert.equal(attachments,1);assert.equal(receipts[0].incomplete,true);assert.equal(receipts[0].cleanup.incomplete,true);assert.equal(receipts[0].cleanup.errors[0].category,'owned-unroute-incomplete');
});

test('non-200 served modules abort rather than silently transform unrelated bytes',async()=>{
 let handler,aborts=0,fulfills=0;const page={async addInitScript(){},async route(_p,h){handler=h;},async evaluate(){return null;},async unroute(){}};
 const receipts=[],info={outputPath(){return '/private/tmp/righelt-retreat-diagnostic-missing-output/never-created/observation.json';},async attach(_name,{body}){receipts.push(JSON.parse(body));}};
 const diagnostic=await installRetreatHeightDiagnostics(page,info,{baseURL:'http://127.0.0.1:10193'});
 await handler({request:()=>({url:()=> 'http://127.0.0.1:10193/board/message-height.js',method:()=> 'GET'}),async fetch(){return {status:()=>503,text(){assert.fail('must not read failed response as source');}};},async abort(){aborts++;},async fulfill(){fulfills++;}});
 const prior=console.error;console.error=()=>{};try{await diagnostic.persist();}finally{console.error=prior;}
 assert.equal(aborts,1);assert.equal(fulfills,0);assert.equal(receipts[0].errors[0].category,'module-transform-incomplete');assert.equal(receipts[0].incomplete,true);
});

test('pending owned module work is drained even when unroute rejects',async()=>{
 let handler,release,settled=false,fulfilled=0;const gate=new Promise(resolve=>{release=resolve;});
 const page={async addInitScript(){},async route(_p,h){handler=h;},async evaluate(){return {armed:true,incomplete:false};},async unroute(){throw Error('owned unroute');}};
 const receipts=[],info={outputPath(){return '/private/tmp/righelt-retreat-diagnostic-missing-output/never-created/observation.json';},async attach(_name,{body}){receipts.push(JSON.parse(body));}};
 const diagnostic=await installRetreatHeightDiagnostics(page,info,{baseURL:'http://127.0.0.1:10193'});
 const source=await readFile(new URL('../../../apps/web/board/message-height.js',import.meta.url),'utf8');
 const work=handler({request:()=>({url:()=> 'http://127.0.0.1:10193/board/message-height.js',method:()=> 'GET'}),fetch:()=>gate,async fulfill(){fulfilled++;},async abort(){assert.fail('valid source must not abort');}});
 const prior=console.error;console.error=()=>{};
 try{
  const finishing=diagnostic.persist().then(()=>{settled=true;});
  await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(settled,false);
  release({status:()=>200,text:async()=>source});await Promise.all([work,finishing]);
 }finally{console.error=prior;}
 assert.equal(fulfilled,1);assert.equal(settled,true);assert.equal(receipts[0].transforms.length,1);assert.equal(receipts[0].cleanup.incomplete,true);
});

test('Page-owned fixture freezes once before dependency teardown after original finally',async()=>{
 const order=[];let reads=0,unroutes=0;
 const page={closed:false,async addInitScript(){},async route(){order.push('install');},async evaluate(){assert.equal(this.closed,false);reads++;order.push('freeze');return {armed:true,incomplete:false};},async unroute(){unroutes++;order.push('unroute');}};
 const info={title:'mandatory follow and exact sequence replay (none)',outputPath(){return '/private/tmp/righelt-retreat-diagnostic-missing-output/never-created/observation.json';},async attach(){order.push('attach');}};
 const prior=console.error;console.error=()=>{};
 try{await retreatHeightFixture({page,baseURL:'http://127.0.0.1:10193'},async diagnostic=>{order.push('body');try{}finally{await finishRetreatHeightDiagnostics(diagnostic);}},info);}
 finally{console.error=prior;}
 page.closed=true;order.push('page-teardown');
 assert.equal(reads,1);assert.equal(unroutes,1);assert.ok(order.indexOf('freeze')<order.indexOf('page-teardown'));assert.equal(order.filter(item=>item==='install').length,1);
 const workflow=await readFile(new URL('../../../e2e/workflows/forced-follow.spec.mjs',import.meta.url),'utf8');
 assert.match(workflow,/retreatHeightDiagnostics:\[retreatHeightFixture,\{auto:true\}\]/);assert.doesNotMatch(workflow,/retreatHeightFixture,\{[^}]*timeout/);
});

test('non-selected workflows never install diagnostic routes or read Page state',async()=>{
 const page=new Proxy({},{get(){assert.fail('unselected fixture must not access Page');}});
 let called=0;await retreatHeightFixture({page,baseURL:'http://127.0.0.1:10193'},async diagnostic=>{called++;assert.equal(diagnostic,null);},{title:'mandatory follow and exact sequence replay (lost reply)'});
 assert.equal(called,1);
});

test('timeout cleanup with an already closed Page remains incomplete and preserves primary identity',async()=>{
 const primary=Error('original test timeout'),receipts=[];let reads=0;
 const page={async addInitScript(){},async route(){},async evaluate(){reads++;throw Error('page closed');},async unroute(){throw Error('page closed');}};
 const info={title:'mandatory follow and exact sequence replay (none)',outputPath(){return '/private/tmp/righelt-retreat-diagnostic-missing-output/never-created/observation.json';},async attach(_name,{body}){receipts.push(JSON.parse(body));}};
 const prior=console.error;console.error=()=>{};
 try{await assert.rejects(()=>retreatHeightFixture({page,baseURL:'http://127.0.0.1:10193'},async()=>{throw primary;},info),error=>error===primary);}
 finally{console.error=prior;}
 assert.equal(reads,1);assert.equal(receipts[0].incomplete,true);assert.equal(receipts[0].observation,null);assert.ok(receipts[0].errors.some(row=>row.category==='snapshot-incomplete'));assert.equal(receipts[0].cleanup.incomplete,true);
});

test('retained height target preserves ternary getter skips, reference and original errors',()=>{
 const recipe=recipes['/board/message-height.js'],op=operation('/board/message-height.js','const target='),primary=Error('target getter');
 for(const active of [false,true])for(const code of [op.before,op.after]){
  const value={height:90};let flags=0,floors=0,naturals=0;
  const scope={get transientContent(){flags++;return active;},get transientFloor(){floors++;return value;},get naturalTarget(){naturals++;return value;}};
  assert.equal(evaluate(recipe,`with(scope){${code};target;}`,{scope,slot:{}}),value);
  assert.equal(flags,1);assert.equal(floors,active?1:0);assert.equal(naturals,active?0:1);
  const throwing={get transientContent(){return active;},get transientFloor(){if(active)throw primary;assert.fail('skipped floor');},get naturalTarget(){if(!active)throw primary;assert.fail('skipped natural');}};
  assert.throws(()=>evaluate(recipe,`with(scope){${code};target;}`,{scope:throwing,slot:{}}),error=>error===primary);
 }
});
