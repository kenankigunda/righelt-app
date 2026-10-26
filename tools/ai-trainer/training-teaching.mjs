// Training-only teacher provenance. Live play does not import this module.
import {readFileSync}from 'node:fs';
import {createHash}from 'node:crypto';
const raw=readFileSync(new URL('../../packages/computer-player/config/followup-teaching-v1.json',import.meta.url));
const definition=JSON.parse(raw),definitionSha256=createHash('sha256').update(raw).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function validateTeaching(value){
 if(value===undefined)return null;
 if(!value||value.schema!==1||value.definitionSha256!==definitionSha256||!Number.isInteger(value.cycle)||value.cycle<0||value.cycle>=definition.cycles.length||!/^[a-f0-9]{64}$/.test(value.recipeSha256??''))throw Error('Invalid teaching definition');
 const cycle=definition.cycles[value.cycle],profile=definition.profiles[cycle.profile];
 if(!equal(value.roles,cycle.roles)||!equal(value.profiles,{P1:profile,P2:profile})||typeof value.models?.current!=='string'||!value.models.current||!/^[a-f0-9]{64}$/.test(value.models?.teacher??'')||!equal(Object.keys(value.models).sort(),['current','teacher']))throw Error('Invalid teaching model/profile provenance');
 return value;
}
export function teachingDecision(value,seat){
 const t=validateTeaching(value);
 if(!t)return null;
 if(!['P1','P2'].includes(seat))throw Error('Invalid teaching seat');
 const role=t.roles[seat];
 return {modelVersion:t.models[role],profileVersion:`training-teaching-v1:${t.recipeSha256}:${seat}:${t.profiles[seat].simulations}`,teachingRole:role,teachingRecipeSha256:t.recipeSha256};
}
export function verifyTeachingDecision(value,decision){
 const expected=teachingDecision(value,decision.controller);
 if(!expected&&('teachingRole'in decision||'teachingRecipeSha256'in decision||decision.profileVersion?.startsWith('training-teaching-v1:')))throw Error('Orphaned teacher provenance');
 if(expected&&Object.entries(expected).some(([key,val])=>decision[key]!==val))throw Error('Decision changed teacher provenance');
}
