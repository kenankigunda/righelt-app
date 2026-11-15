import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {installRemovalOnsetRecorder,transformRemovalOnsetModule,installRemovalOnsetTrace} from '../../../e2e/support/removal-onset-trace.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const recipeFor=(source,after)=>({sourceSha256:hash(source),outputSha256:hash(after),operations:[{start:source.indexOf('work()'),end:source.indexOf('work()')+'work()'.length,before:'work()',after:'try{sink()}catch{};work()',anchor:'work()',anchorCount:1}]});

test('exact transformation is bound on both sides and fails closed',()=>{
 const source='export function run(){work()}\n',output='export function run(){try{sink()}catch{};work()}\n',recipe=recipeFor(source,output);
 assert.equal(transformRemovalOnsetModule(source,recipe),output);
 const executed=transformRemovalOnsetModule(source,recipe).replace('export function','function')+';run();';let work=0;
 vm.runInNewContext(executed,{sink(){throw Error('diagnostic sink');},work(){work++;}});assert.equal(work,1);
 assert.throws(()=>transformRemovalOnsetModule(source+' ',recipe),/source hash/);
 const range=structuredClone(recipe);range.operations[0].start++;assert.throws(()=>transformRemovalOnsetModule(source,range),/range/);
 const anchor=structuredClone(recipe);anchor.operations[0].anchorCount++;assert.throws(()=>transformRemovalOnsetModule(source,anchor),/anchor count/);
 assert.throws(()=>transformRemovalOnsetModule(source,{...recipe,outputSha256:'0'.repeat(64)}),/output hash/);
});

test('recorder is bounded, scalar-only and cannot escape through hostile fields',()=>{
 let now=0;
 const listeners={};
 const context={performance:{now:()=>++now,timeOrigin:12},Element:class{},document:{addEventListener(type,handler){listeners[type]=handler;}},Set,Object,Number,Array};
 vm.createContext(context);vm.runInContext(`(${installRemovalOnsetRecorder.toString()})()`,context);
 assert.equal(context.__righeltRemovalTraceArm({expectedCount:5}),true);
 assert.doesNotThrow(()=>context.__righeltRemovalTraceMark('board-commit-entry',{removalCount:5,actionable:false,secret:'discard'}));
 assert.doesNotThrow(()=>context.__righeltRemovalTraceMark('not-allowed',{get removalCount(){throw Error('sink');}}));
 for(let index=0;index<300;index++)context.__righeltRemovalTraceMark('paint-opportunity');
 const snapshot=context.__righeltRemovalTraceSnapshot();
 assert.equal(snapshot.records.length,256);assert.equal(snapshot.dropped,45);assert.equal(snapshot.incomplete,true);
 assert.equal(JSON.stringify(snapshot).includes('secret'),false);assert.equal(snapshot.origin,12);
 assert.equal(context.__righeltRemovalTraceArm({expectedCount:8}),false);
});

test('route transform aborts on mismatch instead of serving unmeasured code',async()=>{
 let handler,pattern,aborts=0,fulfills=0;
 const context={async route(value,callback){pattern=value;handler=callback;},async addInitScript(){},async unroute(){}};
 const dispose=await installRemovalOnsetTrace(context,'http://127.0.0.1:10193');
 assert.equal(pattern(new URL('http://127.0.0.1:10193/shell/app.js')),true);
 await handler({request:()=>({url:()=> 'http://127.0.0.1:10193/shell/app.js'}),fetch:async()=>({text:async()=> 'wrong source'}),fulfill:async()=>{fulfills++;},abort:async()=>{aborts++;}});
 assert.equal(fulfills,0);assert.equal(aborts,1);
 const receipt=await dispose();assert.equal(receipt.incomplete,true);assert.equal(receipt.errors.length,1);
});
