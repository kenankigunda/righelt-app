import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {INITIAL_LOAD_RECIPE,transformInitialLoadHtml,verifyInitialLoadAsset,inverseInitialLoadSource,installInitialLoadObserver,validateInitialLoadObservation,ownedStateSync,installInitialLoadReplacement,validateReadCancellation,readInitialLoadObservation,settleInitialLoadResources,initialLoadSocketOrigin} from '../../../e2e/support/initial-load-replacement.mjs';
import apiWorker from '../../api/index.js';
import {buildLocalApiWsHost,isLocalDevHost} from '../local-dev-ports.js';
import {LIVE_HISTORY} from '../generated/packages/shared-types/src/sync-protocol.js';
import {createFakeD1} from '../../../packages/api-handler/test/support/fake-d1.mjs';
import {createFakeGameRooms} from '../../../packages/api-handler/test/support/fake-game-rooms.mjs';
const root=new URL('../../../',import.meta.url),read=path=>fs.readFileSync(new URL(path,root)),hash=value=>createHash('sha256').update(value).digest('hex');
const nonce='d28ac53d-f8e0-4d6c-b924-b113049eaec2';
const clone=value=>JSON.parse(JSON.stringify(value));
test('actual HTML/asset recipe inserts only one eager real image and exactly inverts original modules/styles',()=>{
 const source=read('apps/web/index.html').toString(),recipe=INITIAL_LOAD_RECIPE.html,out=transformInitialLoadHtml(source);
 assert.equal(out.replace(recipe.after,recipe.before),source);assert.equal((out.match(/data-initial-load-pageshow-gate/g)??[]).length,1);
 assert(out.includes('loading="eager"'));assert(out.includes('<script type="module" src="./main.js"></script>'));
 for(const mutate of[r=>r.sourceSha256='0'.repeat(64),r=>r.outputSha256='0'.repeat(64),r=>r.count=2,r=>r.before='unknown']){const bad=clone(recipe);mutate(bad);assert.throws(()=>transformInitialLoadHtml(source,bad));}
 const bytes=read('apps/web/assets/opponents/friend-portrait.webp');assert.equal(verifyInitialLoadAsset(bytes),bytes);assert.throws(()=>verifyInitialLoadAsset(Buffer.concat([bytes,Buffer.from('x')])));assert.throws(()=>verifyInitialLoadAsset(bytes,{...INITIAL_LOAD_RECIPE.asset,sourceSha256:'0'.repeat(64)}));
});
function observer({fetcher=()=>Promise.resolve('original'),clockThrows=false}={}){
 let now=0;const listeners=new Map();const add=(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);};const remove=(name,fn)=>listeners.get(name)?.delete(fn);
 const doc={readyState:'interactive',visibilityState:'visible',addEventListener:add,removeEventListener:remove};const c=vm.createContext({crypto:{randomUUID:()=>nonce},location:{origin:'http://fixture.test',href:'http://fixture.test/?target=1#/game/owned'},document:doc,URL,performance:{timeOrigin:1000,now:()=>{if(clockThrows)throw Error('observation clock');return now;}},fetch:fetcher,addEventListener:add,removeEventListener:remove});
 vm.runInContext('('+installInitialLoadObserver.toString()+')({gameId:"owned"})',c);
 return{c,doc,listeners,api:c.__initialLoadReplacementObservation,at:value=>{now=value;},event(name,fields={}){for(const fn of listeners.get(name)??[])fn({type:name,isTrusted:true,persisted:false,...fields});}};
}
test('actual observer preserves original fetch receiver, argument objects and exact promise without reading body/header/signal',()=>{
 const result=Promise.resolve('same'),calls=[],receiver={};const original=function(...args){calls.push({receiver:this,args});return result;};const f=observer({fetcher:original});const options={method:'POST'};for(const name of['body','headers','signal'])Object.defineProperty(options,name,{get(){assert.fail('Additional '+name+' read');}});
 assert.equal(Reflect.apply(f.c.fetch,receiver,['/api/shell/games/owned/reconcile',options]),result);assert.equal(calls.length,1);assert.equal(calls[0].receiver,receiver);assert.equal(calls[0].args[1],options);assert.equal(f.api.snapshot().rows[0].endpoint,'reconcile');assert.equal(f.api.snapshot().errors,0);
});
test('URL and Request inputs fail only observation closed and forward untouched without stringification or URL/body reads',()=>{
 const result=Promise.resolve('same'),seen=[];const f=observer({fetcher:function(...args){seen.push(args);return result;}});const objects=[new URL('http://fixture.test/api/shell/games/owned/reconcile'),new Request('http://fixture.test/api/shell/games/owned/reconcile'),{get url(){assert.fail('Opaque URL getter');},toString(){assert.fail('Opaque stringification');}}];
 for(const input of objects)assert.equal(f.c.fetch(input),result);assert.equal(seen.length,3);objects.forEach((x,i)=>assert.equal(seen[i][0],x));assert.equal(f.api.snapshot().rows.length,0);assert.equal(f.api.snapshot().errors,3);
});
test('throwing observation and throwing original fetch preserve one original invocation/error',()=>{
 const failure=Error('original fetch'),calls=[];const f=observer({clockThrows:true,fetcher:function(...args){calls.push(args);throw failure;}});assert.throws(()=>f.c.fetch('/api/shell/games/owned/reconcile',{method:'POST'}),error=>error===failure);assert.equal(calls.length,1);assert.equal(f.api.snapshot().errors,1);
 const result=Promise.resolve(),g=observer({fetcher:()=>result}),options={get method(){assert.fail('Observer may not invoke method getter');}};assert.equal(g.c.fetch('/api/shell/games/owned/reconcile',options),result);assert.equal(g.api.snapshot().errors,1);
});
test('owned endpoint matching excludes lookalike identities/other origins and observer stop restores original fetch/listeners',()=>{
 const original=()=>Promise.resolve(),f=observer({fetcher:original});for(const path of['/api/shell/games/owned-other/reconcile','http://other.test/api/shell/games/owned/reconcile','/api/shell/games/other/reconcile'])f.c.fetch(path,{method:'POST'});assert.equal(f.api.snapshot().rows.length,0);
 f.c.fetch('/api/shell/games/owned/position');assert.equal(f.api.snapshot().rows[0].endpoint,'position');const copy=f.api.snapshot();copy.rows.length=0;assert.equal(f.api.snapshot().rows.length,1);assert.equal(Object.getOwnPropertyDescriptor(f.c,'__initialLoadReplacementObservation').writable,false);
 f.api.stop();assert.equal(f.c.fetch,original);assert([...f.listeners.values()].every(set=>set.size===0));assert.equal(f.api.stop().stopped,true);
});
function goodObservation(){const f=observer();f.at(20);f.c.fetch('/api/shell/games/owned/position');const before=clone(f.api.snapshot());f.doc.readyState='complete';f.at(200);f.event('load');f.at(201);f.event('pageshow');f.at(202);f.c.fetch('/api/shell/games/owned/reconcile',{method:'POST'});return{before,after:clone(f.api.stop())};}
test('browser-clock validity requires actual trusted initial pageshow before reconcile with same opaque document',()=>{
 const{before,after}=goodObservation();assert.equal(validateInitialLoadObservation(before,{beforeRelease:true}),before);assert.equal(validateInitialLoadObservation(after,{documentNonce:nonce}),after);
 for(const mutate of[v=>v.rows.find(r=>r.event==='pageshow').trusted=false,v=>v.rows.find(r=>r.event==='pageshow').persisted=true,v=>v.rows.find(r=>r.event==='pageshow').now=5000,v=>v.documentNonce='027019a0-65d9-4ce4-8b15-2785a369577c',v=>v.rows.find(r=>r.kind==='fetch-start').endpoint='full',v=>v.rows.find(r=>r.kind==='fetch-start').endpoint='write']){const bad=clone(after);mutate(bad);assert.throws(()=>validateInitialLoadObservation(bad,{documentNonce:nonce}));}
 const early=clone(before);early.rows.push({sequence:early.rows.length+1,kind:'fetch-start',endpoint:'reconcile',method:'POST',now:30});assert.throws(()=>validateInitialLoadObservation(early,{beforeRelease:true}));
 const wrongOrder=clone(after);const a=wrongOrder.rows.findIndex(r=>r.event==='pageshow'),b=wrongOrder.rows.findIndex(r=>r.endpoint==='reconcile');[wrongOrder.rows[a],wrongOrder.rows[b]]=[wrongOrder.rows[b],wrongOrder.rows[a]];wrongOrder.rows.forEach((r,i)=>{r.sequence=i+1;r.now=i;});assert.throws(()=>validateInitialLoadObservation(wrongOrder));
});
test('closed schema/caps/errors cannot report valid and no fields may carry arbitrary payload',()=>{
 const{after}=goodObservation();for(const mutate of[v=>v.secret='private',v=>v.rows[0].payload='private',v=>v.dropped=1,v=>v.errors=1,v=>v.rows[0].method='unknown',v=>v.rows[0].now=-1,v=>v.rows[0].sequence='1',v=>v.stopped=false]){const bad=clone(after);mutate(bad);assert.throws(()=>validateInitialLoadObservation(bad));}
 const f=observer();for(let n=0;n<65;n++){f.at(n);f.event('load');}const capped=f.api.stop();assert.equal(capped.rows.length,64);assert.equal(capped.dropped,1);assert.throws(()=>validateInitialLoadObservation(capped));
});
let accepted;
async function realGame(){if(!accepted){const env={DB:createFakeD1()};env.GAME_ROOMS=createFakeGameRooms(()=>env);const response=await apiWorker.fetch(new Request('https://test/api/shell/games',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identityId:'id-main-owner',selfPlayMode:false})}),env);assert(response.ok);accepted=await response.json();}return accepted;}
test('real accepted snapshot frame stays immutable and refuses wrong game/type/protocol/stale sequence',async()=>{
 const body=await realGame(),message=JSON.stringify({...body,protocolVersion:2,type:'state_sync',gameId:body.game.id});assert.equal(ownedStateSync(message,{gameId:body.game.id,minimumEventSeq:body.eventSeq}).game.id,body.game.id);assert.equal(JSON.parse(message).type,'state_sync');
 for(const fields of[{gameId:'other'},{protocolVersion:1},{type:'presence_changed'},{eventSeq:-1},{eventSeq:'1'},{game:{...body.game,id:'other'}}])assert.throws(()=>ownedStateSync(JSON.stringify({...JSON.parse(message),...fields}),{gameId:body.game.id,minimumEventSeq:body.eventSeq}));
});
test('private inverse removes ONLY actual new acceptance branch and all raw/range/output/inverse drift fails',()=>{
 const source=read('apps/web/shell/live-transport.js').toString(),start=source.indexOf('          if (error?.code === "recovery_superseded"'),end=source.indexOf('          // Retain bounded protocol discovery',start);assert(start>=0&&end>start);const before=source.slice(start,end),expected=source.slice(0,start)+source.slice(end),recipe={version:1,modulePath:'/shell/live-transport.js',sourceSha256:hash(source),outputSha256:hash(expected),operations:[{start,end,before,after:''}]};assert.equal(inverseInitialLoadSource(source,recipe),expected);assert.equal(expected.slice(0,start)+before+expected.slice(start),source);assert(expected.includes('if (error.status !== 404 && error.status !== 405) throw error;'));
 for(const mutate of[r=>r.sourceSha256='0'.repeat(64),r=>r.outputSha256='0'.repeat(64),r=>r.operations[0].start++,r=>r.operations[0].after='changed',r=>r.operations.push({...r.operations[0]})]){const bad=clone(recipe);mutate(bad);assert.throws(()=>inverseInitialLoadSource(source,bad));}
});
const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
async function relayFixture({unrouteFails=false,closeFails=false,baseURL='http://fixture.test'}={}){
 const body=await realGame(),frame={},listeners=new Map(),routes=[],wire=[],calls=[],cause=Error('unroute failure'),peerCause=Error('peer failure');let socketHandler,socketMatch;
 const page={mainFrame:()=>frame,on(n,f){listeners.set(n,f);},off(n,f){assert.equal(listeners.get(n),f);listeners.delete(n);},async addInitScript(fn,args){assert.equal(fn,installInitialLoadObserver);assert.equal(args.gameId,body.game.id);},async route(match,handler){routes.push({match,handler});},async unroute(match,handler){assert(routes.some(r=>r.match===match&&r.handler===handler));calls.push('unroute');if(unrouteFails&&calls.filter(x=>x==='unroute').length===1)throw cause;},async routeWebSocket(match,handler){socketMatch=match;socketHandler=handler;}};
 const owner=await installInitialLoadReplacement(page,{baseURL,gameId:body.game.id,eventSeq:body.eventSeq,identityId:'id-main-owner',engine:'chromium'});
 function socket(url=initialLoadSocketOrigin(baseURL)+'/api/shell/games/'+encodeURIComponent(body.game.id)+'/ws'){assert.equal(socketMatch(new URL(url)),true,'Real URL must match captured owned WebSocket route');const sent=[],server={onMessage(fn){this.message=fn;},onClose(fn){this.closed=fn;},async close(){calls.push('server-close');if(closeFails)throw peerCause;}},client={connectToServer:()=>server,onClose(fn){this.closed=fn;},send:message=>sent.push(message),async close(){calls.push('client-close');}};socketHandler(client);const value={server,client,sent};wire.push(value);return value;}
 function request(path,{method='GET',payload=null,text='',bytes=Buffer.alloc(0),json={}}={}){const url=baseURL+path,original={url:()=>url,method:()=>method,frame:()=>frame,postDataJSON:()=>payload,failure:()=>({errorText:'net::ERR_ABORTED'})},events=[],response={status:()=>200,text:async()=>text,body:async()=>bytes,json:async()=>json,request:()=>original,url:()=>url};const route={request:()=>original,async fetch(){events.push('fetch');return response;},async fulfill(){events.push('fulfill');},async abort(){events.push('abort');},async continue(){events.push('continue');}};const found=routes.find(r=>r.match(new URL(url)));assert(found,'Owned route missing');const work=found.handler(route);return{work,original,events,response};}
 return{body,owner,page,frame,listeners,routes,wire,calls,cause,peerCause,socket,request,matchesSocket:url=>socketMatch(new URL(url))};
}
test('actual owned relay preserves source HTML/asset and exact first-versus-current socket bytes, then exact cancellation identity',async()=>{
 const f=await relayFixture(),{game, eventSeq}=f.body;const html=f.request('/?initial-load-replacement='+game.id,{text:read('apps/web/index.html').toString()});await html.work;
 const asset=f.request(INITIAL_LOAD_RECIPE.asset.path+INITIAL_LOAD_RECIPE.asset.query,{bytes:read('apps/web/assets/opponents/friend-portrait.webp')});await flush();const first=f.socket(),message=JSON.stringify({...f.body,protocolVersion:2,type:'state_sync',gameId:game.id});await first.server.message(message);assert.equal(first.sent.length,0);f.owner.releaseAsset();await asset.work;assert.equal(f.owner.snapshot().assetHandled,true);await first.client.closed(1000,'');const second=f.socket();await second.server.message(message);const presence=JSON.stringify({...f.body,protocolVersion:2,type:'presence_changed',gameId:game.id,eventSeq:eventSeq+1});await second.server.message(presence);
 const readRequest=f.request('/api/shell/games/'+game.id+'/reconcile',{method:'POST',payload:{protocolVersion:2,identityId:'id-main-owner',knownSnapshotEventSeq:0,commands:[]},json:{...f.body,protocolVersion:2,gameId:game.id,eventSeq:eventSeq+1,commandOutcomes:[]}});await flush();assert.equal(f.owner.snapshot().replacementReady,true);f.owner.releaseReplacement();assert.deepEqual(second.sent,[message,presence]);assert.equal(first.sent.length,0);assert.throws(()=>f.owner.releaseRead());f.listeners.get('requestfailed')({});assert.equal(f.owner.snapshot().readCancelled,false);f.listeners.get('requestfailed')(readRequest.original);f.owner.releaseRead();await readRequest.work;assert.equal(f.owner.snapshot().readHandled,true);assert.deepEqual(readRequest.events,['fetch','fulfill']);await f.owner.dispose();assert.equal(f.listeners.size,0);assert.equal(f.calls.filter(x=>x==='unroute').length,3);
});
test('early fixture errors release every held gate and attempt every route/socket cleanup despite independent failures',async()=>{
 const f=await relayFixture({unrouteFails:true,closeFails:true}),socket=f.socket();const asset=f.request(INITIAL_LOAD_RECIPE.asset.path+INITIAL_LOAD_RECIPE.asset.query,{bytes:read('apps/web/assets/opponents/friend-portrait.webp')});await flush();assert.equal(asset.events.includes('fulfill'),false);let failure;try{await f.owner.dispose();}catch(error){failure=error;}assert(failure instanceof AggregateError);assert(failure.errors.includes(f.cause));assert(f.calls.includes('client-close'));assert(f.calls.includes('server-close'));assert.equal(f.calls.filter(x=>x==='unroute').length,3);assert.equal(f.listeners.size,0);await asset.work;assert(asset.events.includes('fulfill'));
});
test('unknown served source aborts owned route and preserves original failure through later lifecycle cleanup',async()=>{
 const f=await relayFixture();const unknown=f.request('/?initial-load-replacement='+f.body.game.id,{text:'unknown HTML'});await unknown.work;assert(unknown.events.includes('abort'));assert(f.owner.snapshot().errors.length);assert.throws(()=>f.owner.assertHealthy());await assert.rejects(f.owner.dispose(),AggregateError);
});


test('exact cancellation must follow replacement forwarding and reject early, missing, timeout and duplicate failures',()=>{
 for(const[engine,errorText]of[['chromium','net::ERR_ABORTED'],['firefox','NS_BINDING_ABORTED'],['webkit','cancelled']])assert.equal(validateReadCancellation({engine,errorText,forwardOrdinal:4,failureOrdinal:5,failureCount:1,released:false}),true);
 const good={engine:'chromium',errorText:'net::ERR_ABORTED',forwardOrdinal:4,failureOrdinal:5,failureCount:1,released:false};for(const change of[{forwardOrdinal:null},{failureOrdinal:3},{failureCount:2},{released:true},{errorText:null},{errorText:'net::ERR_TIMED_OUT'},{errorText:'net::ERR_CONNECTION_RESET'},{errorText:'NS_BINDING_ABORTED'},{engine:'unknown'}])assert.throws(()=>validateReadCancellation({...good,...change}));
});
test('actual error readback rejects every meaningful unexpected error without retaining private free text',()=>{
 for(const raw of[undefined,null,'','recovery_superseded','unknown_load_problem','private email@example.test',{}]){
  const f=observer();f.c.window=f.c;f.c.__righeltLastError=raw;const result=vm.runInContext('('+readInitialLoadObservation.toString()+')()',f.c);assert.equal(result.lastError.present,raw!==undefined&&raw!==null&&raw!=='');assert(!JSON.stringify(result).includes('email@example.test'));if(raw==='recovery_superseded')assert.equal(result.lastError.code,raw);
 }
});

test('actual independent cleanup starts context closure even while relay disposal waits and preserves both failures',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;}),relayFailure=Error('relay failure'),contextFailure=Error('context failure'),calls=[],snapshot={disposed:true};
 const work=settleInitialLoadResources({async dispose(){calls.push('relay');await pending;throw relayFailure;},snapshot:()=>snapshot},{async close(){calls.push('context');release();throw contextFailure;}});
 const result=await work;assert.deepEqual(calls,['relay','context']);assert.equal(result.relay,snapshot);assert.deepEqual(result.errors,[relayFailure,contextFailure]);assert.deepEqual(result.cleanup,[{owner:'relay',status:'rejected'},{owner:'context',status:'rejected'}]);
 const healthy=await settleInitialLoadResources({dispose:async()=>snapshot},{close:async()=>{}});assert.equal(healthy.relay,snapshot);assert.deepEqual(healthy.errors,[]);
});

test('actual createWsUrl source reaches the captured relay on authoritative local API origin and HTTPS same-origin only',async()=>{
 const source=read('apps/web/shell/sync-store.js').toString(),anchor='const createWsUrl = ',endAnchor='\nconst createPresenceUrl = ';assert.equal(source.split(anchor).length-1,1);const start=source.indexOf(anchor),end=source.indexOf(endAnchor,start);assert(end>start);const expression=source.slice(start+anchor.length,end).trim().replace(/;$/,'');assert.equal(hash(expression),'ab3b9a119b9302809241809455b60612e5935725a3f5bb06590130d7c8b17672');
 for(const baseURL of['http://127.0.0.1:9888','https://127.0.0.1:9888','https://fixture.test']){
  const f=await relayFixture({baseURL}),context={window:{location:new URL(baseURL)},URLSearchParams,buildLocalApiWsHost,isLocalDevHost,LIVE_HISTORY},createWsUrl=vm.runInNewContext('('+expression+')',context),actual=createWsUrl({identityId:'id-main-owner',gameId:f.body.game.id,sessionId:'owned-session',lastEventSeq:0});
  assert.equal(f.matchesSocket(actual),true);f.socket(actual);const url=new URL(actual);
  if(baseURL==='http://127.0.0.1:9888'){assert.equal(url.origin,'ws://127.0.0.1:9887');const oldOrigin=new URL(baseURL).origin.replace(/^http/,'ws');assert.equal(url.origin===oldOrigin,false,'Old web-origin matcher misses real local API socket');const wrongWeb=new URL(actual);wrongWeb.port='9888';assert.equal(f.matchesSocket(wrongWeb.href),false);}
  else assert.equal(url.origin,new URL(baseURL).origin.replace(/^https/,'wss'));
  for(const mutate of[u=>u.pathname='/api/shell/games/other/ws',u=>u.hostname='unowned.test',u=>u.protocol=u.protocol==='ws:'?'wss:':'ws:']){const bad=new URL(actual);mutate(bad);assert.equal(f.matchesSocket(bad.href),false);}
  await f.owner.dispose();
 }
});

// Exact owned cancellation from CI 42433947906, WebKit job 128588646777.
const linuxWebKitReadCancellation=Object.freeze({engine:'webkit',errorText:'Load request cancelled',forwardOrdinal:10,failureOrdinal:12,failureCount:1,released:false});
test('Linux WebKit exact owned replacement cancellation is accepted',()=>{
 assert.equal(validateReadCancellation({...linuxWebKitReadCancellation}),true);
});
test('Linux WebKit cancellation wording preserves exact engine, ordering, cardinality and unreleased-read guards',()=>{
 for(const change of[
  {engine:'chromium'},{engine:'firefox'},{engine:'unknown'},
  {forwardOrdinal:null},{forwardOrdinal:0},{forwardOrdinal:1.5},
  {failureOrdinal:10},{failureOrdinal:9},{failureOrdinal:null},
  {failureCount:0},{failureCount:2},{released:true},
  {errorText:null},{errorText:'Load request cancelled '},{errorText:'load request cancelled'},
  {errorText:'Load request canceled'},{errorText:'net::ERR_TIMED_OUT'},{errorText:'net::ERR_CONNECTION_RESET'},
 ])assert.throws(()=>validateReadCancellation({...linuxWebKitReadCancellation,...change}));
 for(const field of['engine','errorText','forwardOrdinal','failureOrdinal','failureCount','released']){
  const incomplete={...linuxWebKitReadCancellation};delete incomplete[field];assert.throws(()=>validateReadCancellation(incomplete));
 }
});
