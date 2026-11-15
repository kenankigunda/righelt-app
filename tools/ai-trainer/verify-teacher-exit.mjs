// Independent authoritative verification of a short, proof-complete teacher
// answer. Raw search reason flags never authorize a policy target themselves.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {deterministicStateHash} from '../../packages/game-engine/src/index.ts';
import {legalActionMap,transition,terminalValue,experimentConfig} from '../../packages/computer-player/src/index.ts';
import {proveTactical,TacticalInterrupted} from '../../packages/computer-player/src/tactics.ts';
import {createEngineOperationBudget} from './engine-operation-budget.mjs';
import {canonical,assert} from '../hosted-compute/policy.mjs';

export function verifyTeacherExit({position,answer,milliseconds}) {
  assert(Number.isFinite(milliseconds)&&milliseconds>0&&milliseconds<=60000,'bounded teacher proof time required');
  const state=position?.state,rootHash=deterministicStateHash(state),controller=state.sideToMove;
  assert(state.outcome.status==='ongoing'&&rootHash===position.stateHash&&controller===position.controller,'teacher proof root/controller differs');
  assert(['immediate-win','forced-win'].includes(answer?.reason)&&answer.status==='ready'&&answer.stopped==='complete'&&answer.fallback===null&&answer.policyMask===true&&answer.legality?.complete===true,'terminal or bounded proof-complete answer required');
  assert(Number.isSafeInteger(answer.simulations)&&answer.simulations>=0&&answer.searchIdentity?.completedSimulations===answer.simulations,'honest actual teacher work required');
  const deadline=performance.now()+milliseconds,maxNodes=experimentConfig.search.maxNodes;
  let nodes=0;
  const {bounded,stats}=createEngineOperationBudget('replay',maxNodes,()=>{
    if(performance.now()>=deadline||stats.operations>maxNodes*3+10)throw new TacticalInterrupted();
  });
  const legal=bounded(()=>legalActionMap(state)),sorted=values=>[...values].sort((a,b)=>a-b);
  assert(canonical(sorted(legal.keys()))===canonical(sorted(position.legal))&&canonical(sorted(answer.legality.indices))===canonical(sorted(legal.keys())),'teacher proof complete legal mask differs');
  const policy=answer.policy;
  assert(Array.isArray(policy)&&policy.length>0&&new Set(policy.map(p=>p.index)).size===policy.length&&policy.every(p=>legal.has(p.index)&&Number.isFinite(p.probability)&&p.probability>=0)&&Math.abs(policy.reduce((n,p)=>n+p.probability,0)-1)<=1e-5,'teacher proof policy support invalid');
  assert(legal.has(answer.actionIndex)&&canonical(legal.get(answer.actionIndex))===canonical(answer.action)&&policy.some(p=>p.index===answer.actionIndex&&p.probability>0),'selected teacher action is not supported');
  const winner=controller==='P1'?1:-1,support=[];
  const rules={terminal:terminalValue,controller:s=>s.sideToMove,children:function*(s){
    for(const action of bounded(()=>legalActionMap(s)).values()){
      if(++nodes>maxNodes||performance.now()>=deadline)throw new TacticalInterrupted();
      yield bounded(()=>transition(s,action));
    }
  }};
  for(const p of policy.filter(p=>p.probability>0)){
    if(++nodes>maxNodes||performance.now()>=deadline)throw new TacticalInterrupted();
    const next=bounded(()=>transition(state,legal.get(p.index))),afterHash=deterministicStateHash(next);
    if(p.index===answer.actionIndex&&answer.nextState)assert(deterministicStateHash(answer.nextState)===afterHash,'selected teacher transition differs');
    const terminal=terminalValue(next);
    if(answer.reason==='immediate-win')assert(terminal===winner,'positive teacher policy includes a nonwinning terminal action');
    else{
      const proof=proveTactical(next,experimentConfig.search.tacticalDepth-1,rules);
      assert(!proof.incomplete&&proof.lower===winner&&proof.upper===winner,'positive teacher policy lacks a complete bounded win proof');
    }
    support.push({index:p.index,afterHash,kind:terminal===winner?'terminal-win':'bounded-forced-win'});
  }
  assert(support.length>0,'empty teacher proof support');
  return {schema:1,kind:'authoritative-teacher-early-exit',rootHash,controller,reason:answer.reason,
    actualSimulations:answer.simulations,depth:experimentConfig.search.tacticalDepth,maxNodes,nodes,support,
    elapsedMs:performance.now()-(deadline-milliseconds),engineWork:stats};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{process.stdout.write(JSON.stringify(verifyTeacherExit(JSON.parse(readFileSync(0,'utf8'))))+'\n');}
  catch{process.stderr.write('Teacher early-exit proof incomplete or invalid.\n');process.exitCode=1;}
}
