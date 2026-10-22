import test from 'node:test';
import assert from 'node:assert/strict';
import {executeFixtureRequest} from './auth-fixture-request.mjs';
import {createAuthFixtureControl} from './auth-fixture-control.mjs';
const input = {url:'http://localhost/private',token:'secret-token',sql:'SECRET SQL',operation:'/reset-limits'};
for (const [name, request] of [
 ['http', async()=>new Response(JSON.stringify({error:'local_api_unavailable',secret:'secret-token'}),{status:503,headers:{'x-request-id':'12345678-1234-1234-1234-123456789abc'}})],
 ['non-json',async()=>new Response('secret-token SECRET SQL',{status:500})],
 ['transport',async()=>{throw Error('secret-token SECRET SQL');}],
]) test(`fixture ${name} is diagnosed once and remains a failed control`,async()=>{
 let calls=0; const logs=[];
 const handler=createAuthFixtureControl((sql,operation)=>executeFixtureRequest({...input,sql,operation},{request:async(...args)=>{calls++;return request(...args);},report:s=>logs.push(s)}));
 const response={writeHead(status){this.status=status;return this;},end(){}};
 await handler({method:'POST',url:'/reset-limits',headers:{}},response);
 assert.equal(response.status,500);assert.equal(calls,1);assert.equal(logs.length,1);
 assert.doesNotMatch(logs[0],/secret-token|SECRET SQL|localhost/);
 const detail=JSON.parse(logs[0].split('] ')[1]); assert.equal(detail.operation,'/reset-limits');assert.ok(Date.parse(detail.timestamp));
 if(name==='http'){assert.equal(detail.status,503);assert.equal(detail.error,'local_api_unavailable');assert.equal(detail.requestId,'12345678-1234-1234-1234-123456789abc');}
 if(name==='non-json')assert.equal(detail.response,'non-json');
 if(name==='transport')assert.equal(detail.kind,'transport');
});
test('successful fixture preserves authenticated request and produces no failure',async()=>{
 let calls=0;await executeFixtureRequest(input,{request:async(url,options)=>{calls++;assert.equal(url,input.url);assert.equal(options.body,input.sql);assert.equal(options.headers['x-righelt-fixture'],input.token);return new Response('done');},report:()=>assert.fail('unexpected diagnostic')});assert.equal(calls,1);
});
