import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {expect as actualExpect} from '@playwright/test';
const source=readFileSync(new URL('../../../e2e/workflows/mobile-board-history.spec.mjs',import.meta.url),'utf8');
const start=source.indexOf('const expectAcceptedShared = '),end=source.indexOf('const board = ',start);
assert(start>=0&&end>start);
const envelope=Object.freeze({protocolVersion:2,gameId:'bound-game',identityId:'bound-identity',clientCommandId:'bound-command',kind:'shared',fingerprint:'bound-fingerprint',payload:{operation:'revert-request',values:{moveId:'bound-move'}}});
const accepted={outcome:'accepted',clientCommandId:envelope.clientCommandId,fingerprint:envelope.fingerprint};
function harness(responses,command=envelope){
 const reads=[];let jsonReads=0;
 const expect=value=>actualExpect(value);
 // Only the synthetic control uses a short clock. The actual helper retains
 // its unmodified project-default10s expect.poll and native60s case budget.
 // The1s synthetic bound allows ordinary CI scheduling; it changes no app policy.
 expect.poll=generator=>actualExpect.poll(generator,{timeout:1000,intervals:[1]});
 const fetch=async(url,options)=>{
  reads.push({url,options});const value=responses[Math.min(reads.length-1,responses.length-1)];
  if(value instanceof Error)throw value;
  return {ok:value.status>=200&&value.status<300,status:value.status,json:async()=>{jsonReads++;if(value.jsonError)throw value.jsonError;return value.body;}};
 };
 const page={evaluate:(fn,arg)=>vm.runInNewContext(`(${fn.toString()})(payload)`,{payload:arg,fetch})};
 const request={postDataJSON:()=>command,headers:()=>({'x-righelt-request-id':'original-correlation','x-righelt-storage-generation':'original-storage','content-type':'discarded-original'})};
 const invoke=new Function('expect',source.slice(start,end)+';return expectAcceptedShared;')(expect);
 return {reads,invoke:()=>invoke(page,envelope.gameId,request),get jsonReads(){return jsonReads;}};
}
test('observed503 followed by exact accepted receipt is sampled within existing poll',async()=>{
 const h=harness([{status:503},{status:200,body:{commandOutcomes:[accepted]}}]);await h.invoke();assert.equal(h.reads.length,2);assert.equal(h.jsonReads,1);
});
test('503 alone never supplies an accepted receipt',async()=>{
 const h=harness([{status:503}]);await assert.rejects(h.invoke());assert(h.reads.length>=1);assert.equal(h.jsonReads,0);
});
test('every other non-ok HTTP remains fatal on its first sample',async()=>{
 for(const status of [400,401,403,404,409,429,500,502,504]){
  const h=harness([{status},{status:200,body:{commandOutcomes:[accepted]}}]);await assert.rejects(h.invoke(),new RegExp(`HTTP ${status}`));assert.equal(h.reads.length,1);
 }
});
test('network and malformed JSON errors remain fatal',async()=>{
 for(const value of [Error('controlled network failure'),{status:200,jsonError:Error('controlled JSON failure')}]){
  const h=harness([value,{status:200,body:{commandOutcomes:[accepted]}}]);await assert.rejects(h.invoke(),/controlled/);assert.equal(h.reads.length,1);
 }
});
test('missing rejected or mismatched durable receipts cannot qualify',async()=>{
 for(const body of [{},{commandOutcomes:[]},{commandOutcomes:[{...accepted,outcome:'rejected'}]},{commandOutcomes:[{...accepted,clientCommandId:'foreign'}]},{commandOutcomes:[{...accepted,fingerprint:'foreign'}]}]){
  const h=harness([{status:200,body}]);await assert.rejects(h.invoke());
 }
});
test('all poll samples retain the exact original envelope and only call reconcile',async()=>{
 const h=harness([{status:503},{status:200,body:{commandOutcomes:[]}},{status:200,body:{commandOutcomes:[accepted]}}]);await h.invoke();assert.equal(h.reads.length,3);
 for(const {url,options} of h.reads){assert.equal(url,'/api/shell/games/bound-game/reconcile');assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{protocolVersion:2,identityId:envelope.identityId,knownSnapshotEventSeq:0,commands:[envelope]});assert.equal(options.headers['x-righelt-request-id'],'original-correlation');assert.equal(options.headers['x-righelt-storage-generation'],'original-storage');assert.equal(options.headers['content-type'],'application/json');}
});
test('nonshared captured commands still fail before any receipt request',async()=>{
 const h=harness([{status:200,body:{commandOutcomes:[accepted]}}],{...envelope,kind:'move'});await assert.rejects(h.invoke());assert.equal(h.reads.length,0);
});
