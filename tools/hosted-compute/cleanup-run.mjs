import { pathToFileURL } from 'node:url';
import { assert } from './policy.mjs';
import { GitHubControlWriter } from './github-control.mjs';
import { RunpodCleanup,sweepExternal } from './external-cleanup.mjs';
import {readCleanupRegistry,sameReference} from './manual-authority.mjs';

export async function cleanupFromEnvironment(env=process.env,{fetcher,clock}={}) {
  assert(env.COMPUTE_CONTROL_ARMED==='true','external cleanup is not armed');
  assert(env.GITHUB_REPOSITORY===env.COMPUTE_CONTROL_REPOSITORY,'cleanup must run in the private control repository');
  assert(env.GITHUB_REF===`refs/heads/${env.COMPUTE_CONTROL_BRANCH??'main'}`,'cleanup requires the reviewed default branch');
  const store=new GitHubControlWriter({repository:env.COMPUTE_CONTROL_REPOSITORY,token:env.COMPUTE_CONTROL_WRITE_TOKEN,branch:env.COMPUTE_CONTROL_BRANCH??'main',fetcher});
  const reference={repository:env.COMPUTE_CONTROL_REPOSITORY,commit:env.COMPUTE_PREARM_COMMIT,path:env.COMPUTE_PREARM_PATH,sha256:env.COMPUTE_PREARM_SHA256};
  const provider=new RunpodCleanup({token:env.RUNPOD_CLEANUP_API_KEY,accountId:env.RUNPOD_ACCOUNT_ID,fetcher});
  const registryKeys=['COMPUTE_CLEANUP_REGISTRY_COMMIT','COMPUTE_CLEANUP_REGISTRY_PATH','COMPUTE_CLEANUP_REGISTRY_SHA256'];
  if(registryKeys.some(k=>env[k])){
    assert(registryKeys.every(k=>env[k]),'complete cleanup registry reference required');
    const registry=await readCleanupRegistry(store,{repository:env.COMPUTE_CONTROL_REPOSITORY,commit:env.COMPUTE_CLEANUP_REGISTRY_COMMIT,path:env.COMPUTE_CLEANUP_REGISTRY_PATH,sha256:env.COMPUTE_CLEANUP_REGISTRY_SHA256});
    assert(registry.runtimeRevision===env.COMPUTE_RUNTIME_REVISION&&registry.references.some(r=>sameReference(r,reference)),'registry runtime or original watch differs');
    const results=[];
    for(const ref of registry.references){
      try{results.push({...await sweepExternal({store,reference:ref,provider,clock,workflowRevision:env.COMPUTE_RUNTIME_REVISION,registryAuthority:registry}),prearmSha256:ref.sha256});}
      catch{results.push({armed:true,remaining:null,failures:[{operation:'ownership-sweep',reason:'cleanup-unavailable'}]});}
    }
    return {schema:1,kind:'dual-cleanup-result',armed:true,results};
  }
  return sweepExternal({store,reference,provider,clock,workflowRevision:env.COMPUTE_RUNTIME_REVISION});
}
export function cleanupProcessResult(result) {
  if(result.kind==='dual-cleanup-result'){
    const children=result.results.map(cleanupProcessResult);
    return {status:{state:'dual-cleanup',armed:true,cleanupObservedAbsent:children.every(c=>c.status.cleanupObservedAbsent),usageReviewRequired:children.some(c=>c.status.usageReviewRequired),ownershipSets:result.results.map(r=>({prearmSha256:r.prearmSha256,state:r.state??'terminal',failures:r.failures?.length??0,cleanupObservedAbsent:r.cleanupObservedAbsent??false,durableReceiptConfirmed:r.durableReceiptConfirmed??false}))},exitCode:children.some(c=>c.exitCode)?1:0};
  }
  return {status:{state:result.state??'terminal',cleanupObservedAbsent:result.cleanupObservedAbsent??false,armed:result.armed,usageReviewRequired:result.usageReviewRequired===true},
    exitCode:result.failures?.length || result.remaining?.length || result.usageReviewRequired ? 1 : 0};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  cleanupFromEnvironment().then(result=>{
    // Only the durable receipt's nonsecret status is printed. No API bodies,
    // headers, source manifests, provider keys or bootstrap environment values.
    const {status,exitCode}=cleanupProcessResult(result);
    console.log(JSON.stringify(status));process.exitCode=exitCode;
  }).catch(()=>{console.error('External cleanup could not complete. Inspect private control receipts and provider state.');process.exitCode=1;});
}
