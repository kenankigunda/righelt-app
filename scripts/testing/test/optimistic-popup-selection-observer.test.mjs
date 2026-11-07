import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {PREFIX,transformPopupModule,installPopupCollector,createPopupLedger,installPopupObservation} from '../../../e2e/support/optimistic-popup-selection-observer.mjs';
const recipes=JSON.parse(readFileSync(new URL('../../../e2e/support/optimistic-popup-selection-recipes.json',import.meta.url),'utf8'));
const source=recipe=>readFileSync(new URL('../../../'+recipe.file,import.meta.url),'utf8');
const action={type:'move',actorId:'private-actor',from:{row:1,col:2},to:{row:2,col:2}};
function hydration(transformed,sink){const r=recipes.find(r=>r.file.endsWith('selection-hydration.js'));let text=source(r);if(transformed)text=transformPopupModule(text,r);const c={__popupSelectionProbe:{record:sink}};runInNewContext(text.replace('export const resolveInitialSelectionHydration','const resolveInitialSelectionHydration')+'\nglobalThis.resolve=resolveInitialSelectionHydration;',c);return c.resolve;}
for(const recipe of recipes)test('exact source/ranges/output '+recipe.file,()=>{
 const input=source(recipe),output=transformPopupModule(input,recipe);assert.notEqual(output,input);
 assert.throws(()=>transformPopupModule(input+' ',recipe),/source-binding/);
 assert.throws(()=>transformPopupModule(input,{...recipe,outputSha256:'0'.repeat(64)}),/output-binding/);
 const [op,...rest]=recipe.operations;assert.throws(()=>transformPopupModule(input,{...recipe,operations:[{...op,start:-1},...rest]}),/range-binding/);
});
test('legal hydration keeps matching action reference and stable-key call once despite throwing sink',()=>{
 for(const transformed of [false,true]){let calls=0;const resolve=hydration(transformed,()=>{throw Error('sink');});const result=resolve({gameId:'private-game',initialSelectionAction:action,legalActions:[action],consumedActionKey:null,toStableKey(value){calls++;assert.equal(value,action);return 'private-key';}});assert.equal(result.selectionAction,action);assert.equal(result.shouldConsume,true);assert.equal(calls,1);}
});
test('missing game skips original stable-key and legal-action getter',()=>{
 for(const transformed of [false,true]){let finds=0,keys=0;const legal=[];Object.defineProperty(legal,'find',{get(){finds++;throw Error('skipped');}});assert.equal(hydration(transformed,()=>{} )({gameId:null,initialSelectionAction:action,legalActions:legal,toStableKey(){keys++;}}).shouldConsume,false);assert.equal(finds,0);assert.equal(keys,0);}
});
test('already consumed action skips find getter; illegal action still consumes once',()=>{
 for(const transformed of [false,true]){let finds=0;const legal=[];Object.defineProperty(legal,'find',{get(){finds++;return Array.prototype.find;}});const resolve=hydration(transformed,()=>{});assert.equal(resolve({gameId:'g',initialSelectionAction:action,legalActions:legal,consumedActionKey:'key',toStableKey:()=> 'key'}).shouldConsume,false);assert.equal(finds,0);const r=resolve({gameId:'g',initialSelectionAction:action,legalActions:legal,consumedActionKey:null,toStableKey:()=> 'key'});assert.equal(r.selectionAction,null);assert.equal(r.shouldConsume,true);assert.equal(finds,1);}
});
test('original stable-key and action getter errors retain identity',()=>{
 for(const transformed of [false,true]){const primary=Error('original');const resolve=hydration(transformed,()=>{throw Error('sink');});assert.throws(()=>resolve({gameId:'g',initialSelectionAction:action,legalActions:[action],toStableKey(){throw primary;}}),e=>e===primary);const bad={get type(){throw primary;}};assert.throws(()=>resolve({gameId:'g',initialSelectionAction:bad,legalActions:[action],toStableKey:()=> 'key'}),e=>e===primary);}
});
test('modeled transient-unmatched sequence remains one-shot; no synthetic reselection',()=>{
 const resolve=hydration(true,()=>{}),first=resolve({gameId:'g',initialSelectionAction:action,legalActions:[],toStableKey:()=> 'key'});
 const later=resolve({gameId:'g',initialSelectionAction:action,legalActions:[action],consumedActionKey:first.nextConsumedActionKey,toStableKey:()=> 'key'});
 assert.equal(first.shouldConsume,true);assert.equal(first.selectionAction,null);assert.equal(later.shouldConsume,false);assert.equal(later.selectionAction,null);
 // This is an unchanged-policy counterexample model, not the failed CI path.
});
function expressionValue(){const r=recipes[0];return r.operations[0].after;}
test('value wrapper returns exact reference/error and preserves short-circuit getter counts',()=>{
 const primary=Error('getter'),c={calls:0,__popupSelectionProbe:{record(){throw Error('sink');}}};runInNewContext(expressionValue()+'\nglobalThis.v=__popupValue;',c);const object={};assert.equal(c.v('x',object),object);let reads=0;const host={get flag(){reads++;throw primary;}};assert.equal(true||c.v('x',host.flag),true);assert.equal(reads,0);assert.throws(()=>c.v('x',host.flag),e=>e===primary);assert.equal(reads,1);
});
test('actual map assignment wrappers read original operands once and keep map return reference',()=>{
 const recipe=recipes.find(r=>r.file.endsWith('/app.js')),op=recipe.operations.find(o=>o.before.startsWith('consumedInitialSelectionActionKeyByGameId.set'));
 for(const text of [op.before,op.after]){let a=0,b=0;const map=new Map(),c={consumedInitialSelectionActionKeyByGameId:map,game:{get id(){a++;return 'g';}},initialSelectionHydration:{get nextConsumedActionKey(){b++;return 'k';}},boardRuntime:{},__popupSelectionProbe:{record(){throw Error('sink');}}};runInNewContext(expressionValue()+text,c);assert.equal(a,1);assert.equal(b,1);assert.equal(map.get('g'),'k');}
});
test('runtime public object record joins private scope without changing reference',()=>{
 const rows=[],c={__popupSelectionProbe:{record(...args){rows.push(args);}}};runInNewContext(expressionValue()+'const scope={};const object={};globalThis.object=object;globalThis.result=__popupValue("runtime-public",object,scope);',c);assert.equal(c.result,c.object);assert.equal(rows[0][1],c.object);assert(rows[0][2]);
});
function collector(){const texts=[],c={console:{debug(value){texts.push(value);}}};runInNewContext('('+installPopupCollector.toString()+')()',c);return {texts,record:c.__popupSelectionProbe.record};}
test('collector never invokes diagnostic getters or serializes raw IDs',()=>{
 const c=collector();let reads=0;const value={get selectionAction(){reads++;throw Error('getter');},shouldConsume:true};c.record('hydrate-result',value);c.record('consume-game','SECRET_GAME_ID');assert.equal(reads,0);assert(!c.texts.join('').includes('SECRET_GAME_ID'));
});
test('object tokens stable per document and browser emission cap explicitly overflows',()=>{
 const c=collector(),value={};c.record('a',value);c.record('a',value);assert.equal(JSON.parse(c.texts[0].slice(PREFIX.length)).value,JSON.parse(c.texts[1].slice(PREFIX.length)).value);for(let i=0;i<2100;i++)c.record('a',value);assert.equal(c.texts.length,2049);assert.equal(JSON.parse(c.texts.at(-1).slice(PREFIX.length)).kind,'overflow');
});
test('Node ledger keeps first/tail exact drops, immutable once freeze and no late backfill',()=>{
 const l=createPopupLedger();for(let i=1;i<=400;i++)l.accept(PREFIX+JSON.stringify({schema:1,seq:i,kind:'consume-game',scope:0,value:0,present:false}),1);const r=l.freeze();assert.equal(r.first.length,128);assert.equal(r.tail.length,256);assert.equal(r.dropped,16);assert.equal(r.incomplete,true);l.accept(PREFIX+JSON.stringify({schema:1,seq:401,kind:'consume-game',scope:0,value:0,present:false}),1);assert.equal(l.freeze(),r);assert.equal(r.received,400);assert(Object.isFrozen(r.tail));
});
test('malformed and overflow rows remain incomplete and page epochs stay separate',()=>{
 const l=createPopupLedger();l.accept(PREFIX+'bad',1);l.accept(PREFIX+JSON.stringify({schema:1,seq:1,kind:'consume-game',scope:0,value:0,present:false}),1);l.accept(PREFIX+JSON.stringify({schema:1,seq:1,kind:'consume-game',scope:0,value:0,present:false}),2);const r=l.freeze();assert.equal(r.incomplete,true);assert.deepEqual(r.first.map(x=>x.page),[1,2]);assert.equal(r.generationVerified,false);
});
const ingressRow=extra=>({schema:1,seq:1,kind:'consume-game',scope:0,value:1,present:true,...extra});
const rejectIngress=extra=>{const l=createPopupLedger();l.accept(PREFIX+JSON.stringify(ingressRow(extra)),1);const r=l.freeze();assert.equal(r.received,0);assert.equal(r.first.length,0);assert.equal(r.receivedWindowIncomplete,true);assert(!JSON.stringify(r).includes('SECRET_GAME_ID'));};
test('forged raw identifiers never enter opaque token fields',()=>{
 for(const field of ['scope','value','selection','selected'])rejectIngress({[field]:'SECRET_GAME_ID'});
});
test('nested token and flag objects or arrays are rejected without retaining payload',()=>{
 for(const field of ['scope','value','selection','selected','present','boolean','consume','projectionIncomplete','incomplete'])for(const value of [{secret:'SECRET_GAME_ID'},['SECRET_GAME_ID']])rejectIngress({[field]:value});
});
test('fixed kind enum and real boolean flags reject forged categorical strings',()=>{
 rejectIngress({kind:'SECRET_GAME_ID'});
 for(const field of ['present','boolean','consume','projectionIncomplete','incomplete'])for(const value of ['true',0,1,null])rejectIngress({[field]:value});
});
test('oversized prefixed UTF-8 rows fail before parsing and preserve no raw bytes',()=>{
 for(const payload of ['SECRET_GAME_ID'.repeat(400),'界'.repeat(1500)]){const l=createPopupLedger();l.accept(PREFIX+JSON.stringify(ingressRow({value:payload})),1);const r=l.freeze();assert.equal(r.received,0);assert.equal(r.receivedWindowIncomplete,true);assert(!JSON.stringify(r).includes(payload.slice(0,30)));}
});
test('tokens must be safe nonnegative integers; only exact numeric endpoints qualify',()=>{
 for(const field of ['scope','value','selection','selected'])for(const value of [-1,.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity])rejectIngress({[field]:value});
 const l=createPopupLedger();l.accept(PREFIX+JSON.stringify(ingressRow({scope:0,value:Number.MAX_SAFE_INTEGER})),1);assert.equal(l.freeze().received,1);
});
async function contextFixture({unrouteError=false}={}){const listeners=new Map(),routes=[];let unroutes=0;const context={on:(k,v)=>listeners.set(k,v),off:(k,v)=>{assert.equal(listeners.get(k),v);listeners.delete(k);},async addInitScript(fn){assert.equal(fn,installPopupCollector);},async route(match,fn){routes.push([match,fn]);},async unroute(){unroutes++;if(unrouteError)throw Error('unroute');}};const owner=await installPopupObservation(context,{baseURL:'http://127.0.0.1:10193',recipes});return {owner,routes,listeners,unroutes:()=>unroutes};}
const nativePaths=new Map([['apps/web/shell/selection-hydration.js','/shell/selection-hydration.js'],['apps/web/shell/app.js','/shell/app.js'],['apps/web/board/runtime/board-runtime.js','/board/runtime/board-runtime.js']]);
test('routes match actual Pages native webroot paths and reject repo-prefixed paths and foreign origins',async()=>{
 const f=await contextFixture();assert.equal(recipes.length,3);
 for(let i=0;i<recipes.length;i++){const match=f.routes[i][0],path=nativePaths.get(recipes[i].file);assert.equal(recipes[i].servedPath,path);assert(match(new URL('http://127.0.0.1:10193'+path)));assert(!match(new URL('http://127.0.0.1:10193/'+recipes[i].file)));assert(!match(new URL('http://localhost:10193'+path)));assert(!match(new URL('http://127.0.0.1:10193/other')));}
 await f.owner.finish({attach:async()=>{}});assert.equal(f.unroutes(),3);assert.equal(f.listeners.size,0);await assert.rejects(installPopupObservation({}, {baseURL:'https://example.com',recipes}),/local-origin/);
});
test('native route mapping follows actual Pages apps/web cwd instead of component fixture repo root',()=>{
 const stack=readFileSync(new URL('../../../scripts/e2e-stack.mjs',import.meta.url),'utf8');
 assert.match(stack,/spawnLogged\("pages", "pnpm", \["exec", "wrangler", "pages", "dev", "\.", "--port", webPort\]/);
 assert.match(stack,/cwd: path\.join\(repoRoot, "apps", "web"\)/);
 for(const recipe of recipes)assert.equal(recipe.servedPath,'/'+recipe.file.slice('apps/web/'.length));
});
test('actual native URL selection transforms each original module exactly once with full source/output binding',async()=>{
 const f=await contextFixture();let fetches=0,fulfills=0,receipt;
 for(const recipe of recipes){const url=new URL('http://127.0.0.1:10193'+nativePaths.get(recipe.file));const selected=f.routes.filter(([match])=>match(url));assert.equal(selected.length,1);await selected[0][1]({async fetch(){fetches++;return {status:()=>200,text:async()=>source(recipe)};},request:()=>({method:()=> 'GET'}),async fulfill({body}){fulfills++;assert.equal(body,transformPopupModule(source(recipe),recipe));}});}
 await f.owner.finish({attach:async(_name,{body})=>{receipt=JSON.parse(body);}});assert.equal(fetches,3);assert.equal(fulfills,3);assert.equal(receipt.metadata.transformed,3);assert.equal(receipt.metadata.incomplete,false);assert(receipt.metadata.modules.every(module=>module.count===1));
});
test('original fetch and fulfill once; bad source receives no transform credit',async()=>{
 const f=await contextFixture();let gets=0,fulfills=0,receipt;await f.routes[0][1]({async fetch(){gets++;return {status:()=>200,text:async()=> 'mismatch'};},request:()=>({method:()=> 'GET'}),async fulfill({body}){fulfills++;assert.equal(body,undefined);}});await f.owner.finish({attach:async(_name,{body})=>{receipt=JSON.parse(body);}});assert.equal(gets,1);assert.equal(fulfills,1);assert.equal(receipt.metadata.transformed,0);assert(receipt.metadata.issues.includes('source-binding'));
});
test('unroute rejection still drains held request and all routes before finish evidence',async()=>{
 const f=await contextFixture({unrouteError:true});let release,finished=false;const held=new Promise(r=>{release=r;});const task=f.routes[0][1]({async fetch(){await held;return {status:()=>200,text:async()=>source(recipes[0])};},request:()=>({method:()=> 'GET'}),fulfill:async()=>{}});const finish=f.owner.finish({attach:async()=>{}}).then(()=>{finished=true;});await Promise.resolve();await Promise.resolve();assert.equal(finished,false);release();await task;await finish;assert.equal(f.unroutes(),3);assert.equal(f.listeners.size,0);
});
test('finish attachment error cannot replace original primary and never calls browser evaluate',async()=>{
 const f=await contextFixture(),primary=Error('primary');let observed;try{try{throw primary;}finally{await f.owner.finish({attach:async()=>{throw Error('attachment');}});}}catch(e){observed=e;}assert.equal(observed,primary);assert.equal(f.listeners.size,0);
});
