import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {controlledHeightPublication} from '../../../browser-integration/support/height-publication-test-fixture.mjs';
const source=readFileSync(new URL('../../../apps/web/board/message-height.js',import.meta.url),'utf8');
function fixture({attachmentFailure=false,initFailure=false,unrouteFailure=false}={}){
 let route,unroutes=0,evaluations=0;const attachments=[];
 const context={async addInitScript(){},async route(_match,handler){route=handler;},async unroute(){unroutes++;if(unrouteFailure)throw Error('dispose-secondary');}};
 const page={context:()=>context,async addInitScript(){if(initFailure)throw Error('init-primary');},isClosed:()=>false,async evaluate(){evaluations++;return {ready:true};}};
 const info={async attach(name){attachments.push(name);if(attachmentFailure&&attachments.length===1)throw Error('attachment-secondary');}};
 return {args:{page,browserName:'firefox',baseURL:'http://127.0.0.1:10188'},info,attachments,unroutes:()=>unroutes,evaluations:()=>evaluations,async publish(){await route({async fetch(){return {status:()=>200,text:async()=>source};},request:()=>({method:()=> 'GET'}),async fulfill(){}});}};
}
test('primary workflow rejection survives attachment failure after cleanup and final snapshot attempt',async()=>{const f=fixture({attachmentFailure:true});await assert.rejects(controlledHeightPublication(f.args,async()=>{await f.publish();throw Error('workflow-primary');},f.info),/workflow-primary/);assert.equal(f.unroutes(),1);assert.equal(f.evaluations(),1);assert.equal(f.attachments.length,2);});
test('attachment failure on an otherwise passing workflow fails after final snapshot attempt',async()=>{const f=fixture({attachmentFailure:true});await assert.rejects(controlledHeightPublication(f.args,()=>f.publish(),f.info),/attachment-secondary/);assert.equal(f.unroutes(),1);assert.equal(f.evaluations(),1);assert.equal(f.attachments.length,2);});
test('initialization rejection still disposes the route and preserves its primary error',async()=>{const f=fixture({initFailure:true});await assert.rejects(controlledHeightPublication(f.args,()=>assert.fail('must not enter workflow'),f.info),/init-primary/);assert.equal(f.unroutes(),1);assert.equal(f.evaluations(),1);assert.equal(f.attachments.length,2);});
test('disposal rejection cannot replace an existing workflow failure or skip evidence',async()=>{const f=fixture({unrouteFailure:true});await assert.rejects(controlledHeightPublication(f.args,async()=>{await f.publish();throw Error('workflow-primary');},f.info),/workflow-primary/);assert.equal(f.unroutes(),1);assert.equal(f.evaluations(),1);assert.equal(f.attachments.length,2);});
