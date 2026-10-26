import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync}from 'node:fs';import {createHash}from 'node:crypto';
import {validateTeaching,teachingDecision,verifyTeachingDecision}from '../training-teaching.mjs';
const raw=readFileSync(new URL('../../../packages/computer-player/config/followup-teaching-v1.json',import.meta.url));
const definition=JSON.parse(raw),definitionSha256=createHash('sha256').update(raw).digest('hex');
function fixture(cycle=1){const c=definition.cycles[cycle],profile=definition.profiles[c.profile];return{schema:1,definitionSha256,recipeSha256:'a'.repeat(64),cycle,roles:c.roles,models:{current:'learner-checkpoint',teacher:'b'.repeat(64)},profiles:{P1:profile,P2:profile}};}
test('teacher roles and profiles are explicit and recorded per decision',()=>{
 const t=fixture();validateTeaching(t);
 const d={controller:'P1',...teachingDecision(t,'P1')};
 assert.equal(d.modelVersion,'b'.repeat(64));assert.equal(d.teachingRole,'teacher');
 verifyTeachingDecision(t,d);
 for(const patch of[{modelVersion:'learner'},{teachingRole:'current'},{profileVersion:'live-horus'},{teachingRecipeSha256:'c'.repeat(64)}])assert.throws(()=>verifyTeachingDecision(t,{...d,...patch}));
});
test('unknown or altered teacher configuration fails closed',()=>{
 const t=fixture();
 for(const patch of[{cycle:9},{cycle:0},{definitionSha256:'c'.repeat(64)},{models:{...t.models,teacher:'unbound'}},{profiles:{...t.profiles,P1:{...t.profiles.P1,simulations:128}}}])assert.throws(()=>validateTeaching({...t,...patch}));
 assert.equal(validateTeaching(undefined),null);assert.throws(()=>validateTeaching(null));
});

test('stripped teaching envelope cannot masquerade as a legacy decision',()=>{
 const d={controller:'P1',...teachingDecision(fixture(),'P1')};
 assert.throws(()=>verifyTeachingDecision(undefined,d),/Orphaned/);
 verifyTeachingDecision(undefined,{controller:'P1',modelVersion:'old',profileVersion:'selfplay-old'});
});
