// Checks supplied minimax evidence with the common rules; never searches for a proof.
import {deterministicStateHash} from '../../packages/game-engine/src/index.ts';
import {legalActionMap,transition} from '../../packages/computer-player/src/index.ts';
import {createEngineOperationBudget,EngineExpansionLimit} from './engine-operation-budget.mjs';
import {assert,canonical,encode,sha256} from '../hosted-compute/policy.mjs';

export async function verifyTurnCertificate(c,{milliseconds,maxNodes}) {
  assert(Number.isFinite(milliseconds)&&milliseconds>0&&milliseconds<=120000&&Number.isSafeInteger(maxNodes)&&maxNodes>0&&maxNodes<=10000,'explicit bounded certificate work required');
  assert(c?.schema===1&&['P1','P2'].includes(c.winner)&&Number.isSafeInteger(c.endTurnIndex)&&Number.isSafeInteger(c.actionHorizon)&&c.actionHorizon>0&&c.actionHorizon<=64,'unsupported turn certificate');
  assert(['forced-win','no-forced-win-in-scope'].includes(c.status)&&Array.isArray(c.nodes)&&c.nodes.length>0,'complete proof graph required');
  const deadline=performance.now()+milliseconds,nodes=new Map(c.nodes.map(n=>[n.id,n])),seen=new Map();
  assert(nodes.size===c.nodes.length,'duplicate certificate node');
  class Interrupted extends Error {}
  const checkBudget=()=>{if(performance.now()>=deadline)throw new Interrupted();};
  const {bounded,stats}=createEngineOperationBudget('replay',maxNodes,checkBudget);
  const legal=s=>bounded(()=>[...legalActionMap(s).values()]);
  const advance=(s,a)=>{assert(legal(s).some(x=>canonical(x)===canonical(a)),'illegal certificate action');return bounded(()=>transition(s,a));};
  let state=c.rootState,preludeActions=0;
  const result=(disposition,value=null)=>({schema:1,kind:'bounded-turn-certificate',disposition,rootHash:c.rootStateHash,winner:c.winner,defender:c.winner==='P1'?'P2':'P1',endTurnIndex:c.endTurnIndex,verifiedNodes:seen.size,preludeActions,value,scope:'Terminal win by the specified complete-turn boundary only.',globalSafetyProven:false,rootOptimalValueP1:null,terminalValueP1:null,engineWork:stats});
  function visit(s,id,depth){
    checkBudget();
    const n=nodes.get(id),hash=deterministicStateHash(s);
    assert(n&&n.hash===hash&&n.controller===s.sideToMove&&n.turnIndex===s.turnIndex&&n.depth===depth&&Array.isArray(n.edges)&&typeof n.value==='boolean','certificate state/controller/depth mismatch');
    if(seen.has(id))return seen.get(id);
    if(seen.size>=maxNodes)throw new Interrupted();
    let value;
    if(n.kind==='terminal'){
      assert(s.outcome.status!=='ongoing'&&s.turnIndex<=c.endTurnIndex&&n.edges.length===0,'false terminal certificate leaf');
      value=s.outcome.status===(c.winner==='P1'?'p1_win':'p2_win');
    }else if(n.kind==='turn-boundary'){
      assert(s.outcome.status==='ongoing'&&!s.continuation&&s.turnIndex===c.endTurnIndex&&s.sideToMove!==c.winner&&n.edges.length===0,'false complete-turn boundary');value=false;
    }else{
      assert(n.kind==='choice'&&depth>0&&s.outcome.status==='ongoing'&&s.turnIndex<=c.endTurnIndex&&!(s.turnIndex===c.endTurnIndex&&!s.continuation&&s.sideToMove!==c.winner),'unknown or horizon certificate leaf');
      const actions=legal(s),keys=actions.map(canonical).sort(),edges=n.edges.map(e=>canonical(e.action)).sort();
      assert(edges.length>0&&new Set(edges).size===edges.length&&edges.every(k=>keys.includes(k)),'illegal or duplicate certificate alternatives');
      // Universal branches must enumerate the complete authoritative legal set.
      if((s.sideToMove===c.winner)!==n.value)assert(canonical(keys)===canonical(edges),'missing universal certificate alternative');
      const values=n.edges.map(e=>visit(bounded(()=>transition(s,e.action)),e.child,depth-1));
      value=s.sideToMove===c.winner?values.some(Boolean):values.every(Boolean);
    }
    assert(value===n.value,'certificate value does not follow executed alternatives');seen.set(id,value);return value;
  }
  try{
    assert(deterministicStateHash(state)===c.rootStateHash,'certificate root mismatch');
    if(c.beforeState){
      assert(deterministicStateHash(c.beforeState)===c.beforeHash&&Array.isArray(c.prelude)&&c.prelude.length>0&&c.prelude.length<=32,'certificate prelude identity required');
      state=c.beforeState;for(const action of c.prelude){state=advance(state,action);preludeActions++;}
      assert(deterministicStateHash(state)===c.rootStateHash,'certificate prelude endpoint mismatch');
    }
    const value=visit(state,c.proofRoot,c.actionHorizon);
    assert(value===(c.status==='forced-win')&&seen.size===nodes.size,'certificate status or reachable inventory mismatch');
    return {...result('complete',value),certificateCanonicalSha256:await sha256(encode(canonical(c)))};
  }catch(error){if(error instanceof Interrupted||error instanceof EngineExpansionLimit)return result('incomplete');throw error;}
}
