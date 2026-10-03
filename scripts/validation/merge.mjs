import {command} from './io.mjs';
import {canMerge,readiness} from './model.mjs';
export async function refreshPR(run,number,{cwd=process.cwd(),execute=command}={}){
 const pr=run.prs.find(p=>p.number===number);if(!pr)throw Error('PR is outside this run');
 const repo=run.repository;if(!/^[\w.-]+\/[\w.-]+$/.test(repo??''))throw Error('Run repository is required');
 const read=async n=>JSON.parse((await execute(['gh','pr','view',String(n),'--repo',repo,'--json','number,headRefOid,baseRefOid,baseRefName,state,isDraft,mergeable,reviewDecision,statusCheckRollup,mergedAt,mergeCommit'],{cwd})).output);
 const current=await read(number);
 if(current.headRefOid!==pr.head){pr.head=current.headRefOid;for(const s of run.stages)if(s.index>=(run.prs.indexOf(pr)+1)||run.mode==='local'){s.status='stale';s.visualReviewed=false;}}
 if(pr.base!==current.baseRefName && pr.authorization)pr.authorization.state='suspended';
 pr.base=current.baseRefName;pr.open=current.state==='OPEN';pr.draft=current.isDraft;pr.conflicts=current.mergeable==='CONFLICTING'?true:current.mergeable==='MERGEABLE'?false:null;
 pr.merged=current.state==='MERGED';pr.closed=current.state==='CLOSED';
 if(pr.merged&&pr.authorization)pr.authorization.state='consumed';
 const checks=current.statusCheckRollup??[];
 // All reported checks are considered; never reinterpret an absent result as green.
 pr.checks=checks.length===0?'unknown':checks.some(c=>['FAILURE','ERROR','CANCELLED','TIMED_OUT','ACTION_REQUIRED'].includes(c.conclusion??c.state))?'failed':checks.every(c=>['SUCCESS','NEUTRAL','SKIPPED'].includes(c.conclusion??c.state))?'passed':'pending';
 pr.review=current.reviewDecision==='APPROVED'?'passed':current.reviewDecision==='CHANGES_REQUESTED'?'failed':'pending';
 // Empty reviewDecision is only acceptable after the agent verifies no review requirement.
 if(!current.reviewDecision&&pr.noReviewRequired===true)pr.review='passed';
 pr.waitingFor=[];for(const dep of pr.dependsOn??[]){if((await read(dep)).state!=='MERGED')pr.waitingFor.push(dep);}
 pr.gatesHead=current.headRefOid;pr.gatesBase=current.baseRefOid;pr.gatesCheckedAt=new Date().toISOString();
 const stage=run.mode==='local'?run.stages[0]:run.stages.find(s=>s.index===run.prs.indexOf(pr)+1);
 const result=readiness(pr,stage,current.baseRefOid);pr.readiness=pr.merged?'merged':result.status;pr.waiting=result.waiting;
 return {pr,stage,current};
}
export async function mergeAuthorized(run,number,{cwd=process.cwd(),execute=command}={}){
 if(!Number.isFinite(Date.parse(run.replyCheckedAt))||Date.parse(run.replyCheckedAt)>Date.now()||Date.now()-Date.parse(run.replyCheckedAt)>60_000)throw Error('Re-read tracked reply threads before merging (within 60 seconds)');
 const {pr,stage,current}=await refreshPR(run,number,{cwd,execute});
 if(!canMerge(pr,stage,current.baseRefOid))throw Error(`Not ready or not authorized: ${pr.waiting.join(', ')}`);
 if(!['merge','squash','rebase'].includes(run.mergeMethod))throw Error('Record a repository-allowed mergeMethod');
 await execute(['gh','pr','merge',String(number),'--repo',run.repository,`--${run.mergeMethod}`,'--match-head-commit',current.headRefOid],{cwd});
 const after=await refreshPR(run,number,{cwd,execute});
 if(!after.pr.merged){after.pr.readiness='queued or pending merge';return false;}
 after.pr.authorization.state='consumed';after.pr.mergeCommit=after.current.mergeCommit?.oid;after.pr.mergedAt=after.current.mergedAt;
 for(const s of run.stages)if(s.index>run.prs.indexOf(pr)+1){s.status='stale';s.visualReviewed=false;}return true;
}
