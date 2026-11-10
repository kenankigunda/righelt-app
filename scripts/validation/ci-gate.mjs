const gateName='PR validation';
const workflowPath='.github/workflows/ci.yml';
const positiveInteger=value=>Number.isSafeInteger(value)&&value>0;

// A successful label alone is not evidence of the repository's required gate.
// Resolve the linked job through GitHub's primary resources at every refresh.
export async function resolvePRGate({current,repository,cwd,execute}) {
 const checks=current.statusCheckRollup??[];
 const candidates=checks.filter(check=>(check.name??check.context)===gateName);
 const advisoryChecks=checks.filter(check=>(check.name??check.context)!==gateName);
 const result={status:'unknown',gate:null,advisoryChecks,namedGateCount:candidates.length};
 if(candidates.length!==1)return {...result,reason:candidates.length?'Ambiguous PR validation checks':'PR validation check missing'};
 const selected=candidates[0];
 try {
  if(selected.__typename!=='CheckRun'||selected.workflowName!=='CI')throw Error('Required check is not the canonical Actions workflow');
  const url=new URL(selected.detailsUrl);
  const match=/^\/([^/]+\/[^/]+)\/actions\/runs\/([1-9]\d*)\/job\/([1-9]\d*)$/.exec(url.pathname);
  if(url.origin!=='https://github.com'||url.search||url.hash||!match||match[1]!==repository)throw Error('Required check job URL differs');
  const runId=Number(match[2]),jobId=Number(match[3]);
  if(!positiveInteger(runId)||!positiveInteger(jobId))throw Error('Invalid required check identity');
  const read=async suffix=>JSON.parse((await execute(['gh','api',`repos/${repository}/${suffix}`],{cwd})).output);
  const job=await read(`actions/jobs/${jobId}`);
  if(job.id!==jobId||job.run_id!==runId||job.name!==gateName||job.head_sha!==current.headRefOid||job.html_url!==selected.detailsUrl)throw Error('Required job identity differs');
  const checkURL=new URL(job.check_run_url);
  const checkMatch=/^\/repos\/([^/]+\/[^/]+)\/check-runs\/([1-9]\d*)$/.exec(checkURL.pathname);
  if(checkURL.origin!=='https://api.github.com'||checkURL.search||checkURL.hash||!checkMatch||checkMatch[1]!==repository)throw Error('Required check primary URL differs');
  const checkId=Number(checkMatch[2]);
  if(!positiveInteger(checkId))throw Error('Invalid primary check identity');
  const check=await read(`check-runs/${checkId}`);
  const run=await read(`actions/runs/${runId}`);
  if(check.id!==checkId||check.name!==gateName||check.head_sha!==current.headRefOid||check.app?.slug!=='github-actions'||check.app?.owner?.login!=='github'||!positiveInteger(check.check_suite?.id)||check.check_suite.id!==run.check_suite_id)throw Error('Required check provenance differs');
  if(run.id!==runId||run.repository?.full_name!==repository||run.path!==workflowPath||run.name!=='CI'||run.head_sha!==current.headRefOid||run.event!=='pull_request'||!positiveInteger(run.run_attempt)||job.run_attempt!==run.run_attempt)throw Error('Required workflow run provenance differs');
  const prs=run.pull_requests?.filter(pr=>pr.number===current.number);
  if(prs?.length!==1||prs[0].head?.sha!==current.headRefOid||prs[0].base?.sha!==current.baseRefOid||prs[0].base?.ref!==current.baseRefName)throw Error('Required workflow PR/base provenance differs');
  // The run read is the latest attempt. A prior attempt's check cannot pass it.
  if(job.status!==check.status||job.conclusion!==check.conclusion||selected.status?.toLowerCase()!==check.status||(selected.conclusion?.toLowerCase()??null)!==check.conclusion)throw Error('Required check changed during gate reads');
  const status=check.status!=='completed'?'pending':check.conclusion==='success'?'passed':'failed';
  return {...result,status,gate:{verified:true,name:gateName,workflowPath,repository,number:current.number,head:current.headRefOid,base:current.baseRefOid,baseRef:current.baseRefName,runId,runAttempt:run.run_attempt,jobId,checkId,checkSuiteId:run.check_suite_id,status,checkedAt:new Date().toISOString()}};
 }catch(error){return {...result,reason:error.message};}
}

export function currentPRGatePassed(pr,currentBase,{repository,now=Date.now()}={}) {
 const gate=pr.ciGate,checked=Date.parse(gate?.checkedAt);
 return gate?.verified===true&&gate.status==='passed'&&gate.name===gateName&&gate.workflowPath===workflowPath
  &&typeof gate.repository==='string'&&gate.repository===repository&&gate.number===pr.number&&gate.head===pr.head&&gate.base===currentBase&&gate.baseRef===pr.base
  &&[gate.runId,gate.runAttempt,gate.jobId,gate.checkId,gate.checkSuiteId].every(positiveInteger)
  &&Number.isFinite(checked)&&checked<=now&&now-checked<=60_000;
}
