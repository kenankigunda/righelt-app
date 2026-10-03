import {readFile,mkdir,rm,cp,readdir,lstat,readlink} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {command,git,saveJSON,readJSON} from './io.mjs';
import {hash,coverage,VERSION} from './model.mjs';
import {renderReport} from './report.mjs';
import {publish} from './publish.mjs';
export async function fingerprint(cwd){const tracked=await git(['ls-files','-z'],cwd);const untracked=await git(['ls-files','--others','--exclude-standard','-z'],cwd);const entries=[];for(const p of [...new Set((tracked+'\0'+untracked).split('\0').filter(Boolean))].sort()){try{entries.push([p,hash((await lstat(path.join(cwd,p))).isSymbolicLink()?await readlink(path.join(cwd,p)):await readFile(path.join(cwd,p)))]);}catch(e){if(e.code==='ENOENT')entries.push([p,'deleted']);else throw e;}}return hash(entries);}
export async function localRun({cwd=process.cwd(),dir,base='origin/main',full=false,config={},publishReport=true,run,stageIndex=0,persistRoot,continuityInput,continuityOutput}={}){
 const revision=await git(['rev-parse','HEAD'],cwd);const baseSha=await git(['rev-parse',base],cwd);
 const changed=(await git(['diff','--name-only',baseSha],cwd)+'\n'+await git(['ls-files','--others','--exclude-standard'],cwd)).split('\n').filter(Boolean);const selection=coverage(changed);
 run??={version:VERSION,id:`${Date.now()}-${revision.slice(0,8)}`,startedAt:new Date().toISOString(),mode:'local',base:baseSha,revision,fingerprint:await fingerprint(cwd),prs:[],stages:[],risks:[]};
 dir??=path.join(cwd,'test-results','validation',run.id);await mkdir(dir,{recursive:true});const site=path.join(dir,'site');
 const stage={id:`stage-${stageIndex}`,index:stageIndex,title:stageIndex?`Merge point ${stageIndex}`:'Baseline / local validation',head:revision,base:baseSha,status:'running',checks:[],items:[],unmapped:selection.unmapped,visualReviewed:false,sourceClean:!(await git(['status','--porcelain'],cwd))};run.stages=run.stages.filter(s=>s.index!==stageIndex);run.stages.push(stage);
 const file=path.join(dir,'run.json');const save=async()=>{await saveJSON(file,run);await renderReport(run,site);};await save();
 const lock=path.join(os.tmpdir(),'righelt-validation-9888.lock');let locked=false;
 try{await mkdir(lock);locked=true;await saveJSON(path.join(lock,'owner.json'),{pid:process.pid,run:run.id,cwd});
  const env={RIGHELT_VALIDATION:'1',RIGHELT_E2E_WEB_PORT:'9888',RIGHELT_EVIDENCE_DIR:site,RIGHELT_EVIDENCE_JSON:path.join(dir,`evidence-${stageIndex}.json`),PLAYWRIGHT_OUTPUT_DIR:path.join(dir,`debug-${stageIndex}`),...(persistRoot?{RIGHELT_E2E_PERSIST_ROOT:persistRoot}:{}),...(continuityInput?{RIGHELT_CONTINUITY_INPUT:continuityInput}:{}),...(continuityOutput?{RIGHELT_CONTINUITY_FILE:continuityOutput}:{})};
  const checks=[['Typecheck',['pnpm','typecheck']],['Generated runtime',['pnpm','check:web-engine-generated']],['Unit',['pnpm','test:unit']],['Integration',['pnpm','test:integration']],['E2E',['pnpm','test:e2e',...(full?[]:selection.files)]],['Responsive proof',['pnpm','exec','playwright','test','--config', 'playwright.validation.config.mjs']],['Report viewer',['node','scripts/validation/test/report-browser.mjs']]];
  for(const [name,argv]of checks){console.log(`[validation] ${stage.title}: ${name}`);const r=await command(argv,{cwd,env,log:path.join(dir,`stage-${stageIndex}-${name.replaceAll(' ','-')}.log`),allowFailure:true});stage.checks.push({name,status:r.code?'failed':'passed',duration:r.duration});await save();}
  stage.items=[...await readJSON(env.RIGHELT_EVIDENCE_JSON,[]),...await readJSON(env.RIGHELT_EVIDENCE_JSON+'.ui',[])];
  stage.status=stage.checks.every(c=>c.status==='passed')&&stage.items.length>0&&!selection.unmapped.length?'passed':'failed';
 }catch(error){stage.status='failed';stage.checks.push({name:'Validation startup',status:'failed'});run.risks.push('Validation could not finish. Inspect the private startup log.');await saveJSON(path.join(dir,'startup-error.json'),{error:error.message});}
 finally{if(locked)await rm(lock,{recursive:true});}
 if(run.mode==='local'&&run.fingerprint&&run.fingerprint!==await fingerprint(cwd)){stage.status='stale';run.risks.push('Source files changed during validation. Rerun before relying on this evidence.');}
 await save();
 if(publishReport){try{await publish(run,site,config,{cwd});}catch(e){run.publication={status:'failed',error:e.message};}await saveJSON(file,run);}
 console.log(`Report: ${path.join(site,'index.html')}\nRun: ${file}`);return {run,dir,stage};
}
