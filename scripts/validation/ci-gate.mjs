const gateName='PR validation';
const workflowPath='.github/workflows/ci.yml';
const positiveInteger=value=>Number.isSafeInteger(value)&&value>0;
const liveProofMatches=(live,{repository,base,head,baseRef,now=Date.now()})=>{
 const checked=Date.parse(live?.checkedAt);
 return live?.verified===true&&live.repository===repository&&live.ref==='refs/heads/'+baseRef&&live.sha===base&&live.head===head&&live.mergeBase===base&&live.behindBy===0
  &&live.compareURL===`https://api.github.com/repos/${repository}/compare/${base}...${head}`
  &&Number.isSafeInteger(live.aheadBy)&&((live.status==='ahead'&&live.aheadBy>0)||(live.status==='identical'&&live.aheadBy===0&&base===head))
  &&Number.isFinite(checked)&&checked<=now&&now-checked<=60_000;
};

// PR and workflow base SHAs are creation-time snapshots. The live destination
// ref is separate primary evidence, and the tested head must contain it.
export async function resolveLivePRBase({current,repository,cwd,execute}) {
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository??'')||typeof current.baseRefName!=='string'||!current.baseRefName||!current.headRefOid)throw Error('Live PR base identity missing');
 const ref='refs/heads/'+current.baseRefName;
 const suffix=current.baseRefName.split('/').map(encodeURIComponent).join('/');
 const read=async route=>JSON.parse((await execute(['gh','api',`repos/${repository}/${route}`],{cwd})).output);
 const actual=await read('git/ref/heads/'+suffix),sha=actual.object?.sha;
 if(actual.ref!==ref||actual.object?.type!=='commit'||typeof sha!=='string'||!sha||actual.object.url!==`https://api.github.com/repos/${repository}/git/commits/${sha}`)throw Error('Live PR base ref provenance differs');
 const compareURL=`https://api.github.com/repos/${repository}/compare/${sha}...${current.headRefOid}`;
 const compared=await read(`compare/${sha}...${current.headRefOid}`);
 if(compared.url!==compareURL||compared.base_commit?.sha!==sha||compared.merge_base_commit?.sha!==sha||compared.behind_by!==0||!Number.isSafeInteger(compared.ahead_by)||!((compared.status==='ahead'&&compared.ahead_by>0)||(compared.status==='identical'&&compared.ahead_by===0&&sha===current.headRefOid)))throw Error('Tested PR head does not contain the live base');
 return {verified:true,repository,ref,sha,head:current.headRefOid,compareURL,status:compared.status,aheadBy:compared.ahead_by,behindBy:compared.behind_by,mergeBase:compared.merge_base_commit.sha,checkedAt:new Date().toISOString()};
}

// A successful label alone is not evidence of the repository's required gate.
// Resolve the linked job through GitHub's primary resources at every refresh.
export async function resolvePRGate({current,repository,cwd,execute,liveBase}) {
 const checks=current.statusCheckRollup??[];
 const candidates=checks.filter(check=>(check.name??check.context)===gateName);
 const advisoryChecks=checks.filter(check=>(check.name??check.context)!==gateName);
 const result={status:'unknown',gate:null,advisoryChecks,namedGateCount:candidates.length};
 if(candidates.length!==1)return {...result,reason:candidates.length?'Ambiguous PR validation checks':'PR validation check missing'};
 const selected=candidates[0];
 try {
  liveBase??=await resolveLivePRBase({current,repository,cwd,execute});
  if(!liveProofMatches(liveBase,{repository,base:liveBase.sha,head:current.headRefOid,baseRef:current.baseRefName}))throw Error('Live PR base proof differs');
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
  return {...result,status,gate:{verified:true,name:gateName,workflowPath,repository,number:current.number,head:current.headRefOid,base:liveBase.sha,baseSnapshot:current.baseRefOid,baseRef:current.baseRefName,liveBase,runId,runAttempt:run.run_attempt,jobId,checkId,checkSuiteId:run.check_suite_id,status,checkedAt:new Date().toISOString()}};
 }catch(error){return {...result,reason:error.message};}
}

export function currentPRGatePassed(pr,currentBase,{repository,now=Date.now()}={}) {
 const gate=pr.ciGate,checked=Date.parse(gate?.checkedAt),live=gate?.liveBase;
 return gate?.verified===true&&gate.status==='passed'&&gate.name===gateName&&gate.workflowPath===workflowPath
  &&typeof gate.repository==='string'&&gate.repository===repository&&gate.number===pr.number&&gate.head===pr.head&&gate.base===currentBase&&gate.baseRef===pr.base
  &&typeof pr.baseSnapshot==='string'&&gate.baseSnapshot===pr.baseSnapshot
  &&liveProofMatches(live,{repository,base:currentBase,head:pr.head,baseRef:pr.base,now})
  &&[gate.runId,gate.runAttempt,gate.jobId,gate.checkId,gate.checkSuiteId].every(positiveInteger)
  &&Number.isFinite(checked)&&checked<=now&&now-checked<=60_000;
}
