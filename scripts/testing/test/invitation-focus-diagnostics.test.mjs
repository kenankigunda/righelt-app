import {createNotificationPatchLifecycle} from '../../../apps/web/shell/game-alert-presentation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {transformInvitationFocusModule,installInvitationFocusCollector,encodeInvitationFocusEvidence,persistInvitationFocusEvidence,installInvitationFocusDiagnostics} from '../../../e2e/support/invitation-focus-diagnostics.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const source=await readFile(new URL('../../../apps/web/shell/app.js',import.meta.url),'utf8');
const recipe=JSON.parse(await readFile(new URL('../../../e2e/support/invitation-focus-transformations.json',import.meta.url),'utf8'));
const html=await readFile(new URL('../../../apps/web/index.html',import.meta.url),'utf8');
const main=await readFile(new URL('../../../apps/web/main.js',import.meta.url),'utf8');
const moduleTags=[...html.matchAll(/<script\b([^>]*)>/g)].filter(row=>/\btype=["']module["']/.test(row[1]));
assert.equal(moduleTags.length,1);const entry=moduleTags[0][1].match(/\bsrc=["']([^"']+)["']/)?.[1];assert.ok(entry);
const shellImport=main.match(/await\s+import\(["'](\.\/shell\/app\.js)["']\)/)?.[1];assert.ok(shellImport);
const servedPath=new URL(shellImport,new URL(entry,'http://127.0.0.1:10193/')).pathname;
const moduleURL=new URL(servedPath,'http://127.0.0.1:10193').href;
const transformed=transformInvitationFocusModule(source,recipe);
const title='Players restores the selected invitation role after delayed clipboard success';
test('served identity follows actual HTML/main entry and retained native request witness',()=>{
 assert.equal(servedPath,'/shell/app.js');assert.equal(recipe.pathname,servedPath);
 assert.equal(recipe.servedPathWitness.pathname,servedPath);assert.equal(recipe.servedPathWitness.method,'GET');assert.equal(recipe.servedPathWitness.status,200);
 assert.match(recipe.servedPathWitness.traceSha256,/^[a-f0-9]{64}$/);
 assert.equal(recipe.earlyCaseServedPathWitness.pathname,servedPath);assert.equal(recipe.earlyCaseServedPathWitness.method,'GET');assert.equal(recipe.earlyCaseServedPathWitness.status,200);
 assert.match(recipe.earlyCaseServedPathWitness.traceSha256,/^[a-f0-9]{64}$/);
});
test('focus diagnostic transforms only the exact actual module and verified output',()=>{
 assert.equal(hash(source),recipe.sourceSha256);assert.equal(hash(transformed),recipe.outputSha256);
 assert.throws(()=>transformInvitationFocusModule(source+' ',recipe),/identity/);
 assert.throws(()=>transformInvitationFocusModule(source,{...recipe,pathname:'/other.js'}),/identity/);
 const bad=structuredClone(recipe);bad.operations[0].before+='x';assert.throws(()=>transformInvitationFocusModule(source,bad),/hunk/);
 assert.throws(()=>transformInvitationFocusModule(source,{...recipe,outputSha256:'0'.repeat(64)}),/output/);
});
test('focus diagnostic retains both original native bodies and three opt-in cases',async()=>{
 const text=await readFile(new URL('../../../e2e/workflows/ux-refresh-checkpoint.spec.mjs',import.meta.url),'utf8');
 const start=text.indexOf(" await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard'",text.indexOf("for(const outcome of ['success','failure'])"));
 const end=text.indexOf('\n }finally{await focusDiagnostics.persist();}',start);
 assert.equal(hash(text.slice(start,end)),recipe.originalNativeBodySha256);
 assert.equal(text.split('await installInvitationFocusDiagnostics(').length-1,2);
 const earlyStart=text.indexOf(" await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard'",text.indexOf("test('Players viewer invitation preserves focus through pending copy and failure'"));
 const earlyEnd=text.indexOf('\n }finally{await focusDiagnostics.persist();}',earlyStart);
 assert.equal(hash(text.slice(earlyStart,earlyEnd)),recipe.originalEarlyNativeBodySha256);
 assert.ok(text.includes("for(const outcome of ['success','failure'])"));
});
async function invokePending(code,{getter=false,sink=false,fail=false,retire=false,key='copy-invite:opaque'}={}){
 let snapshots=0,generation=1;const renders=[],pendingButtonKeys=new Set();
 const context={pendingButtonKeys,account:{snapshot(){snapshots++;return {generation};}},render(value){renders.push(value);},window:{}};
 if(getter)Object.defineProperty(context,'__righeltInviteFocusProbe',{get(){throw Error('PRIVATE getter');}});
 else context.__righeltInviteFocusProbe=()=>{if(sink)throw Error('PRIVATE sink');};
 const begin=code.indexOf('const withPendingButton ='),end=code.indexOf('const routeReadKey =',begin);
 const helper=transformed.slice(transformed.indexOf('const observeInviteFocus ='),transformed.indexOf('const patchToolHtml ='));
 vm.runInNewContext(helper+code.slice(begin,end)+';globalThis.invoke=withPendingButton;',context);
 const value=await context.invoke(key,async()=>{if(retire)generation=2;if(fail)throw Error('original-domain-error');return 37;});
 return {value,snapshots,renders:JSON.stringify(renders),pending:pendingButtonKeys.has(key),error:context.window.__righeltLastError};
}
test('throwing hook getter or sink preserves actual pending-button result, error and account reads',async()=>{
 for(const options of [{},{getter:true},{sink:true},{getter:true,fail:true},{sink:true,fail:true},{getter:true,retire:true}])assert.deepEqual(await invokePending(transformed,options),await invokePending(source,options));
 const key={get startsWith(){throw Error('must not read');}};
 assert.deepEqual(await invokePending(transformed,{key}),await invokePending(source,{key}));
});
function collector(){
 const listeners=[];const main={},join={querySelector(){return button;}},button={dataset:{inviteRole:'viewer',action:'copy-invite'},tagName:'BUTTON',isConnected:true,disabled:false,closest(selector){return selector.includes('copy-invite')?this:selector.includes('join')?join:main;}};
 const document={activeElement:button,visibilityState:'visible',hasFocus:()=>true,querySelector:selector=>selector.includes('join')?join:main,addEventListener(type,fn,options){listeners.push({type,fn,options});}};
 const context={document,performance:{now:()=>17,timeOrigin:23}};vm.runInNewContext('('+installInvitationFocusCollector.toString()+')()',context);
 return {context,button,document,listeners,read:()=>context.__righeltInviteFocusRead()};
}
test('collector catches throwing DOM getters and listener projection without leaking error text',()=>{
 const c=collector();const bad={get closest(){throw Error('PRIVATE TOKEN');}};
 assert.doesNotThrow(()=>c.context.__righeltInviteFocusProbe('action-entry',bad));assert.equal(c.read().incomplete,true);
 assert.doesNotThrow(()=>c.listeners[0].fn({get target(){throw Error('PRIVATE HEADER');}}));
 assert.ok(!JSON.stringify(c.read()).includes('PRIVATE'));
 assert.ok(c.listeners.every(row=>row.options.capture&&row.options.passive));
});
test('collector retains first64 and last64, marks drops incomplete and keeps weak lineage',()=>{
 const c=collector();c.context.__righeltInviteFocusProbe('action-entry',c.button);
 for(let i=0;i<140;i++)c.context.__righeltInviteFocusProbe('pending-after-clear');
 const x=c.read();assert.equal(x.seen,141);assert.equal(x.records.length,128);assert.equal(x.dropped,13);assert.equal(x.incomplete,true);
 assert.equal(x.records[0].seq,1);assert.equal(x.records.at(-1).seq,141);
 assert.equal(x.records[0].originalJoin,x.records.at(-1).currentJoin);assert.equal(x.records.at(-1).activeOriginal,true);
});
function completeObservation(){const c=collector();c.context.__righeltInviteFocusProbe('action-entry',c.button);c.context.__righeltInviteFocusProbe('pending-after-end-render');return c.read();}
test('encoder copies only allowed scalars and never invokes page custom serializers',()=>{
 const observation=completeObservation();let called=false;observation.toJSON=()=>{called=true;throw Error('PRIVATE');};observation.gameId='PRIVATE';observation.records[0].headers='PRIVATE';
 const encoded=encodeInvitationFocusEvidence({caseTitle:title,observation,transforms:[],errors:[]});
 assert.equal(called,false);assert.ok(!encoded.includes('PRIVATE'));assert.equal(JSON.parse(encoded).incomplete,false);
 const getter={get records(){throw Error('PRIVATE');}};assert.equal(JSON.parse(encodeInvitationFocusEvidence({observation:getter})).category,'serialization-failed');
 const empty=completeObservation();empty.records=[];assert.equal(JSON.parse(encodeInvitationFocusEvidence({observation:empty})).incomplete,true);
});
test('serializer failure uses a constant safe receipt without masking the primary exception',async()=>{
 const primary=Error('original failure');const writes=[],attachments=[];
 await assert.rejects(async()=>{try{throw primary;}finally{await persistInvitationFocusEvidence({evaluate:async()=>completeObservation()},{title,outputPath:()=>'/private/output',attach:async(name,value)=>attachments.push(value.body)},{transforms:[],errors:[]},{serialize(){throw Error('PRIVATE serializer');},write:async(path,bytes)=>writes.push(bytes),emit(){throw Error('PRIVATE console');}});}},error=>error===primary);
 assert.equal(writes.length,1);assert.equal(writes[0],attachments[0]);assert.equal(JSON.parse(writes[0]).category,'serialization-failed');assert.ok(!writes[0].includes('PRIVATE'));
});
test('read, file, attachment, path and console failures remain categorical and nonthrowing',async()=>{
 await assert.doesNotReject(()=>persistInvitationFocusEvidence({evaluate:async()=>{throw Error('PRIVATE read');}},{title,get outputPath(){throw Error('PRIVATE path');},get attach(){throw Error('PRIVATE attach');}},{transforms:[],errors:[]},{write:async()=>{throw Error('PRIVATE disk');},emit(){throw Error('PRIVATE console');}}));
});
test('served-module route is exact-origin/path and fails closed on query, hash and upstream status',async()=>{
 let pattern,handler,init,unrouted=false,body,aborted=0,fulfill=0,receipt;
 const page={addInitScript:async fn=>{init=fn;},route:async(p,h)=>{pattern=p;handler=h;},evaluate:async()=>completeObservation(),unroute:async()=>{unrouted=true;}};
 const info={title,outputPath:()=>'/unused',attach:async(name,value)=>{receipt=JSON.parse(value.body);}};
 const diagnostic=await installInvitationFocusDiagnostics(page,info,{baseURL:'http://127.0.0.1:10193'});
 assert.equal(init,installInvitationFocusCollector);assert.equal(pattern(new URL('http://other/shell/app.js')),false);assert.equal(pattern(new URL('http://127.0.0.1:10193/other.js')),false);assert.equal(pattern(new URL('http://127.0.0.1:10193/apps/web/shell/app.js')),false);assert.equal(pattern(new URL(moduleURL)),true);
 const route=(url,sourceBody=source,status=200)=>({request:()=>({url:()=>url,method:()=> 'GET'}),fetch:async()=>({status:()=>status,text:async()=>sourceBody}),fulfill:async value=>{body=value.body;fulfill++;},abort:async()=>{aborted++;}});
 await handler(route(moduleURL));assert.equal(hash(body),recipe.outputSha256);assert.equal(fulfill,1);
 await handler(route(moduleURL+'?unknown'));await handler(route(moduleURL,source+' '));await handler(route(moduleURL,source,503));assert.equal(aborted,3);assert.equal(fulfill,1);
 for(let i=0;i<20;i++)await handler(route(moduleURL+'?unknown'));
 // Do not perform real disk I/O in this unit contract. Disposal itself is safe.
 page.evaluate=async()=>null;info.outputPath=()=>{throw Error('unit sink');};await diagnostic.persist();assert.equal(unrouted,true);assert.equal(receipt.errors.length,8);assert.ok(receipt.metadataDropped>0);assert.equal(receipt.incomplete,true);
 await assert.rejects(()=>installInvitationFocusDiagnostics(page,{title:'unrelated workflow'},{baseURL:'http://127.0.0.1:10193'}),/allowlisted/);
});

test('installer and evidence encoder admit exactly the three invitation focus cases',async()=>{
 for(const caseTitle of ['Players viewer invitation preserves focus through pending copy and failure','Players restores the selected invitation role after delayed clipboard success','Players restores the selected invitation role after delayed clipboard failure']){
  let init=0,route=0;
  await installInvitationFocusDiagnostics({addInitScript:async()=>{init++;},route:async()=>{route++;}},{title:caseTitle},{baseURL:'http://127.0.0.1:10193'});
  assert.equal(init,1);assert.equal(route,1);
  const safe=JSON.parse(encodeInvitationFocusEvidence({caseTitle,observation:completeObservation(),transforms:[],errors:[]}));
  assert.equal(safe.caseTitle,caseTitle);assert.equal(safe.incomplete,false);
 }
 const page={addInitScript:async()=>{throw Error('unlisted must not initialize');},route:async()=>{throw Error('unlisted must not route');}};
 await assert.rejects(()=>installInvitationFocusDiagnostics(page,{title:'Players unrelated clipboard case'},{baseURL:'http://127.0.0.1:10193'}),/allowlisted/);
});

// Execute the diagnostic recipe's own inserted statements, not sliced product
// code. The real lifecycle helper performs the DOM mutation between witnesses.
test('replacement witnesses surround actual DOM mutation only for changed markup',()=>{
 const before=recipe.operations[1],after=recipe.operations[2];
 assert.equal(before.before,'');assert.equal(after.before,'');
 for(const changed of [false,true]){
  const events=[],nextMain={},currentMain={replaceWith:next=>{assert.equal(next,nextMain);events.push('replace');}};
  const patches=createNotificationPatchLifecycle({captureBeforePatch:()=>events.push('capture')},{replaceMain:()=>false});
  const nextMarkup='next',lastRenderedMarkup=changed?'old':'next';
  const inputs={appEl:{querySelector:()=>currentMain},nextMarkup,lastRenderedMarkup,routeName:'game',patchHomeAroundCreateControl:()=>assert.fail('not a Home branch'),createMarkupRoot:()=>({querySelector:()=>nextMain}),updateMountedFlyouts:()=>events.push('flyouts')};
  const context={nextMarkup,lastRenderedMarkup,observeInviteFocus:phase=>events.push(phase),patch:()=>patches.patchMainMarkup(inputs)};
  // The two inserted statements are the artifact under test; this wrapper
  // supplies only their original changed-branch relationship.
  vm.runInNewContext(before.after+'if(patch()){'+after.after+'}',context);
  assert.deepEqual(events,changed?['render-before-replacement','capture','replace','flyouts','render-after-replacement']:['capture']);
 }
});
