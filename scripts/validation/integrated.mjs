import path from 'node:path';
import {mkdir,cp,access} from 'node:fs/promises';
import {git,command,readJSON,saveJSON} from './io.mjs';
import {localRun} from './local.mjs';
import {renderReport} from './report.mjs';
import {publish} from './publish.mjs';
import {VERSION,hash} from './model.mjs';
export function validateManifest(m){
 if(m?.version!==VERSION||typeof m.repository!=='string'||! /^[\w.-]+\/[\w.-]+$/.test(m.repository)||typeof m.base!=='string'||!Array.isArray(m.prs)||!m.prs.length)throw Error('Expected version, owner/repo, base and ordered prs');
 const seen=new Set();for(const p of m.prs){if(!Number.isSafeInteger(p.number)||p.number<1||seen.has(p.number))throw Error('PR numbers must be positive and unique');for(const dep of p.dependsOn??[])if(!seen.has(dep))throw Error('Dependencies must occur earlier in merge order');seen.add(p.number);}return m;
}
export async function integratedRun({manifest,cwd=process.cwd(),dir,resume=false,config,publishReport=true}){
 const spec=validateManifest(await readJSON(manifest));
 await command(['git','fetch','origin',spec.base],{cwd});const base=await git(['rev-parse','FETCH_HEAD'],cwd);
 const prs=[];for(const input of spec.prs){const response=await command(['gh','pr','view',String(input.number),'--repo',spec.repository,'--json','number,title,url,headRefOid,headRefName,baseRefName,state,isDraft'],{cwd});const p=JSON.parse(response.output);if(p.state!=='OPEN')throw Error(`PR ${p.number} is not open`);await command(['git','fetch','origin',`pull/${p.number}/head`],{cwd});if(await git(['rev-parse','FETCH_HEAD'],cwd)!==p.headRefOid)throw Error('PR changed during fetch; retry');prs.push({...input,title:p.title,url:p.url,head:p.headRefOid,branch:p.headRefName,base:p.baseRefName,open:true,draft:p.isDraft});}
 dir=path.resolve(dir??path.join(cwd,'test-results','validation',`integrated-${Date.now()}`));await mkdir(dir,{recursive:true});const file=path.join(dir,'run.json');
 let run=resume?await readJSON(file):{version:VERSION,id:`integrated-${Date.now()}`,mode:'integrated',repository:spec.repository,startedAt:new Date().toISOString(),stages:[],risks:[],prs:[],base};
 // Keep immutable prior attempts; rebuild from exact source heads, never reuse integration patches.
 const signature=hash({repository:spec.repository,base,prs:prs.map(p=>({number:p.number,head:p.head,base:p.base,dependsOn:p.dependsOn??[]}))});const previous=run.signature;
 if(resume&&previous===signature&&run.stages.length===prs.length+1&&run.stages.every(s=>s.status==='passed')){console.log('Matching stages already passed. Refresh PR gates and agent review before merging.');return {run,dir};}
 if(run.stages.length)(run.attempts??=[]).push({signature:previous,stages:run.stages});
 for(const p of prs){const old=run.prs.find(x=>x.number===p.number);if(old?.authorization)p.authorization={...old.authorization,state:old.base===p.base?old.authorization.state:'suspended'};}
 run.complete=false;run.base=base;run.prs=prs;run.signature=signature;run.stages=[];await saveJSON(file,run);
 const attempt=Date.now();const root=path.join(path.dirname(cwd),`righelt-validation-${attempt}`);await command(['git','worktree','add','--detach',root,base],{cwd});run.worktree=root;await saveJSON(file,run);
 try{
  await command(['pnpm','install','--frozen-lockfile','--ignore-scripts'],{cwd:root,log:path.join(dir,'install.log')});
  const upgrade=path.join(dir,`upgrade-state-${attempt}`);await mkdir(upgrade,{recursive:true});let continuity;
  for(let i=0;i<=prs.length;i++){
   if(i){const r=await command(['git','merge','--no-edit','--no-ff',prs[i-1].head],{cwd:root,allowFailure:true});if(r.code){run.risks.push(`Merge conflict at PR #${prs[i-1].number}. Resolve in source PR; retained worktree: ${root}`);run.stages.push({id:`stage-${i}`,index:i,title:`PR #${prs[i-1].number}`,status:'failed',checks:[{name:'Aggregate source PR',status:'failed'}],items:[]});break;}}
   if(i) await command(['pnpm','install','--frozen-lockfile','--ignore-scripts'],{cwd:root,log:path.join(dir,`install-${i}.log`)});
   const next=path.join(dir,`continuity-${i}.json`);
   const fresh=await localRun({cwd:root,dir:path.join(dir,`fresh-${i}`),base,full:true,config,publishReport:false});
   if(fresh.stage.status!=='passed'){await cp(path.join(dir,`fresh-${i}`,'site'),path.join(dir,'site'),{recursive:true});fresh.stage.id=`stage-${i}`;fresh.stage.index=i;run.stages.push(fresh.stage);run.risks.push(`Fresh-install validation failed at stage ${i}; inspect private fresh-${i} logs.`);break;}
   const result=await localRun({cwd:root,dir,base,full:true,config,publishReport:false,run,stageIndex:i,persistRoot:upgrade,continuityInput:continuity,continuityOutput:next});
   run=result.run;result.stage.aggregateHead=result.stage.head;result.stage.head=i?prs[i-1].head:base;result.stage.title=i?`After #${prs[i-1].number}: ${prs[i-1].title}`:'Unchanged base';result.stage.checks.unshift({name:'Fresh-install full verification',status:'passed'});
   await saveJSON(file,run);await renderReport(run,path.join(dir,'site'));
   if(publishReport){try{await publish(run,path.join(dir,'site'),config,{cwd});}catch(e){run.publication={status:'failed',error:e.message};}await saveJSON(file,run);}
   if(result.stage.status!=='passed')break;continuity=next;
  }
 }catch(e){run.risks.push('Integrated validation interrupted; inspect private startup-error.json.');await saveJSON(path.join(dir,'startup-error.json'),{error:e.message});}
 // Read heads again; a moving input invalidates evidence even if all checks passed.
 const remoteBase=await command(['git','ls-remote','origin',`refs/heads/${spec.base}`],{cwd});if(remoteBase.output.split(/\s/)[0]!==base)for(const s of run.stages)s.status='stale';
 for(let i=0;i<prs.length;i++){const fresh=await command(['gh','pr','view',String(prs[i].number),'--repo',spec.repository,'--json','headRefOid'],{cwd});if(JSON.parse(fresh.output).headRefOid!==prs[i].head)for(const s of run.stages)if(s.index>=i+1)s.status='stale';}
 run.complete=run.stages.length===prs.length+1&&run.stages.every(s=>s.status==='passed');
 await saveJSON(file,run);await renderReport(run,path.join(dir,'site'));
 if(publishReport){try{await publish(run,path.join(dir,'site'),config,{cwd});}catch(e){run.publication={status:'failed',error:e.message};}await saveJSON(file,run);}
 return {run,dir};
}
