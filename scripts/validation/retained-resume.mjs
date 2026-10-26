import {hash} from './model.mjs';
import {stagePolicy} from './plan.mjs';

// Retained origin metadata is truthful only if the receiving run can restore its
// own verified baseline. Never replace missing retained state with fresh seeds.
// The caller supplies the filesystem verifier; this gate does not mutate a run.
export async function requireRetainedResumeBaseline({previous,base,tree,harnessFingerprint,spec,verify,node=process.version,platform=process.platform,arch=process.arch}) {
 if(!previous?.retainedTransfer)return;
 const prior=previous.stages?.find(stage=>stage.index===0);
 if(prior?.status!=='passed'||!prior.checkpoint||!prior.checkpointProvenance||!prior.evidenceReceipt)throw Error('Retained resume requires a passed baseline with checkpoint, provenance and evidence; use a new retained-input run');
 const accounts=prior.checkpointProvenance.policy?.selected?.includes('Account responsive proof')===true;
 const provenance=JSON.parse(JSON.stringify({version:2,base,tree,prefix:[],policy:stagePolicy(spec,0,{accounts,changed:[]}),harnessFingerprint,node,platform,arch}));
 if(previous.base!==base||hash(prior.checkpointProvenance)!==hash(provenance))throw Error('Retained resume baseline provenance changed; use a new retained-input run');
 try{
  if(await verify(prior,provenance)!==true)throw Error('Baseline verification did not succeed');
 }catch(error){throw Error('Retained resume baseline cannot be restored; use a new retained-input run',{cause:error});}
}
