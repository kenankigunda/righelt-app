import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {validateTeaching,teachingDecision,verifyTeachingDecision} from '../training-teaching.mjs';
const raw=readFileSync(new URL('../righelt_training/local-teaching-v2.json',import.meta.url));
const definition=JSON.parse(raw),definitionSha256=createHash('sha256').update(raw).digest('hex');
function teaching(cycle){const slot=definition.cycles[cycle],profile=definition.profiles[slot.profile];return {schema:1,cycle,definitionSha256,recipeSha256:'a'.repeat(64),roles:slot.roles,profiles:{P1:profile,P2:profile},models:{current:'b'.repeat(64),teacher:'c'.repeat(64)}};}
test('actual retained cycles select current and teacher model identities for each controller',()=>{
 const expected=[['current','current'],['teacher','current'],['current','teacher'],['teacher','teacher']];
 for(let cycle=0;cycle<4;cycle++)for(const [index,seat] of ['P1','P2'].entries()){
  const t=teaching(cycle),decision=teachingDecision(t,seat);
  assert.equal(decision.teachingRole,expected[cycle][index]);
  assert.equal(decision.modelVersion,(expected[cycle][index]==='current'?'b':'c').repeat(64));
  assert.match(decision.profileVersion,new RegExp(`:${cycle===0?8:32}$`));
  verifyTeachingDecision(t,{controller:seat,...decision});
  assert.throws(()=>verifyTeachingDecision(t,{controller:seat,...decision,modelVersion:'d'.repeat(64)}),/changed teacher provenance/);
 }
});
test('changed role, search allowance, orphaned evidence and evaluation teaching reject',()=>{
 for(const mutate of [v=>v.roles={P1:'current',P2:'teacher'},v=>v.profiles={P1:{simulations:128},P2:{simulations:128}},v=>v.models.teacher='unknown']){
  const t=structuredClone(teaching(1));mutate(t);assert.throws(()=>validateTeaching(t),/provenance/);
 }
 assert.throws(()=>verifyTeachingDecision(undefined,{controller:'P1',teachingRole:'teacher'}),/Orphaned/);
 const result=spawnSync(process.execPath,['--import','tsx','tools/ai-trainer/engine-worker.mjs'],{cwd:new URL('../../../',import.meta.url),input:JSON.stringify({command:'arena',partition:'validation',teaching:teaching(1)})+'\n',encoding:'utf8',timeout:10000});
 assert.equal(result.status,1);assert.match(result.stdout,/Teaching only permitted for training generation/);
});
