import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {visualPolicy,selectedViewports,shouldCapture} from '../visual-policy.mjs';import {proof} from '../proof.mjs';
test('visual defaults preserve legacy and reject malformed declarations',()=>{
 assert.equal(visualPolicy({}).mode,'legacy');assert.equal(selectedViewports({}).length,3);
 assert.deepEqual(selectedViewports({RIGHELT_VISUAL_MODE:'walkthrough'}).map(v=>[v.name,v.width]),[['mobile',390],['mid-wide',1366],['full-wide',1920]]);assert.equal(selectedViewports({RIGHELT_VISUAL_MODE:'none'}).length,3);
 assert.throws(()=>visualPolicy({RIGHELT_VISUAL_MODE:'typo'}),/mode/);for(const value of ['{}','[]','["created","created"]','bad'])assert.throws(()=>visualPolicy({RIGHELT_VISUAL_CHECKPOINTS:value}));assert.throws(()=>selectedViewports({RIGHELT_VALIDATION_VIEWPORTS:'["unknown"]'}),/viewport/);
 const p=visualPolicy({RIGHELT_VISUAL_MODE:'walkthrough',RIGHELT_VISUAL_CHECKPOINTS:'["created"]'});assert(shouldCapture('created','mobile',p));assert(!shouldCapture('reconnected','mobile',p));assert(!shouldCapture('created','full-wide',p));
});
test('none records text without browser access; walkthrough captures only masked context',async()=>{
 const keys=['RIGHELT_VISUAL_MODE','RIGHELT_VISUAL_CHECKPOINTS','RIGHELT_EVIDENCE_DIR'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]])),dir=await mkdtemp(path.join(os.tmpdir(),'visual-policy-')),attachments=[];const info={project:{name:'mobile',use:{hasTouch:true}},attach:async(name,value)=>attachments.push({name,...value})};
 try{process.env.RIGHELT_EVIDENCE_DIR=dir;process.env.RIGHELT_VISUAL_MODE='none';delete process.env.RIGHELT_VISUAL_CHECKPOINTS;assert.deepEqual(await proof({},info,'account-owned-move',{}),[]);assert.equal(attachments[0].name,'behavior');assert.deepEqual(await readdir(dir),[]);
 process.env.RIGHELT_VISUAL_MODE='walkthrough';process.env.RIGHELT_VISUAL_CHECKPOINTS='["recovery-acknowledgment"]';let count=0;const mask=[{}],page={evaluate:async(fn,arg)=>typeof arg==='string'?Buffer.from('thumb').toString('base64'):{touch:1,hover:false,x:0,y:0},screenshot:async opts=>{count++;assert.equal(opts.fullPage,false);assert.equal(opts.mask,mask);return Buffer.from('context');}};
 const result=await proof(page,info,'recovery-acknowledgment',{}, {mask});assert.equal(count,1);assert.equal(result.length,1);assert.match(result[0].caption,/context$/);assert.equal((await readdir(path.join(dir,'images'))).length,2);assert.deepEqual(await proof({},info,'not-selected',{}),[]);
 }finally{for(const k of keys)if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];await rm(dir,{recursive:true,force:true});}
});
