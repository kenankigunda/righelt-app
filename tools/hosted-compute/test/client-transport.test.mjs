import test from 'node:test';
import assert from 'node:assert/strict';
import {Client,InfrastructureError} from '../client.mjs';
import {sha256} from '../policy.mjs';
test('safe reads and worker heartbeat recover one transient without retrying unsafe admin/claim writes',async()=>{
 for(const [action,body,generation,safe] of [['work',undefined,1,true],['heartbeat',{},1,true],['claim',{key:'a'.repeat(64)},1,false],['manual-prepare',{},undefined,false]]){
  const calls=[],client=new Client({url:'https://compute.example',id:'public',token:'private',generation,fetcher:async(url,options)=>{calls.push({url,options});if(calls.length===1)throw Error('lost');return Response.json({ok:true});}});
  if(safe){assert.equal((await client.json(action,body)).ok,true);assert.equal(calls.length,2);assert.equal(calls[0].options.body,calls[1].options.body);}
  else{await assert.rejects(client.json(action,body),InfrastructureError);assert.equal(calls.length,1);}
 }
});
test('identical hash-bound upload handles a lost response once and checksum/auth failures abort immediately',async()=>{
 const bytes=new TextEncoder().encode('invented-prefix'),hash=await sha256(bytes),calls=[];
 const client=new Client({url:'https://compute.example',id:'public',token:'private',generation:1,fetcher:async(url,options)=>{calls.push({url,options});if(calls.length===1)throw Error('lost accepted upload');return Response.json({sha256:hash,bytes:bytes.length});}});
 assert.equal((await client.upload(bytes)).sha256,hash);assert.equal(calls.length,2);assert.equal(calls[0].url,calls[1].url);assert.deepEqual(calls[0].options.body,calls[1].options.body);
 for(const response of [()=>new Response(null,{status:401}),()=>Response.json({sha256:'f'.repeat(64),bytes:bytes.length})]){
  let count=0;client.fetcher=async()=>{count++;return response();};await assert.rejects(client.upload(bytes));assert.equal(count,1);
 }
});
test('safe interrupted response body retries within three total attempts and sustained unavailability stops',async()=>{
 let count=0;const client=new Client({url:'https://compute.example',id:'public',token:'private',fetcher:async()=>{count++;return count===1?{ok:true,status:200,json:async()=>{throw Error('broken stream');}}:Response.json({ok:true});}});
 assert.equal((await client.json('status')).ok,true);assert.equal(count,2);
 count=0;client.fetcher=async()=>{count++;return new Response('not json',{status:200});};await assert.rejects(client.json('status'),/response malformed/);assert.equal(count,1);
 count=0;client.fetcher=async()=>{count++;return new Response(null,{status:503});};await assert.rejects(client.json('status'),InfrastructureError);assert.equal(count,3);
});
test('safe retries are clamped to remaining authority and never renew the elapsed window',async()=>{
 let now=0,count=0;
 const client=new Client({url:'https://compute.example',id:'public',token:'private',clock:()=>now,deadline:()=>15,
  fetcher:async()=>{count++;now+=10;throw Error('lost');}});
 await assert.rejects(client.json('status'),InfrastructureError);assert.equal(count,2);
 count=0;now=15;await assert.rejects(client.json('status'),InfrastructureError);assert.equal(count,0);
 now=0;client.deadline=()=>Infinity;client.fetcher=async()=>{count++;now+=61000;throw Error('lost');};
 await assert.rejects(client.json('status'),InfrastructureError);assert.equal(count,2);
});
test('settlement repeats identical content but work creation remains single dispatch',async()=>{
 let count=0;const bodies=[];
 const client=new Client({url:'https://compute.example',id:'public',token:'private',generation:1,
  fetcher:async(_url,options)=>{count++;bodies.push(options.body);if(count<3)throw Error('lost');return Response.json({settled:true});}});
 const body={key:'a'.repeat(64),result:{sha256:'b'.repeat(64),bytes:1,name:'result'}};
 assert.equal((await client.json('settle',body)).settled,true);assert.equal(count,3);assert.equal(new Set(bodies).size,1);
});
