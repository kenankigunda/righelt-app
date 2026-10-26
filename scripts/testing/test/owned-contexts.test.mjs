import assert from 'node:assert/strict';
import test from 'node:test';
import {ownedContexts} from '../../../e2e/support/owned-contexts.mjs';

test('teardown closes only its owned contexts and forwards creation options',async()=>{
 const received=[],closed=[];
 const owned=ownedContexts({newContext:async options=>{received.push(options);return {close:async()=>closed.push(options.role)};}});
 await Promise.all(['owner','opponent','viewer'].map(role=>owned.create({role})));
 assert.deepEqual(closed,[]);
 await owned.close();
 assert.deepEqual(received,[{role:'owner'},{role:'opponent'},{role:'viewer'}]);
 assert.deepEqual(closed,['owner','opponent','viewer']);
 assert.throws(()=>owned.create({role:'late'}),/during teardown/);
});

test('partial setup failure still waits for and closes a pending successful context',async()=>{
 const setupError=Error('opponent creation failed'),closed=[];
 let resolvePending;
 const pending=new Promise(resolve=>{resolvePending=resolve;});
 const owned=ownedContexts({newContext:options=>options.role==='opponent'?Promise.reject(setupError):pending});
 const creation=Promise.all([owned.create({role:'owner'}),owned.create({role:'opponent'})]);
 await assert.rejects(creation,error=>error===setupError);
 const cleanup=owned.close();
 resolvePending({close:async()=>closed.push('owner')});
 await assert.rejects(cleanup,error=>error instanceof AggregateError&&error.errors[0]===setupError);
 assert.deepEqual(closed,['owner']);
});

test('one close failure does not skip other contexts and all cleanup failures surface',async()=>{
 const errors=[Error('first close failed'),Error('third close failed')],closed=[];
 const owned=ownedContexts({newContext:async({role})=>({close:()=>{
  closed.push(role);
  if(role!==1)throw errors[role===0?0:1];
 }})});
 await Promise.all([0,1,2].map(role=>owned.create({role})));
 await assert.rejects(owned.close(),error=>error instanceof AggregateError&&assert.deepEqual(error.errors,errors)===undefined);
 assert.deepEqual(closed,[0,1,2]);
});
