import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installGuardedHeightPublication} from '../../../browser-integration/support/height-publication-observer.mjs';
const recipe=JSON.parse(readFileSync(new URL('../../../browser-integration/support/height-publication-recipe.json',import.meta.url),'utf8'));
const source=readFileSync(new URL('../../../apps/web/board/message-height.js',import.meta.url),'utf8');
async function fixture({rejectUnroute=false}={}){let handler,unroutes=0;const context={async addInitScript(){},async route(_matches,fn){handler=fn;},async unroute(_matches,fn){assert.equal(fn,handler);unroutes++;if(rejectUnroute)throw Error('unroute failure');}};const owner=await installGuardedHeightPublication({context,baseURL:'http://127.0.0.1:10188',recipe});return {owner,route:request=>handler(request),unroutes:()=>unroutes};}
test('disposing the exact guarded route waits for its already-running original request',async()=>{
 const f=await fixture();let release,fetches=0,fulfills=0,finished=false;const held=new Promise(resolve=>{release=resolve;});
 const task=f.route({async fetch(){fetches++;await held;return {status:()=>200,text:async()=>source};},request:()=>({method:()=> 'GET'}),async fulfill(){fulfills++;}});
 const disposal=f.owner.dispose().then(()=>{finished=true;});await Promise.resolve();assert.equal(finished,false);assert.equal(f.owner.metadata().pending,1);
 release();await task;await disposal;assert.equal(fetches,1);assert.equal(fulfills,1);assert.equal(f.unroutes(),1);assert.equal(f.owner.metadata().pending,0);assert.equal(f.owner.metadata().incomplete,false);
});
test('owned fetch failure is drained and remains an explicit incomplete binding',async()=>{
 const f=await fixture();const task=f.route({async fetch(){throw Error('transport');}});await assert.rejects(task,/transport/);await f.owner.dispose();assert.equal(f.owner.metadata().pending,0);assert(f.owner.metadata().issues.includes('route-error'));assert.equal(f.owner.metadata().incomplete,true);
});
test('source mismatch forwards the original response once but never receives transformed credit',async()=>{
 const f=await fixture();let fetches=0,fulfills=0;await f.route({async fetch(){fetches++;return {status:()=>200,text:async()=>source+' '};},request:()=>({method:()=> 'GET'}),async fulfill(){fulfills++;}});await f.owner.dispose();assert.equal(fetches,1);assert.equal(fulfills,1);assert.equal(f.owner.metadata().transformed,0);assert.deepEqual(f.owner.metadata().issues,['binding']);assert.equal(f.owner.metadata().incomplete,true);
});

test('unroute failure still drains an already-running owned request before propagating',async()=>{
 const f=await fixture({rejectUnroute:true});let release,finished=false;
 const held=new Promise(resolve=>{release=resolve;});
 const task=f.route({async fetch(){await held;return {status:()=>200,text:async()=>source};},request:()=>({method:()=> 'GET'}),async fulfill(){}});
 const disposal=assert.rejects(f.owner.dispose(),/unroute failure/).then(()=>{finished=true;});
 await Promise.resolve();await Promise.resolve();assert.equal(finished,false);assert.equal(f.owner.metadata().pending,1);
 release();await task;await disposal;assert.equal(finished,true);assert.equal(f.owner.metadata().pending,0);
});
