import { pathToFileURL } from 'node:url';
import { assert } from './policy.mjs';
import { GitHubControlWriter } from './github-control.mjs';
import { RunpodCleanup,sweepExternal } from './external-cleanup.mjs';

export async function cleanupFromEnvironment(env=process.env,{fetcher,clock}={}) {
  assert(env.COMPUTE_CONTROL_ARMED==='true','external cleanup is not armed');
  assert(env.GITHUB_REPOSITORY===env.COMPUTE_CONTROL_REPOSITORY,'cleanup must run in the private control repository');
  assert(env.GITHUB_REF===`refs/heads/${env.COMPUTE_CONTROL_BRANCH??'main'}`,'cleanup requires the reviewed default branch');
  const store=new GitHubControlWriter({repository:env.COMPUTE_CONTROL_REPOSITORY,token:env.COMPUTE_CONTROL_WRITE_TOKEN,branch:env.COMPUTE_CONTROL_BRANCH??'main',fetcher});
  const reference={repository:env.COMPUTE_CONTROL_REPOSITORY,commit:env.COMPUTE_PREARM_COMMIT,path:env.COMPUTE_PREARM_PATH,sha256:env.COMPUTE_PREARM_SHA256};
  const provider=new RunpodCleanup({token:env.RUNPOD_CLEANUP_API_KEY,accountId:env.RUNPOD_ACCOUNT_ID,fetcher});
  return sweepExternal({store,reference,provider,clock,workflowRevision:env.COMPUTE_RUNTIME_REVISION});
}
export function cleanupProcessResult(result) {
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
