export const ROOT_PRIOR_POLICY_VERSION = "eligible-logits-v1";
export const CONDITIONED_SEARCH_POLICY_VERSION = "model-fallback-conditioned-root-v3";
export type RootPolicyItem = {index:number;policyLogit:number};

/** Condition model scores on the current admitted actions, even at subnormal mass. */
export function conditionedRootPriors(choices:RootPolicyItem[],mixed?:Map<number,number>):Map<number,number>{
  if(!choices.length)return new Map();
  if(new Set(choices.map(x=>x.index)).size!==choices.length||choices.some(x=>!Number.isFinite(x.policyLogit)))throw new Error('Invalid admitted root logits');
  const max=Math.max(...choices.map(x=>x.policyLogit)),weights=choices.map(x=>Math.exp(x.policyLogit-max)),sum=weights.reduce((a,b)=>a+b,0);
  const base=new Map(choices.map((x,i)=>[x.index,weights[i]/sum]));
  if(!mixed?.size)return base;
  const selected=choices.map(x=>mixed.get(x.index)??base.get(x.index)!);
  const mass=selected.reduce((a,b)=>a+b,0);
  if(!Number.isFinite(mass)||mass<=0||selected.some(x=>!Number.isFinite(x)||x<0))throw new Error('Invalid effective root selection mass');
  return new Map(choices.map((x,i)=>[x.index,selected[i]/mass]));
}
