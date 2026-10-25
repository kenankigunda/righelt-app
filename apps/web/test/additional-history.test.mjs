import test from 'node:test';import assert from 'node:assert/strict';
import {createAdditionalHistory} from '../shell/additional-history.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(){
 let generation=1,revision=7,owner={};const calls=[],changes=[];
 const history=createAdditionalHistory({getScope:gameId=>({gameId,generation,revision,owner}),load:(scope,values)=>{const work=deferred();calls.push({scope,values,...work});return work.promise;},onChange:id=>changes.push(id)});
 const reply=(index,body)=>calls[index].resolve({gameplayRevision:revision,partial:false,...body});
 return{history,calls,changes,reply,account:()=>{generation++;},revision:()=>{revision++;},owner:()=>{owner={};}};
}

test('ordinary history discovers empty availability once without private notes or page prefetch',async()=>{
 const f=fixture();const work=f.history.ensure('g');await Promise.resolve();
 const duplicate=f.history.ensure('g');assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].values,{metadataOnly:true,cursor:null,historyRevision:7});
 f.reply(0,{available:false,items:[],nextCursor:null});await work;await duplicate;
 assert.equal(f.history.snapshot('g').available,false);await f.history.ensure('g');assert.equal(f.calls.length,1);
});
test('pages accumulate exactly once and exhaustion never resets to page one',async()=>{
 const f=fixture();let work=f.history.ensure('g');await Promise.resolve();f.reply(0,{available:true,items:[],nextCursor:null});await work;
 work=f.history.more('g');await Promise.resolve();f.reply(1,{available:true,items:[{id:'a'},{id:'b'}],nextCursor:{eventSeq:2,ordinal:0}});await work;
 work=f.history.more('g');await Promise.resolve();assert.deepEqual(f.calls[2].values.cursor,{eventSeq:2,ordinal:0});
 f.reply(2,{available:true,items:[{id:'b'},{id:'c',move:{undone:true}}],nextCursor:null});await work;
 assert.deepEqual(f.history.snapshot('g').items.map(x=>x.id),['a','b','c']);assert.equal(f.history.snapshot('g').items[2].move.undone,true);
 await f.history.more('g');await f.history.ensure('g');assert.equal(f.calls.length,3);assert.equal(f.history.snapshot('g').cursor,null);
});
test('a real page failure preserves earlier records and retries the failed cursor',async()=>{
 const f=fixture();let work=f.history.ensure('g');await Promise.resolve();f.reply(0,{available:true});await work;
 work=f.history.more('g');await Promise.resolve();f.reply(1,{available:true,items:[{id:'a'}],nextCursor:{eventSeq:1,ordinal:0}});await work;
 work=f.history.more('g');await Promise.resolve();f.calls[2].reject(Error('unavailable'));await work;
 assert.equal(f.history.snapshot('g').error.message,'unavailable');assert.deepEqual(f.history.snapshot('g').items,[{id:'a'}]);
 work=f.history.retry('g');await Promise.resolve();assert.deepEqual(f.calls[3].values.cursor,{eventSeq:1,ordinal:0});f.reply(3,{available:true,items:[{id:'b'}],nextCursor:null});await work;
 assert.equal(f.history.snapshot('g').error,null);assert.deepEqual(f.history.snapshot('g').items.map(x=>x.id),['a','b']);
});
for(const boundary of ['account','owner','revision'])test(`a delayed response cannot cross ${boundary} scope`,async()=>{
 const f=fixture();const work=f.history.ensure('g');await Promise.resolve();f[boundary]();
 f.calls[0].resolve({gameplayRevision:7,available:true,items:[{id:'old'}]});await work;
 assert.equal(f.history.snapshot('g').metadata,false);assert.deepEqual(f.history.snapshot('g').items,[]);assert.deepEqual(f.changes,[]);
});
test('clearing the controller prevents a late completion from recreating state',async()=>{
 const f=fixture();const work=f.history.ensure('g');await Promise.resolve();f.history.clear();f.reply(0,{available:true,items:[{id:'old'}]});await work;
 assert.equal(f.history.snapshot('g').metadata,false);assert.deepEqual(f.changes,[]);
});
