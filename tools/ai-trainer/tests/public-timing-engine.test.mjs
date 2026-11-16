// Native rule/protocol contract only. No model load, inference or source supply.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {publicEvaluationProfiles} from '../public-evaluation-profiles.mjs';
import {canonical} from '../../hosted-compute/policy.mjs';
const profiles=publicEvaluationProfiles(),profile=profiles.profiles.babs;
const model='f5b0f38763f290eaecf7f1958738342bb327f42efe95b5021b1f59b2b78f8a0f';
function job(){return {command:'arena',purpose:'public-performance-timing',id:'synthetic-public-protocol',referenceSeat:'P1',seed:7,kind:'normal',startKind:'normal',budgetMs:1,
 profiles:{P1:profile,P2:profile},modelVersions:{P1:model,P2:model},profileVersions:{P1:profile.version,P2:profile.version},
 evaluationProfile:{name:'babs',sourceSha256:profiles.sourceSha256,definition:profile,artifactSha256:createHash('sha256').update(canonical(profiles)).digest('hex')}};}
async function request(value){return new Promise((resolve,reject)=>{
 const child=execFile(process.execPath,['--import','tsx','tools/ai-trainer/engine-worker.mjs'],{timeout:15000,maxBuffer:1024*1024},(error,stdout)=>{
  try{const rows=stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));if(!rows.length)throw error??Error('missing native protocol');resolve(rows);}catch(failure){reject(failure);}
 });child.stdin.end(JSON.stringify(value)+'\n');
});}
test('native public arena admits canonical normal timing without any scientific partition or model inference',async()=>{
 assert.deepEqual(Object.values(profiles.profiles).map(p=>p.simulations),[8,32,128]);
 const rows=await request(job());assert(rows.length>0);assert(rows.every(r=>r.type!=='error'&&r.type!=='evaluate'&&r.type!=='game'));assert.equal(rows.at(-1).type,'unfinished');
});
test('native public arena rejects invented lineage, custom roots, alternate weights and altered public budgets before play',async()=>{
 for(const change of [j=>j.seed=-1,j=>j.referenceSeat='candidate',j=>j.partition='validation',j=>j.familyId='fake',j=>j.initialState={},j=>j.kind='simple',j=>j.modelVersions={P1:'a'.repeat(64),P2:'a'.repeat(64)},j=>j.profiles.P1={...profile,simulations:1}]){
  const value=structuredClone(job());change(value);const rows=await request(value);assert.equal(rows[0].type,'error');assert(rows.every(r=>r.type!=='evaluate'&&r.type!=='game'));
 }
});
