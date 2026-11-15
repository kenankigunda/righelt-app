import test from 'node:test';
import assert from 'node:assert/strict';
import {RunpodCleanup} from '../external-cleanup.mjs';

function api({missingAfterCancel=false,wrongPodOwner=false,incomplete=false}={}){
 let deployed=false,deleted=false;const calls=[];
 const fetcher=async(url,options={})=>{
  const p=new URL(url),method=options.method??'GET';calls.push({path:p.pathname,method});
  assert.equal(p.origin,'https://api.runpod.io');assert.notEqual(method,'POST');
  if(p.pathname==='/v2/queued-pods'){
   if(incomplete)return Response.json({queuedPods:[],pagination:{hasNextPage:true}});
   return Response.json({queuedPods:p.searchParams.has('cursor')?[{id:'q',name:'owned',status:deployed?'DEPLOYED':'QUEUED',podId:deployed?'late':null}]:[{id:'other',name:'other',status:'QUEUED',podId:null}],pagination:p.searchParams.has('cursor')?{hasNextPage:false}:{hasNextPage:true,nextCursor:'opaque/+='}});
  }
  if(p.pathname==='/v2/queued-pods/q'){
   if(method==='DELETE'){deployed=true;return new Response(null,{status:204});}
   if(deployed&&missingAfterCancel)return new Response(null,{status:404});
   return Response.json({id:'q',name:'owned',status:deployed?'DEPLOYED':'QUEUED',podId:deployed?'late':null});
  }
  if(p.pathname==='/v2/pods/late'){
   if(method==='DELETE'){deleted=true;return new Response(null,{status:204});}
   return deleted?new Response(null,{status:404}):Response.json({id:'late',name:wrongPodOwner?'unrelated':'owned'});
  }
  throw Error('unexpected request');
 };
 return {provider:new RunpodCleanup({token:'private',accountId:'account',fetcher}),calls};
}
test('queued cleanup completes pagination and cancels then rereads a scheduler race before terminating the exact Pod',async()=>{
 const f=api(),records=await f.provider.listQueued();assert.equal(records.length,2);
 const owned=records.find(r=>r.name==='owned');await f.provider.cancelQueued(owned.id,owned.name);
 assert.equal(await f.provider.inspect('late'),null);
 assert.deepEqual(f.calls.filter(c=>c.method==='DELETE').map(c=>c.path),['/v2/queued-pods/q','/v2/pods/late']);
 assert.equal((await f.provider.listQueued()).find(r=>r.id==='other').status,'QUEUED');
});
test('queued cleanup never treats vanished cancellation metadata or an unrelated resulting Pod as verified cleanup',async()=>{
 const missing=api({missingAfterCancel:true});await assert.rejects(missing.provider.cancelQueued('q','owned'),/unresolved/);assert.equal(missing.calls.some(c=>c.path==='/v2/pods/late'&&c.method==='DELETE'),false);
 const wrong=api({wrongPodOwner:true});await assert.rejects(wrong.provider.cancelQueued('q','owned'),/unrelated/);assert.equal(wrong.calls.some(c=>c.path==='/v2/pods/late'&&c.method==='DELETE'),false);
 const incomplete=api({incomplete:true});await assert.rejects(incomplete.provider.listQueued(),/cursor missing/);
});
