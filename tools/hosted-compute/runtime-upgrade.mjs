import {assert,canonical,sha256} from './policy.mjs';
import {readOperatorReceipt} from './manual-authority.mjs';
import arithmeticPolicy from '../ai-trainer/righelt_training/arithmetic-policy-v1.json' with {type:'json'};

const digest=/^[a-f0-9]{64}$/;
const keys=(value,names)=>value&&Object.keys(value).sort().join(',')===names.split(',').sort().join(',');
export function runtimeUpgradeEndpoint(c){
  const m=c.manifest;
  return {campaignId:m.id,manifestSha256:c.manifestSha256,sourceRevision:m.sourceRevision,
    runtimeSha256:m.runtimeSha256,image:m.phases[0].host.image,executionRecipeSha256:m.executionRecipeSha256};
}
async function recipe(core,c){
  const sha=c.manifest.executionRecipeSha256;
  const object=await core.bucket.get(`${c.manifest.id}/${sha}`);
  assert(object,'runtime upgrade recipe object missing');
  const raw=new Uint8Array(await object.arrayBuffer());
  assert(await sha256(raw)===sha,'runtime upgrade recipe bytes differ');
  const value=JSON.parse(new TextDecoder().decode(raw));
  assert(value?.schema===1&&value.kind==='execution-recipe'&&value.settings?.mode==='closed-loop-fixture','runtime upgrade public fixture recipe required');
  return value;
}
export async function validateRuntimeUpgrade(core,prior,c,intent){
  const receipt=await readOperatorReceipt(core.externalControl(c.manifest).store,intent.runtimeUpgrade);
  assert(keys(receipt,'schema,kind,scope,createdAt,expiresAt,prior,next,publicInputs,arithmeticPolicy,review,numericTolerance,historicalFailureDisposition')&&receipt.schema===1&&receipt.kind==='manual-runtime-upgrade'&&receipt.scope==='public-canary-runtime-qualification','typed public runtime upgrade required');
  assert(canonical(receipt.prior)===canonical(runtimeUpgradeEndpoint(prior))&&canonical(receipt.next)===canonical(runtimeUpgradeEndpoint(c)),'runtime upgrade endpoint differs');
  assert(c.manifest.sourceRevision!==prior.manifest.sourceRevision&&c.manifest.phases[0].host.image!==prior.manifest.phases[0].host.image&&c.manifest.executionRecipeSha256!==prior.manifest.executionRecipeSha256,'runtime upgrade needs new source/image/recipe identities');
  assert(Number.isSafeInteger(receipt.createdAt)&&Number.isSafeInteger(receipt.expiresAt)&&receipt.createdAt<=intent.createdAt&&intent.createdAt-receipt.createdAt<=900000&&receipt.expiresAt>=intent.expiresAt&&receipt.expiresAt-receipt.createdAt<=900000&&core.now()<receipt.expiresAt,'runtime upgrade review window expired');
  const expected=Object.fromEntries(['checkpointSha256','corpusSha256','recipeSha256','seed'].map(key=>[key,c.manifest[key]]));
  assert(canonical(receipt.publicInputs)===canonical(expected),'runtime upgrade public inputs differ');
  assert(canonical(receipt.arithmeticPolicy)===canonical(arithmeticPolicy)&&canonical(receipt.numericTolerance)===canonical({atol:1e-5,rtol:1e-4})&&receipt.historicalFailureDisposition==='preserved-failed-cause-unknown','runtime upgrade arithmetic or historical disposition differs');
  const review=receipt.review;
  assert(keys(review,'sourceRevision,proofInventorySha256,localEvidenceSha256,independentReviewSha256')&&review.sourceRevision===c.manifest.sourceRevision&&[review.proofInventorySha256,review.localEvidenceSha256,review.independentReviewSha256].every(v=>digest.test(v)),'runtime upgrade reviewed source evidence required');
  const before=await recipe(core,prior),after=await recipe(core,c);
  assert(canonical(after.settings.arithmeticPolicy)===canonical(arithmeticPolicy),'runtime upgrade recipe arithmetic differs');
  const strip=value=>{const copy=structuredClone(value);delete copy.settings.sourceFiles;delete copy.settings.arithmeticPolicy;return copy;};
  assert(canonical(strip(before))===canonical(strip(after)),'runtime upgrade changes actual method or incumbent');
  assert(before.settings.sourceFiles&&after.settings.sourceFiles&&Object.values(after.settings.sourceFiles).every(v=>digest.test(v)),'runtime upgrade recipe source bindings missing');
  const changedSources=new Set(['arithmetic.py','export.py','device.py','runtime_probe.py','runner.py','hosted_canary.py','hosted_science.py','execution_recipe.py']);
  for(const name of new Set([...Object.keys(before.settings.sourceFiles),...Object.keys(after.settings.sourceFiles)]))
    assert(changedSources.has(name)||before.settings.sourceFiles[name]===after.settings.sourceFiles[name],'runtime upgrade unrelated trainer source differs');
  const beforeInputs=prior.manifest.inputs,afterInputs=c.manifest.inputs;
  const oldRecipe=beforeInputs.find(a=>a.sha256===prior.manifest.executionRecipeSha256),newRecipe=afterInputs.find(a=>a.sha256===c.manifest.executionRecipeSha256);
  assert(oldRecipe&&newRecipe&&oldRecipe.path===newRecipe.path&&oldRecipe.name===newRecipe.name&&beforeInputs.length===afterInputs.length&&canonical(beforeInputs.filter(a=>a!==oldRecipe))===canonical(afterInputs.filter(a=>a!==newRecipe)),'runtime upgrade changes frozen input inventory');
  const workload=m=>Object.fromEntries(['id','workIds','kind','device','argv','resumeArgv','runDir','outputs','outputPaths','expect'].map(key=>[key,m.phases[0][key]??null]));
  assert(canonical(workload(prior.manifest))===canonical(workload(c.manifest)),'runtime upgrade changes fixture workload');
  return {sha256:intent.runtimeUpgrade.sha256,receipt};
}
