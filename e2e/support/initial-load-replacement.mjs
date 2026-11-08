import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createFaultLifecycle} from './fault-lifecycle.mjs';
import {validSyncSnapshot} from '../../apps/web/shell/live-transport.js';
import {buildLocalApiWsHost,isLocalDevHost} from '../../apps/web/local-dev-ports.js';
export const INITIAL_LOAD_RECIPE=JSON.parse(fs.readFileSync(new URL('./initial-load-replacement-recipe.json',import.meta.url),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
export function transformInitialLoadHtml(source,recipe=INITIAL_LOAD_RECIPE.html){
 assert.equal(hash(source),recipe.sourceSha256,'Initial-load HTML source drift');
 assert.equal(recipe.count,1);assert.equal(source.split(recipe.before).length-1,1,'Initial-load HTML anchor count');
 const body=source.replace(recipe.before,recipe.after);
 assert.equal(hash(body),recipe.outputSha256,'Initial-load HTML output drift');
 assert.equal(body.split(recipe.after).length-1,1);assert.equal(body.replace(recipe.after,recipe.before),source,'Initial-load HTML exact inverse');
 return body;
}
export function verifyInitialLoadAsset(bytes,recipe=INITIAL_LOAD_RECIPE.asset){assert.equal(bytes.byteLength,recipe.bytes);assert.equal(hash(bytes),recipe.sourceSha256,'Initial-load original asset drift');return bytes;}
export function inverseInitialLoadSource(source,recipe){
 assert.equal(recipe.version,1);assert.equal(recipe.modulePath,'/shell/live-transport.js');assert.equal(hash(source),recipe.sourceSha256,'Inverse loader source drift');
 assert.equal(recipe.operations.length,1);const op=recipe.operations[0];assert.equal(op.after,'');assert(Number.isSafeInteger(op.start)&&Number.isSafeInteger(op.end)&&op.start>=0&&op.end>op.start);
 assert.equal(source.slice(op.start,op.end),op.before);assert.equal(source.split(op.before).length-1,1);assert.equal(op.before.split('error?.code === "recovery_superseded"').length-1,1);
 const body=source.slice(0,op.start)+source.slice(op.end);assert.equal(hash(body),recipe.outputSha256,'Inverse loader output drift');
 assert.equal(body.slice(0,op.start)+op.before+body.slice(op.start),source,'Inverse loader exact inverse');return body;
}
// Serialized before target navigation. Observe starts only, never adopt a fetch
// promise or read response, signal, headers or body. Unsupported metadata fails
// this test's observation closed while the original fetch still runs unchanged.
export function installInitialLoadObserver({gameId}){
 const documentNonce=crypto.randomUUID();
 const originalFetch=globalThis.fetch,origin=location.origin,prefix='/api/shell/games/'+encodeURIComponent(gameId),rows=[],listeners=[];
 let dropped=0,errors=0,sequence=0,stopped=false;
 const add=(kind,fields={})=>{if(stopped)return;try{if(rows.length===64){dropped++;return;}const now=performance.now();if(!Number.isFinite(now)||now<0)throw Error('clock');rows.push({sequence:++sequence,kind,...fields,now});}catch{errors++;}};
 const lifecycle=event=>{try{add('lifecycle',{event:event.type,trusted:event.isTrusted,persisted:typeof event.persisted==='boolean'?event.persisted:null,readyState:document.readyState,visibility:document.visibilityState});}catch{errors++;}};
 for(const name of ['pageshow','pagehide','load','online','offline','visibilitychange']){const target=name==='visibilitychange'?document:globalThis;target.addEventListener(name,lifecycle,{capture:true,passive:true});listeners.push([target,name,lifecycle]);}
 function observedFetch(...args){
  try{
   if(typeof args[0]!=='string')throw Error('opaque-fetch-input');
   const url=new URL(args[0],location.href);let method='GET';
   if(args[1]!==undefined){if(args[1]===null||typeof args[1]!=='object')throw Error('opaque-fetch-options');const descriptor=Object.getOwnPropertyDescriptor(args[1],'method');if(descriptor){if(!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='string')throw Error('opaque-fetch-method');method=descriptor.value.toUpperCase();if(!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method))throw Error('unknown-fetch-method');}}
   if(url.origin===origin&&(url.pathname===prefix||url.pathname.startsWith(prefix+'/'))){
    const suffix=url.pathname.slice(prefix.length);let endpoint=suffix==='/position'&&method==='GET'?'position':suffix===''&&method==='GET'?'full':suffix==='/reconcile'&&method==='POST'?'reconcile':suffix==='/presence'?'presence':method==='GET'||['/decision-history','/decision-snapshot','/legal','/piece-moves','/history'].includes(suffix)?'other-read':'write';
    add('fetch-start',{endpoint,method});
   }
  }catch{errors++;}
  return Reflect.apply(originalFetch,this,args);
 }
 globalThis.fetch=observedFetch;
 const snapshot=()=>({version:1,documentNonce,timeOrigin:performance.timeOrigin,rows:JSON.parse(JSON.stringify(rows)),dropped,errors,stopped});
 Object.defineProperty(globalThis,'__initialLoadReplacementObservation',{value:Object.freeze({snapshot,stop(){if(!stopped){stopped=true;for(const[target,name,fn]of listeners)target.removeEventListener(name,fn,{capture:true});if(globalThis.fetch===observedFetch)globalThis.fetch=originalFetch;else errors++;}return snapshot();}}),configurable:false,writable:false});
}
export function validateInitialLoadObservation(value,{beforeRelease=false,requestMs=5000,documentNonce=null}={}){
 const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===names.length&&names.every(n=>Object.hasOwn(v,n));
 const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
 assert(keys(value,['version','documentNonce','timeOrigin','rows','dropped','errors','stopped']));assert.equal(value.version,1);assert(uuid(value.documentNonce));if(documentNonce!==null)assert.equal(value.documentNonce,documentNonce,'Target document changed');
 assert(Number.isFinite(value.timeOrigin));assert.equal(value.dropped,0,'Lifecycle observation dropped');assert.equal(value.errors,0,'Lifecycle observation error');assert.equal(value.stopped,!beforeRelease,'Observer must remain active until final phase');assert(Array.isArray(value.rows)&&value.rows.length<=64);
 let previous=0;
 for(let i=0;i<value.rows.length;i++){
  const row=value.rows[i];assert.equal(row.sequence,i+1);assert(Number.isFinite(row.now)&&row.now>=previous);previous=row.now;
  if(row.kind==='fetch-start'){assert(keys(row,['sequence','kind','endpoint','method','now']));assert(['position','full','reconcile','presence','other-read','write'].includes(row.endpoint));assert(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(row.method));}
  else{assert.equal(row.kind,'lifecycle');assert(keys(row,['sequence','kind','event','trusted','persisted','readyState','visibility','now']));assert(['pageshow','pagehide','load','online','offline','visibilitychange'].includes(row.event));assert.equal(typeof row.trusted,'boolean');assert(row.persisted===null||typeof row.persisted==='boolean');assert(['loading','interactive','complete'].includes(row.readyState));assert(['visible','hidden','prerender'].includes(row.visibility));}
 }
 const pageShows=value.rows.filter(row=>row.kind==='lifecycle'&&row.event==='pageshow');
 if(beforeRelease){assert.equal(pageShows.length,0,'Target pageshow already fired before resource release');assert.equal(value.rows.filter(row=>row.kind==='fetch-start'&&['full','reconcile','write'].includes(row.endpoint)).length,0,'Read or repair already started before trusted pageshow');return value;}
 assert.equal(pageShows.length,1,'Exactly one target-document pageshow required');const show=pageShows[0];assert.equal(show.trusted,true,'Synthetic lifecycle event cannot qualify');assert.equal(show.persisted,false);assert.equal(show.readyState,'complete');assert.equal(show.visibility,'visible');assert(show.now<requestMs,'Fixture missed original initial-snapshot deadline');
 assert.equal(value.rows.filter(row=>row.kind==='lifecycle'&&['pagehide','online','offline','visibilitychange'].includes(row.event)&&row.sequence<=show.sequence).length,0,'Another lifecycle recovery may predate target pageshow');
 const reconciles=value.rows.filter(row=>row.kind==='fetch-start'&&row.endpoint==='reconcile');assert.equal(reconciles.length,1,'Exactly one owned read must be replaced');assert(reconciles[0].sequence>show.sequence&&reconciles[0].now>=show.now,'Reconciliation predates trusted pageshow');
 assert.equal(value.rows.filter(row=>row.kind==='fetch-start'&&row.endpoint==='full').length,0,'Extra legacy full-game load');assert.equal(value.rows.filter(row=>row.kind==='fetch-start'&&row.endpoint==='write').length,0,'No shared write belongs to initial load');return value;
}
export function ownedStateSync(message,{gameId,minimumEventSeq}){
 assert.equal(typeof message,'string');const body=JSON.parse(message);assert.equal(body.type,'state_sync');assert.equal(body.protocolVersion,2);assert.equal(body.gameId,gameId);assert.equal(body.game?.id,gameId);assert(Number.isSafeInteger(body.eventSeq)&&body.eventSeq>=minimumEventSeq);assert(validSyncSnapshot(body.game,gameId));return body;
}
export function readInitialLoadObservation(){
 const raw=window.__righeltLastError;
 return {native:globalThis.__initialLoadReplacementObservation?.stop()??null,lastError:{present:raw!==undefined&&raw!==null&&raw!=="",type:typeof raw,code:typeof raw==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(raw)?raw:null}};
}
export function validateReadCancellation({engine,errorText,forwardOrdinal,failureOrdinal,failureCount,released}){
 const allowed={chromium:['net::ERR_ABORTED'],firefox:['NS_BINDING_ABORTED'],webkit:['cancelled']};
 assert(Object.hasOwn(allowed,engine));assert.equal(failureCount,1,'Duplicate held request failure');assert.equal(released,false,'Failure arrived after held read release');
 assert(Number.isSafeInteger(forwardOrdinal)&&forwardOrdinal>0,'Failure preceded replacement frame');assert(Number.isSafeInteger(failureOrdinal)&&failureOrdinal>forwardOrdinal,'Failure must follow exact replacement-frame forwarding');
 assert(typeof errorText==='string'&&allowed[engine].includes(errorText),'Failure is not the original engine cancellation outcome');return true;
}
const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});let released=false;return{promise,release(){if(!released){released=true;release();}},get released(){return released;}};};
// Match the actual sync-store createWsUrl ownership rule: local HTTP sockets
// connect to the authoritative API variant; HTTPS remains on the page origin.
export function initialLoadSocketOrigin(baseURL){
 const url=new URL(baseURL);assert(['http:','https:'].includes(url.protocol));
 const protocol=url.protocol==='https:'?'wss':'ws',host=url.protocol!=='https:'&&isLocalDevHost(url.hostname)?buildLocalApiWsHost(url.port):url.host;
 return `${protocol}://${host}`;
}
export async function installInitialLoadReplacement(page,{baseURL,gameId,eventSeq,identityId,engine,inverseRecipe=null}){
 assert(['chromium','firefox','webkit'].includes(engine),'Unknown original engine');
 const origin=new URL(baseURL).origin,asset=INITIAL_LOAD_RECIPE.asset,assetGate=gate(),readGate=gate(),fault=createFaultLifecycle(),sockets=[],errors=[],rows=[],transforms=[],installed=[];
 let disposed=false,allowReplacement=false,heldRead=null,readCancelled=false,readHandled=false,assetRequested=false,assetHandled=false,htmlCount=0,positionResponse=null,sharedWrites=0,legacyReads=0,reconcileCount=0,dropped=0,forwardOrdinal=null,failureCount=0,cancellation=null;
 const note=(kind,data={})=>{if(rows.length===64){dropped++;return;}rows.push({sequence:rows.length+1,kind,...data});};
 const error=category=>{if(errors.length<16)errors.push(category);else dropped++;};
 const run=fn=>fault.run(async()=>{try{await fn();}catch(cause){error('owned-relay-failed');throw cause;}});
 const runRoute=(route,fn)=>run(async()=>{try{await fn();}catch(primary){try{await route.abort('failed');}catch(secondary){throw new AggregateError([primary,secondary],'Owned route failure/abort incomplete');}throw primary;}});
 const onFailed=request=>{if(request!==heldRead)return;failureCount++;let errorText=null;try{errorText=request.failure()?.errorText??null;if(typeof errorText!=='string'||errorText.length>4096){error('failure-text-unavailable');errorText=null;}}catch{error('failure-text-unavailable');}
  cancellation={engine,errorText,forwardOrdinal,failureOrdinal:rows.length+1,failureCount,released:readGate.released};note('held-read-requestfailed',cancellation);
  try{validateReadCancellation(cancellation);readCancelled=true;}catch{error('held-read-not-readiness-cancellation');}
 };
 const onRequest=request=>{const url=new URL(request.url());if(url.origin!==origin)return;const path=url.pathname;if(path===`/api/shell/games/${gameId}`&&request.method()==='GET')legacyReads++;if(path.startsWith(`/api/shell/games/${gameId}/`)&&request.method()!=='GET'&&!['reconcile','presence','decision-history','decision-snapshot','legal','piece-moves','history'].includes(path.split('/').at(-1)))sharedWrites++;};
 const onResponse=response=>{const request=response.request(),url=new URL(response.url());if(url.origin===origin&&url.pathname===`/api/shell/games/${gameId}/position`&&request.method()==='GET')positionResponse=response;};
 const mainFrame=page.mainFrame();
 const htmlMatch=url=>url.origin===origin&&url.pathname==='/'&&url.searchParams.get('initial-load-replacement')===gameId;
 const assetMatch=url=>url.origin===origin&&url.pathname===asset.path&&url.search===asset.query;
 const apiMatch=url=>url.origin===origin&&url.pathname===`/api/shell/games/${gameId}/reconcile`;
 const sourceMatch=url=>url.origin===origin&&url.pathname==='/shell/live-transport.js';
 const handlers=[
  [htmlMatch,route=>runRoute(route,async()=>{assert.equal(route.request().frame(),mainFrame);htmlCount++;assert.equal(htmlCount,1);const response=await route.fetch();assert.equal(response.status(),200);const raw=await response.text(),body=transformInitialLoadHtml(raw);transforms.push({kind:'html',rawSHA256:hash(raw),outputSHA256:hash(body)});await route.fulfill({response,body});})],
  [assetMatch,route=>runRoute(route,async()=>{assert.equal(route.request().frame(),mainFrame);assert.equal(assetRequested,false);assetRequested=true;const response=await route.fetch();assert.equal(response.status(),200);const body=verifyInitialLoadAsset(await response.body());transforms.push({kind:'asset',rawSHA256:hash(body),bytes:body.byteLength});await assetGate.promise;await route.fulfill({response,body});assetHandled=true;})],
  [apiMatch,route=>runRoute(route,async()=>{if(route.request().method()!=='POST')return route.continue();reconcileCount++;assert.equal(reconcileCount,1,'Unexpected extra reconciliation');heldRead=route.request();assert.equal(heldRead.frame(),mainFrame);const payload=heldRead.postDataJSON();assert.equal(payload.protocolVersion,2);assert.equal(payload.identityId,identityId);assert.equal(payload.knownSnapshotEventSeq,0);assert.deepEqual(payload.commands,[],'This read must own no saved command');note('reconcile-request');const response=await route.fetch({timeout:5000});assert.equal(response.status(),200);const body=await response.json();assert.equal(body.gameId,gameId);assert.equal(body.game?.id,gameId);assert(Number.isSafeInteger(body.eventSeq)&&body.eventSeq>=eventSeq);assert(validSyncSnapshot(body.game,gameId));note('real-reconcile200-held',{eventSeq:body.eventSeq});await readGate.promise;await route.fulfill({response});readHandled=true;})],
 ];
 if(inverseRecipe)handlers.push([sourceMatch,route=>runRoute(route,async()=>{const response=await route.fetch();assert.equal(response.status(),200);const raw=await response.text(),body=inverseInitialLoadSource(raw,inverseRecipe);transforms.push({kind:'inverse-loader',rawSHA256:hash(raw),outputSHA256:hash(body)});await route.fulfill({response,body});})]);
 const closeSocket=entry=>Promise.allSettled([Promise.resolve().then(()=>entry.client.close()),Promise.resolve().then(()=>entry.server.close())]).then(results=>{const failed=results.filter(x=>x.status==='rejected').map(x=>x.reason);if(failed.length)throw new AggregateError(failed,'Socket peer cleanup incomplete');});
 try{
  await page.addInitScript(installInitialLoadObserver,{gameId});page.on('requestfailed',onFailed);page.on('request',onRequest);page.on('response',onResponse);
  for(const[match,handler]of handlers){await page.route(match,handler);installed.push([match,handler]);}
  await page.routeWebSocket(url=>url.origin===initialLoadSocketOrigin(baseURL)&&url.pathname===`/api/shell/games/${encodeURIComponent(gameId)}/ws`,client=>{
   if(disposed){void run(()=>client.close());return;}
   const entry={client,server:client.connectToServer(),index:sockets.length,frames:[],pending:[],bytes:0,snapshot:null,eventSeq:null,maxGameEventSeq:null,closed:false,pageCloseForwarded:false,serverCloseForwarded:false};sockets.push(entry);note('socket-created',{index:entry.index});
   client.onClose((code,reason)=>run(async()=>{entry.closed=true;note('client-socket-closed',{index:entry.index});if(entry.pageCloseForwarded)return;entry.pageCloseForwarded=true;await entry.server.close({code,reason});}));
   entry.server.onClose((code,reason)=>run(async()=>{entry.closed=true;note('server-socket-closed',{index:entry.index});if(entry.serverCloseForwarded)return;entry.serverCloseForwarded=true;await entry.client.close({code,reason});}));
   entry.server.onMessage(message=>run(async()=>{
    if(disposed)return;assert.equal(typeof message,'string');assert(entry.frames.length<16,'Socket frame cap');entry.bytes+=Buffer.byteLength(message);assert(entry.bytes<=512*1024,'Socket byte cap');entry.frames.push({sha256:hash(message),bytes:Buffer.byteLength(message)});
    const parsed=JSON.parse(message);if(parsed.type==='state_sync'){ownedStateSync(message,{gameId,minimumEventSeq:eventSeq});entry.snapshot=message;entry.eventSeq=parsed.eventSeq;note('real-state-sync-held',{index:entry.index,sha256:hash(message)});}
    if(parsed.game){assert.equal(parsed.gameId,gameId);assert(Number.isSafeInteger(parsed.eventSeq)&&parsed.eventSeq>=eventSeq);assert(validSyncSnapshot(parsed.game,gameId));entry.maxGameEventSeq=Math.max(entry.maxGameEventSeq??0,parsed.eventSeq);}
    // First connection is held throughout. Every replacement byte remains held
    // until the test has observed the actual reconciliation request/server200.
    if(entry.index===1){if(allowReplacement)entry.client.send(message);else entry.pending.push(message);}
   }));
  });
 }catch(primary){disposed=true;assetGate.release();readGate.release();fault.stop();const cleanup=await Promise.allSettled([...installed.map(([m,h])=>Promise.resolve().then(()=>page.unroute(m,h))),...sockets.map(closeSocket),fault.dispose()]);for(const[n,h]of[['requestfailed',onFailed],['request',onRequest],['response',onResponse]])try{page.off(n,h);}catch(cause){cleanup.push({status:'rejected',reason:cause});}const failed=cleanup.filter(x=>x.status==='rejected').map(x=>x.reason);if(failed.length)throw new AggregateError([primary,...failed],'Initial-load setup/cleanup failed');throw primary;}
 const replacementReady=()=>{const read=rows.find(r=>r.kind==='real-reconcile200-held'),second=sockets[1];return Boolean(read&&sockets.length===2&&sockets[0].closed&&second.snapshot&&!second.closed&&second.maxGameEventSeq>=read.eventSeq);};
 const snapshot=()=>({version:1,replacementReady:replacementReady(),rows:copy(rows),errors:[...errors],dropped,transforms:copy(transforms),assetRequested,assetHandled,htmlCount,reconcileCount,readCancelled,readHandled,cancellation:copy(cancellation),legacyReads,sharedWrites,sockets:sockets.map(e=>({index:e.index,frames:copy(e.frames),hasStateSync:Boolean(e.snapshot),eventSeq:e.eventSeq,maxGameEventSeq:e.maxGameEventSeq,closed:e.closed})),disposed});
 const assertHealthy=()=>{assert.equal(errors.length,0,'Owned relay failed');assert.equal(dropped,0,'Owned relay observations dropped');assert.equal(page.mainFrame(),mainFrame,'Main frame changed');};
 return{
  snapshot,assertHealthy,
  async position(){assert(positionResponse,'Position response missing');assert.equal(positionResponse.status(),200);const body=await positionResponse.json();assert.equal(body.game?.id,gameId);assert.equal(body.game.positionOnly,true);assert(Number.isSafeInteger(body.eventSeq)&&body.eventSeq>=eventSeq);return body;},
  releaseAsset(){assertHealthy();assert.equal(assetGate.released,false);assert(assetRequested);assert.equal(reconcileCount,0,'Repair already exists before pageshow');assert.equal(legacyReads,0);assert(sockets.length===1&&sockets[0].snapshot&&!sockets[0].closed,'Original socket must still own the pending initial state');assetGate.release();},
  releaseReplacement(){assertHealthy();assert.equal(allowReplacement,false);assert.equal(reconcileCount,1);assert(rows.some(r=>r.kind==='real-reconcile200-held'));assert.equal(sockets.length,2);assert.equal(sockets[0].closed,true,'Original socket must have been retired');const second=sockets[1];assert(second.snapshot&&!second.closed);const read=rows.find(r=>r.kind==='real-reconcile200-held');assert(second.maxGameEventSeq>=read.eventSeq,'Replacement may not predate held response');allowReplacement=true;for(const message of second.pending){if(message===second.snapshot&&forwardOrdinal===null){forwardOrdinal=rows.length+1;note('replacement-frame-forward-start',{index:1,sha256:hash(message)});}second.client.send(message);}assert(forwardOrdinal!==null);const forwarded=second.pending.length;second.pending.length=0;note('replacement-state-forwarded',{index:1,sha256:hash(second.snapshot),messages:forwarded});},
  releaseRead(){assertHealthy();assert.equal(readGate.released,false);assert(readCancelled,'Only readiness cancellation may end the held read');validateReadCancellation(cancellation);readGate.release();},
  async dispose(){disposed=true;assetGate.release();readGate.release();fault.stop();const settled=await Promise.allSettled([...installed.map(([m,h])=>Promise.resolve().then(()=>page.unroute(m,h))),...sockets.map(closeSocket),Promise.resolve().then(()=>fault.dispose())]);for(const[n,h]of[['requestfailed',onFailed],['request',onRequest],['response',onResponse]])try{page.off(n,h);}catch(cause){settled.push({status:'rejected',reason:cause});}const failed=settled.filter(x=>x.status==='rejected').map(x=>x.reason);if(errors.length||dropped)failed.push(Error('Owned initial-load observation incomplete'));if(failed.length)throw new AggregateError(failed,'Initial-load relay cleanup failed');return snapshot();},
 };
}

// Start independent owned cleanup attempts before waiting for either one. Never
// replace a test failure with a later cleanup failure or hide either failure.
export async function settleInitialLoadResources(owner,context){
 const results=await Promise.allSettled([Promise.resolve().then(()=>owner?.dispose()??null),Promise.resolve().then(()=>context.close())]);
 return {relay:results[0].status==='fulfilled'?results[0].value:owner?.snapshot()??null,cleanup:results.map((result,index)=>({owner:index===0?'relay':'context',status:result.status})),errors:results.filter(result=>result.status==='rejected').map(result=>result.reason)};
}
