import {command} from './io.mjs';
import {canMerge,readiness} from './model.mjs';
export function verifyCheckApplicability(evidence,head,base){
 return evidence?.verified===true&&evidence.head===head&&evidence.base===base
  &&evidence.workflowFiltersVerified===true&&evidence.requiredChecksVerified===true
  &&Array.isArray(evidence.requiredChecks)&&evidence.requiredChecks.length===0
  &&Array.isArray(evidence.sources)&&evidence.sources.length>0
  &&evidence.sources.every(source=>typeof source==='string'&&source.trim().length>0);
}
export async function refreshPR(run,number,{cwd=process.cwd(),execute=command}={}){
 const pr=run.prs.find(p=>p.number===number);if(!pr)throw Error('PR is outside this run');
 const repo=run.repository;if(!/^[\w.-]+\/[\w.-]+$/.test(repo??''))throw Error('Run repository is required');
 const read=async n=>JSON.parse((await execute(['gh','pr','view',String(n),'--repo',repo,'--json','number,headRefOid,baseRefOid,baseRefName,state,isDraft,mergeable,reviewDecision,statusCheckRollup,mergedAt,mergeCommit'],{cwd})).output);
 const current=await read(number);
 // A boundary is certified by the final aggregate, so every input must still match.
 if(run.version===2){
  for(const input of run.prs){
   const actual=input.number===number?current:await read(input.number);
   if(actual.baseRefName!==input.base||!input.inputBaseSha||actual.baseRefOid!==input.inputBaseSha){run.complete=false;for(const stage of run.stages){stage.status='stale';stage.visualReviewed=false;}}
   if(actual.headRefOid!==input.head){
    input.head=actual.headRefOid;run.complete=false;
    for(const stage of run.stages)if(run.mode==='local'||stage.index>=run.prs.indexOf(input)+1){stage.status='stale';stage.visualReviewed=false;}
   }
  }
  if(current.baseRefOid!==run.base){run.complete=false;for(const stage of run.stages){stage.status='stale';stage.visualReviewed=false;}}
 }
 // Native stack merges can include predecessors. V1 authorizes individual PRs,
 // so read membership from the primary resource and reject stacks explicitly.
 const metadata=JSON.parse((await execute(['gh','api',`repos/${repo}/pulls/${number}`],{cwd})).output);
 if(current.number!==number||metadata.number!==number||metadata.head?.sha!==current.headRefOid||metadata.base?.sha!==current.baseRefOid||metadata.base?.ref!==current.baseRefName)throw Error('PR revisions changed during gate reads; refresh before merging');
 // GitHub omits stack for ordinary PRs; a present value must be null or an
 // object. Every stack object is unsupported, regardless of its position.
 if(Object.hasOwn(metadata,'stack')&&metadata.stack!==null&&(typeof metadata.stack!=='object'||Array.isArray(metadata.stack)))throw Error('Malformed native stack membership; cannot verify merge scope');
 pr.nativeStack=metadata.stack??null;
 if(current.headRefOid!==pr.head){pr.head=current.headRefOid;for(const s of run.stages)if(s.index>=(run.prs.indexOf(pr)+1)||run.mode==='local'){s.status='stale';s.visualReviewed=false;}}
 if(pr.base!==current.baseRefName && pr.authorization)pr.authorization.state='suspended';
 pr.base=current.baseRefName;pr.open=current.state==='OPEN';pr.draft=current.isDraft;pr.conflicts=current.mergeable==='CONFLICTING'?true:current.mergeable==='MERGEABLE'?false:null;
 pr.merged=current.state==='MERGED';pr.closed=current.state==='CLOSED';
 if(pr.merged&&pr.authorization)pr.authorization.state='consumed';
 const checks=current.statusCheckRollup??[];
 // All reported checks are considered; never reinterpret an absent result as green.
 pr.checks=checks.length===0?(verifyCheckApplicability(pr.checkApplicability,current.headRefOid,current.baseRefOid)?'not-applicable':'unknown'):checks.some(c=>['FAILURE','ERROR','CANCELLED','TIMED_OUT','ACTION_REQUIRED'].includes(c.conclusion??c.state))?'failed':checks.every(c=>['SUCCESS','NEUTRAL','SKIPPED'].includes(c.conclusion??c.state))?'passed':'pending';
 pr.review=current.reviewDecision==='APPROVED'?'passed':current.reviewDecision==='CHANGES_REQUESTED'?'failed':'pending';
 // Empty reviewDecision is only acceptable after the agent verifies no review requirement.
 if(!current.reviewDecision&&pr.noReviewRequired===true)pr.review='passed';
 pr.waitingFor=[];for(const dep of pr.dependsOn??[]){if((await read(dep)).state!=='MERGED')pr.waitingFor.push(dep);}
 pr.gatesHead=current.headRefOid;pr.gatesBase=current.baseRefOid;pr.gatesCheckedAt=new Date().toISOString();
 const stage=run.mode==='local'?run.stages[0]:run.stages.find(s=>s.index===run.prs.indexOf(pr)+1);
 const result=readiness(pr,stage,current.baseRefOid,run);pr.readiness=pr.merged?'merged':result.status;pr.waiting=result.waiting;
 return {pr,stage,current};
}
export async function mergeAuthorized(run,number,{cwd=process.cwd(),execute=command}={}){
 if(!Number.isFinite(Date.parse(run.replyCheckedAt))||Date.parse(run.replyCheckedAt)>Date.now()||Date.now()-Date.parse(run.replyCheckedAt)>60_000)throw Error('Re-read tracked reply threads before merging (within 60 seconds)');
 const {pr,stage,current}=await refreshPR(run,number,{cwd,execute});
 if(!canMerge(pr,stage,current.baseRefOid,run))throw Error(`Not ready or not authorized: ${pr.waiting.join(', ')}`);
 if(!['merge','squash','rebase'].includes(run.mergeMethod))throw Error('Record a repository-allowed mergeMethod');
 const repository=JSON.parse((await execute(['gh','api',`repos/${run.repository}`],{cwd})).output);
 const permission={merge:'allow_merge_commit',squash:'allow_squash_merge',rebase:'allow_rebase_merge'}[run.mergeMethod];
 if(repository[permission]!==true)throw Error(`Repository does not allow ${run.mergeMethod} merging; choose an explicitly allowed method`);
 await execute(['gh','pr','merge',String(number),'--repo',run.repository,`--${run.mergeMethod}`,'--match-head-commit',current.headRefOid],{cwd});
 const after=await refreshPR(run,number,{cwd,execute});
 if(!after.pr.merged){after.pr.readiness='queued or pending merge';return false;}
 after.pr.authorization.state='consumed';after.pr.mergeCommit=after.current.mergeCommit?.oid;after.pr.mergedAt=after.current.mergedAt;
 for(const s of run.stages)if(s.index>run.prs.indexOf(pr)+1){s.status='stale';s.visualReviewed=false;}return true;
}
