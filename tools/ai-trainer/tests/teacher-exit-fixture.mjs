import {readFileSync} from 'node:fs';
import {resolveToStability,deterministicStateHash} from '../../../packages/game-engine/src/index.ts';
import {selectMove,transition,terminalValue} from '../../../packages/computer-player/src/index.ts';
import {catalogActions} from '../../../packages/computer-player/tests/catalog-helper.mjs';
export async function teacherExitFixture(){
  const catalog=JSON.parse(readFileSync(new URL('../../../apps/web/scenarios/catalog.json',import.meta.url)));
  const example=catalog.scenarios.find(s=>s.title==='Commander surrounded loss of supply');
  let state=resolveToStability(structuredClone(example.initialState)),root;
  for(const action of catalogActions(example)){
    const next=transition(state,action);
    if(terminalValue(next)===(state.sideToMove==='P1'?1:-1)){root=state;break;}
    state=next;
  }
  if(!root)throw Error('public winning fixture missing');
  const profile={simulations:64,temperature:1,maxValueGap:.1};
  const answer=await selectMove({state:root,seed:7,...profile},async()=>({policyLogits:new Float32Array(2801),value:0}));
  const position={id:'fresh-fixture',targetOrigin:'fresh-self-play',partition:'train',policyMask:true,terminalMask:false,terminalValue:0,
    state:root,stateHash:deterministicStateHash(root),controller:root.sideToMove,legal:answer.legality.indices,
    policy:[{index:answer.legality.indices.find(index=>!answer.policy.some(p=>p.index===index&&p.probability>0)),probability:1}]};
  answer.searchIdentity={requestedProfile:profile,stateHash:position.stateHash,controller:root.sideToMove,valuePerspective:'P1',completedSimulations:answer.simulations};
  return {position,answer,profile};
}
