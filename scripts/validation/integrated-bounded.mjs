import path from 'node:path';
import {mkdir,cp} from 'node:fs/promises';
import {command,git,readJSON,saveJSON} from './io.mjs';
import {hash} from './model.mjs';
import {validatePlan,stagePolicy} from './plan.mjs';
import {localRun,harnessRoot,fingerprint} from './local.mjs';
import {candidateCapabilities} from './capabilities.mjs';
import {ensureInstallation} from './execution.mjs';
import {loadSuccessfulEvidence,saveSuccessfulEvidence} from './reuse.mjs';
import {createCheckpoint,restoreCheckpoint} from './checkpoints.mjs';
import {renderReport} from './report.mjs';
import {publish} from './publish.mjs';

const stopped=async()=>{
 const result=await command(['lsof','-nP',...['9888','9887','10888','9988','9987','10088'].map(p=>'-iTCP:'+p),'-sTCP:LISTEN'],{allowFailure:true});
 return result.code===1&&!result.output;
};
export async function boundedIntegratedRun({spec,cwd=process.cwd(),dir,resume=false,config,publishReport=true,ciEvidence}){
 validatePlan(spec);dir=path.resolve(dir??path.join(cwd,'test-results','validation',`integrated-${Date.now()}`));await mkdir(dir,{recursive:true});
 const file=path.join(dir,'run.json'),previous=resume?await readJSON(file,null):null;
 await git(['fetch','origin',spec.base],cwd);const base=await git(['rev-parse','FETCH_HEAD'],cwd);
 const prs=[];
 for(const input of spec.prs){
  const p=JSON.parse((await command(['gh','pr','view',String(input.number),'--repo',spec.repository,'--json','number,title,url,headRefOid,headRefName,baseRefName,baseRefOid,state,isDraft'],{cwd})).output);
  if(p.state!=='OPEN')throw Error(`PR ${p.number} is not open`);
  await git(['fetch','origin',`pull/${p.number}/head`],cwd);
  if(await git(['rev-parse','FETCH_HEAD'],cwd)!==p.headRefOid)throw Error('PR changed during fetch');
  const old=previous?.prs?.find(x=>x.number===p.number);
  prs.push({...input,title:p.title,url:p.url,head:p.headRefOid,branch:p.headRefName,base:p.baseRefName,inputBaseSha:p.baseRefOid,open:true,draft:p.isDraft,...(old?.authorization?{authorization:{...old.authorization,state:old.base===p.baseRefName?old.authorization.state:'suspended'}}:{})});
 }
 const harnessRevision=await git(['rev-parse','HEAD'],harnessRoot),harnessFingerprint=await fingerprint(harnessRoot);
 const attempt=Date.now(),attemptDir=path.join(dir,'attempts',String(attempt));await mkdir(attemptDir,{recursive:true});
 const run={version:2,id:previous?.id??`integrated-${attempt}`,mode:'integrated',repository:spec.repository,startedAt:previous?.startedAt??new Date().toISOString(),base,prs,stages:[],risks:[],findings:[],mergeMethod:spec.mergeMethod??'squash',complete:false,harnessRevision,harnessFingerprint,plan:spec,publication:{status:'pending'},emailThreads:previous?.emailThreads??[],notifications:previous?.notifications??[],attempts:previous?[...(previous.attempts??[]),{id:previous.attempt,base:previous.base,stages:previous.stages,risks:previous.risks,publication:previous.publication}]:[],attempt};
 const root=path.join(path.dirname(cwd),`righelt-validation-${attempt}`);await git(['worktree','add','--detach',root,base],cwd);run.worktree=root;await saveJSON(file,run);
 let state=path.join(attemptDir,'state'),continuity,accountContinuity,legacyContinuity,canReuse=true;
 await mkdir(state,{recursive:true,mode:0o700});
 try{
  for(let index=0;index<=prs.length;index++){
   const before=await git(['rev-parse','HEAD'],root);
   if(index)await git(['merge','--no-edit','--no-ff',prs[index-1].head],root);
   const tree=await git(['rev-parse','HEAD^{tree}'],root);
   const capabilities=await candidateCapabilities(root);
   const changed=index?(await git(['diff','--name-only',before,'HEAD'],root)).split('\n').filter(Boolean):[];
   const policy=stagePolicy(spec,index,{accounts:capabilities.accounts,changed});
   const provenance=JSON.parse(JSON.stringify({version:2,base,tree,prefix:prs.slice(0,index).map(p=>({number:p.number,head:p.head})),policy,harnessFingerprint,node:process.version,platform:process.platform,arch:process.arch}));
   const prior=previous?.stages?.find(s=>s.index===index);
   if(canReuse&&prior?.status==='passed'&&prior.checkpoint&&prior.checkpointProvenance&&hash(prior.checkpointProvenance)===hash(provenance)){
    const restored=path.join(attemptDir,`restored-${index}`);
    try{
     const verified=prior.evidenceReceipt&&await loadSuccessfulEvidence(prior.evidenceReceipt,provenance);
     if(!verified)throw Error('Prior check and image evidence no longer verifies');
     await restoreCheckpoint({checkpoint:prior.checkpoint,destination:restored,provenance,assertStopped:stopped});state=restored;
     const recovered=await readJSON(path.join(state,'continuity-state.json'));
     continuity=recovered.continuity?path.join(state,recovered.continuity):undefined;accountContinuity=recovered.accountContinuity?path.join(state,recovered.accountContinuity):undefined;legacyContinuity=recovered.legacyContinuity?path.join(state,recovered.legacyContinuity):undefined;
     await cp(path.join(prior.artifactDir,'site'),path.join(dir,'site'),{recursive:true});
     run.stages.push({...structuredClone(verified),evidenceReceipt:prior.evidenceReceipt,reusedFrom:{attempt:previous.attempt,head:prior.head}});await saveJSON(file,run);continue;
    }catch(error){run.findings.push(`Stage ${index} checkpoint unavailable; regenerate this boundary and descendants.`);}
   }
   canReuse=false;
   await ensureInstallation(root,{log:path.join(attemptDir,`install-${index}.log`)});
   if(capabilities.accounts&&!accountContinuity)legacyContinuity=continuity;
   const next=path.join(state,`continuity-${index}.json`),stageDir=path.join(attemptDir,`stage-${index}`);
   const result=await localRun({cwd:root,dir:stageDir,base,full:policy.phase==='final',config,publishReport:false,stageIndex:index,policy,ciEvidence,cacheDir:path.join(dir,'check-cache'),persistRoot:path.join(state,'guest'),continuityInput:continuity,continuityOutput:next,accountPersistRoot:path.join(state,'account'),accountContinuityInput:accountContinuity,accountLegacyContinuityInput:legacyContinuity});
   const stage=result.stage;stage.aggregateHead=stage.head;stage.head=index?prs[index-1].head:base;stage.title=index?`After #${prs[index-1].number}: ${prs[index-1].title}`:'Baseline continuity';stage.artifactDir=stageDir;
   run.stages.push(stage);run.risks.push(...result.run.risks);
   await cp(path.join(stageDir,'site'),path.join(dir,'site'),{recursive:true});
   if(stage.status==='passed'){
    continuity=next;if(capabilities.accounts)accountContinuity=next;
    await saveJSON(path.join(state,'continuity-state.json'),{continuity:path.relative(state,continuity),accountContinuity:accountContinuity?path.relative(state,accountContinuity):null,legacyContinuity:legacyContinuity?path.relative(state,legacyContinuity):null});
    stage.checkpoint=path.join(attemptDir,`checkpoint-${index}`);stage.checkpointProvenance=provenance;
    await createCheckpoint({root:state,destination:stage.checkpoint,provenance,expiresAt:new Date(Date.now()+86400000).toISOString(),assertStopped:stopped});
    stage.evidenceReceipt=path.join(attemptDir,`evidence-receipt-${index}.json`);
    const artifacts=new Set(stage.checks.flatMap(c=>[...(c.log?[c.log]:[]),...(c.receipt?.evidence??[]).flatMap(e=>[e.log,e.archive])]));
    for(const item of stage.items??[])for(const image of item.images??[])for(const name of [image.src,image.thumbnail])artifacts.add(path.join(stageDir,'site',name));
    await saveSuccessfulEvidence(stage.evidenceReceipt,{provenance:JSON.parse(JSON.stringify(provenance)),result:JSON.parse(JSON.stringify(stage)),artifacts:[...artifacts],expiresAt:new Date(Date.now()+86400000).toISOString()});
   }
   await saveJSON(file,run);await renderReport(run,path.join(dir,'site'));
   if(stage.status!=='passed')break;
  }
 }catch(error){run.risks.push('Validation interrupted; inspect private startup-error.json');await saveJSON(path.join(attemptDir,'startup-error.json'),{error:error.message});}
 const remoteBase=(await git(['ls-remote','origin',`refs/heads/${spec.base}`],cwd)).split(/\s/)[0];
 if(remoteBase!==base)for(const s of run.stages)s.status='stale';
 for(let i=0;i<prs.length;i++){const current=JSON.parse((await command(['gh','pr','view',String(prs[i].number),'--repo',spec.repository,'--json','headRefOid'],{cwd})).output);if(current.headRefOid!==prs[i].head)for(const s of run.stages)if(s.index>=i+1)s.status='stale';}
 if(harnessFingerprint!==await fingerprint(harnessRoot))for(const s of run.stages)s.status='stale';
 run.complete=run.stages.length===prs.length+1&&run.stages.every(s=>s.status==='passed');
 await saveJSON(file,run);await renderReport(run,path.join(dir,'site'));
 if(publishReport){try{await publish(run,path.join(dir,'site'),config);}catch(error){run.publication={status:'failed',error:error.message};}await saveJSON(file,run);}
 return {run,dir};
}
