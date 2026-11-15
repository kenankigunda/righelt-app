// Operator/native assessment producer. Never imported into the controller runtime.
import {deterministicStateHash} from '../../packages/game-engine/src/index.ts';
import {createEngineOperationBudget,EngineExpansionLimit} from '../ai-trainer/engine-operation-budget.mjs';
import {legalActionMap,transition} from '../../packages/computer-player/src/index.ts';
import {verifyWitness} from '../ai-trainer/tactical-evidence.mjs';
import {assert,canonical} from './policy.mjs';
import {developmentDigest,developmentScope} from './development-suite.mjs';
export async function assessDevelopmentCase({caseIndex,prepared,identity,search,stepSearches,actions,bounds}){
 assert(caseIndex.caseId===prepared.id&&caseIndex.rootSha256===prepared.stateHash&&caseIndex.family===prepared.sourceFamily&&caseIndex.scopeSha256===await developmentDigest(developmentScope(prepared)),'assessment input case differs');
 const base={schema:1,kind:'executed-development-assessment',caseKey:caseIndex.key,rootSha256:prepared.stateHash,scopeSha256:caseIndex.scopeSha256,family:prepared.sourceFamily,...identity,observedValuesUnchanged:true,historicalTrainingPositions:0,acceptableActionSetComplete:false};
 if(caseIndex.disposition!=='admitted')return {...base,disposition:'reference-only',reason:caseIndex.reason};
 if(!search)return {...base,disposition:'missing',reason:'no executed search result'};
 assert(search.rootSha256===prepared.stateHash&&search.modelSha256===identity.modelSha256&&search.profileSha256===identity.profileSha256,'search source/model/profile differs');
 assert(search.sourceRevision===identity.sourceRevision&&search.dependencySha256===identity.dependencySha256,'search source/dependencies differ');
 if(search.disposition!=='complete')return {...base,disposition:'incomplete',reason:'search did not complete bounded assessment'};
 assert(bounds&&Number.isSafeInteger(bounds.maxActions)&&bounds.maxActions>0&&Number.isSafeInteger(bounds.maxOperations)&&bounds.maxOperations>0&&Number.isFinite(bounds.milliseconds)&&bounds.milliseconds>0,'bounded aggregate assessment required');
 const deadline=performance.now()+bounds.milliseconds;
 let remainingOperations=bounds.maxOperations;
 class Interrupted extends Error {}
 const {bounded,stats}=createEngineOperationBudget('replay',bounds.maxOperations,()=>{if(performance.now()>=deadline||stats.operations>bounds.maxOperations)throw new Interrupted();});
 const run=operation=>{if(remainingOperations<=0||performance.now()>=deadline)throw new Interrupted();remainingOperations--;return bounded(operation);};
 assert(Array.isArray(actions)&&actions.length>0&&actions.length<=bounds.maxActions,'bounded selected continuation required');
 assert(Array.isArray(stepSearches)&&stepSearches.length===actions.length&&canonical(stepSearches[0])===canonical(search),'every actual model choice requires its search record');
 let current=structuredClone(prepared.state);
 try{
  for(let i=0;i<actions.length;i++){
   const step=stepSearches[i];
   assert(current.outcome.status==='ongoing'&&current.sideToMove===prepared.state.sideToMove,'non-root/opponent choices are not supported assessment');
   const stateHash=run(()=>deterministicStateHash(current));
   assert(step.disposition==='complete'&&step.rootSha256===stateHash&&step.controller===current.sideToMove,'step state/controller differs');
   for(const field of ['modelSha256','profileSha256','sourceRevision','dependencySha256'])assert(step[field]===identity[field],'step model/profile/source differs');
   assert(canonical(actions[i])===canonical(step.action),'step selected action differs from actual search');
   const keys=new Set(run(()=>[...legalActionMap(current).values()]).map(canonical));
   assert(Array.isArray(step.distribution)&&step.distribution.length===keys.size,'complete legal-action distribution required');
   const seen=new Set();let total=0;for(const p of step.distribution){const key=canonical(p.action);assert(keys.has(key)&&!seen.has(key)&&Number.isFinite(p.probability)&&p.probability>=0&&p.probability<=1,'invalid legal-action probability');seen.add(key);total+=p.probability;}
   assert(seen.has(canonical(step.action))&&Math.abs(total-1)<1e-6,'normalized selected legal-action distribution required');
   current=run(()=>transition(current,actions[i]));
  }
 }catch(error){if(error instanceof Interrupted||error instanceof EngineExpansionLimit)return {...base,disposition:'incomplete',reason:'aggregate trace verification budget exhausted'};throw error;}
 const verify=async options=>{
  if(remainingOperations<=0||performance.now()>=deadline)throw new Interrupted();
  try{const proof=await verifyWitness({...options,maxActions:bounds.maxActions,milliseconds:deadline-performance.now(),maxOperations:remainingOperations});remainingOperations-=proof.engineWork.operations;return proof;}
  catch(error){remainingOperations=0;throw error;}
 };
 let actualWitness;
 try{actualWitness=await verify({state:prepared.state,stateHash:prepared.stateHash,actions,expectedOutcome:null});}
 catch(error){if(error instanceof Interrupted||error instanceof EngineExpansionLimit)return {...base,disposition:'incomplete',reason:'aggregate witness verification budget exhausted'};throw error;}
 if(actualWitness.disposition!=='complete')return {...base,disposition:'incomplete',reason:'bounded continuation replay incomplete'};
 const rootOnly=actualWitness.steps.every(s=>s.controller===prepared.state.sideToMove),completeTurn=rootOnly&&(actualWitness.completedTurns>0||actualWitness.outcome!=='ongoing');
 if(!completeTurn)return {...base,disposition:'incomplete',reason:'root controller complete turn not observed'};
 const requests=caseIndex.acceptableRequests.map(name=>{const r=prepared.requests.find(x=>x.name===name);assert(r,'unknown frozen acceptable witness');return r;});
 const acceptableActions=requests.map(r=>r.actions[0]).filter((x,i,all)=>all.findIndex(a=>canonical(a)===canonical(x))===i);
 const goalChecks=[];for(const r of requests){
  try{const witness=await verify({state:prepared.state,stateHash:prepared.stateHash,actions,expectedOutcome:r.expectedOutcome,expectedEndpointHash:r.expectedEndpointHash,predicates:r.predicates??[],beforePredicates:r.beforePredicates??[]});if(witness.disposition!=='complete')return {...base,disposition:'incomplete',reason:'bounded goal verification incomplete'};goalChecks.push({name:r.name,satisfied:witness.disposition==='complete'&&(r.expectedOutcome===null||witness.expectedOutcomeMatched),witness});}
  catch(error){if(error instanceof Interrupted||error instanceof EngineExpansionLimit)return {...base,disposition:'incomplete',reason:'aggregate goal verification budget exhausted'};goalChecks.push({name:r.name,satisfied:false,reason:'checked endpoint/predicate goal mismatch'});}
 }
 return {...base,disposition:'complete',stepSearches,stepSearchesSha256:await developmentDigest(stepSearches),aggregateBounds:bounds,selectedAction:search.action,distribution:search.distribution,distributionSha256:await developmentDigest(search.distribution),searchResultSha256:await developmentDigest(search),acceptableActions,acceptableActionMass:search.distribution.filter(p=>acceptableActions.some(a=>canonical(a)===canonical(p.action))).reduce((s,p)=>s+p.probability,0),actualWitness,completeTurn,goalChecks,goalSatisfied:goalChecks.some(g=>g.satisfied)};
}

export async function assessmentBridge(job){
 const objectStrings={};
 const put=async value=>{const string=canonical(value),hash=await developmentDigest(value);objectStrings[hash]=string;return hash;};
 if(job.mode==='metadata'){const {developmentWorkIds}=await import('./development-suite.mjs');return {indexSha256:await developmentDigest(job.index),workIds:await developmentWorkIds(job.index)};}
 if(job.mode==='step'){
  const {state,answer,identity,profile,seed,bounds}=job,deadline=performance.now()+bounds.milliseconds;
  assert(Number.isSafeInteger(bounds.maxOperations)&&bounds.maxOperations>0&&Number.isFinite(bounds.milliseconds)&&bounds.milliseconds>0,'bounded search-step verification required');
  const {bounded,stats}=createEngineOperationBudget('replay',bounds.maxOperations,()=>assert(performance.now()<deadline&&stats.operations<=bounds.maxOperations,'search-step verification budget exhausted'));
  const legal=bounded(()=>legalActionMap(state)),rootSha256=bounded(()=>deterministicStateHash(state)),claimed=answer.searchIdentity;
  const applied=Object.fromEntries(['simulations','temperature','maxValueGap'].filter(k=>profile[k]!==undefined).map(k=>[k,profile[k]]));
  assert(answer.status==='ready'&&answer.stopped==='complete'&&answer.policyMask===true&&answer.fallback===null&&answer.seed===seed&&claimed?.stateHash===rootSha256&&claimed.controller===state.sideToMove&&claimed.valuePerspective==='P1'&&canonical(claimed.requestedProfile)===canonical(applied),'actual completed search identity differs');
  assert(answer.legality?.complete===true&&canonical([...answer.legality.indices].sort((a,b)=>a-b))===canonical([...legal.keys()].sort((a,b)=>a-b)),'actual complete legal inventory required');
  const probabilities=new Map();for(const p of answer.policy){assert(legal.has(p.index)&&!probabilities.has(p.index)&&Number.isFinite(p.probability)&&p.probability>=0&&p.probability<=1,'actual searched policy invalid');probabilities.set(p.index,p.probability);}
  const distribution=[...legal].map(([index,action])=>({action,probability:probabilities.get(index)??0}));
  assert(Math.abs(distribution.reduce((n,p)=>n+p.probability,0)-1)<1e-6&&canonical(legal.get(answer.actionIndex))===canonical(answer.action),'actual searched action/policy differs');
  const nextState=bounded(()=>transition(state,answer.action));
  assert(bounded(()=>deterministicStateHash(nextState))===bounded(()=>deterministicStateHash(answer.nextState)),'actual searched next state differs');
  const search={schema:1,kind:'actual-search-assessment-record',disposition:'complete',...identity,rootSha256,controller:state.sideToMove,seed,action:answer.action,distribution,nativeAnswerSha256:await put(answer)};
  await put(search);return {search,nextState,operations:stats.operations,objectStrings};
 }
 if(job.mode==='assess'){
  const assessment=await assessDevelopmentCase(job);await put(assessment);for(const search of job.stepSearches??[])await put(search);
  return {assessment,objectStrings};
 }
 if(job.mode==='report'){
  const {validateDevelopmentSuiteReport}=await import('./development-suite.mjs');
  const report={...job.report,indexSha256:await developmentDigest(job.index)};
  const checked=await validateDevelopmentSuiteReport(job.index,report,{read:async b=>new TextEncoder().encode(job.objects[b.sha256]),expectedPurpose:report.purpose});
  await put(report);return {report,checked,objectStrings};
 }
 throw new Error('unsupported bounded assessment command');
}
if(process.argv.includes('--bridge')){
 const {readFileSync}=await import('node:fs');
 const raw=readFileSync(0);assert(raw.length<=64*1024*1024,'bounded assessment request required');
 process.stdout.write(JSON.stringify(await assessmentBridge(JSON.parse(raw)))+'\n');
}
