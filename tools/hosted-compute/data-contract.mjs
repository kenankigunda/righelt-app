import contract from '../ai-trainer/learning-evidence-contract.json' with {type:'json'};
import { assert } from './policy.mjs';
export {contract as LEARNING_EVIDENCE_CONTRACT};
export function sourceQualification(value = {}) {
  const purpose=value.sourcePurpose??'unclassified', actor=value.actorProvenance??{kind:'unknown'};
  assert(contract.purposes.includes(purpose) && contract.actorKinds.includes(actor.kind), 'invalid source purpose or actor provenance');
  const label=value.label??{category:'verified-start',scope:'Fresh learning from an independently replayed start only. No historical move/value target.'};
  assert(contract.labelCategories.includes(label.category) && typeof label.scope==='string' && label.scope.length>0,'label category and exact scope required');
  assert(value.sourceFamily===undefined || typeof value.sourceFamily==='string' && value.sourceFamily.length>0,'source family required');
  return {sourcePurpose:purpose,actorProvenance:{kind:actor.kind,...(actor.kind==='computer'&&actor.profile?{profile:actor.profile}:{})},
    sourceFamily:value.sourceFamily??null,label,terminalBoundary:value.terminalBoundary==='verified'?'verified':'quarantined',
    learnerEligibility:{historicalPolicy:false,historicalOptimalNonterminalValue:false,competitiveScore:false}};
}
