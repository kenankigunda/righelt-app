import {readFile,mkdir,rm,cp,readdir,lstat,readlink,mkdtemp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export const harnessRoot=fileURLToPath(new URL('../../',import.meta.url));
import os from 'node:os';import path from 'node:path';
import {command,git,saveJSON,readJSON} from './io.mjs';
import {hash,coverage,VERSION} from './model.mjs';
import {renderReport} from './report.mjs';
import {publish} from './publish.mjs';
import {candidateCapabilities} from './capabilities.mjs';
import {initializeAccountUpgrade} from './account-stack.mjs';
import {verifyAccountEvidence} from './account-evidence.mjs';
export async function fingerprint(cwd){const tracked=await git(['ls-files','-z'],cwd);const untracked=await git(['ls-files','--others','--exclude-standard','-z'],cwd);const entries=[];for(const p of [...new Set((tracked+'\0'+untracked).split('\0').filter(Boolean))].sort()){try{entries.push([p,hash((await lstat(path.join(cwd,p))).isSymbolicLink()?await readlink(path.join(cwd,p)):await readFile(path.join(cwd,p)))]);}catch(e){if(e.code==='ENOENT')entries.push([p,'deleted']);else throw e;}}return hash(entries);}
export async function verifyEvidenceImages(stages,site){
 for(const stage of stages)for(const item of stage.items??[])for(const image of item.images??[]){
  if(!/^images\/[a-zA-Z0-9_.-]+$/.test(image.src)||!/^images\/[a-zA-Z0-9_.-]+$/.test(image.thumbnail??''))throw Error('Evidence image or thumbnail path is invalid');
  if(hash(await readFile(path.join(site,image.src)))!==image.digest)throw Error(`Evidence changed after capture: ${image.src}`);
  await readFile(path.join(site,image.thumbnail));
 }
}
export async function localRun({cwd=process.cwd(),dir,base='origin/main',full=false,config={},publishReport=true,run,stageIndex=0,persistRoot,continuityInput,continuityOutput,accountPersistRoot,accountContinuityInput,accountLegacyContinuityInput,execute=command,lockPath=path.join(os.tmpdir(),'righelt-validation-9888.lock')}={}){
 cwd=path.resolve(cwd);
 const revision=await git(['rev-parse','HEAD'],cwd);const baseSha=await git(['rev-parse',base],cwd);
 const changed=(await git(['diff','--name-only',baseSha],cwd)+'\n'+await git(['ls-files','--others','--exclude-standard'],cwd)).split('\n').filter(Boolean);const selection=coverage(changed);
 run??={version:VERSION,id:`${Date.now()}-${revision.slice(0,8)}`,startedAt:new Date().toISOString(),mode:'local',base:baseSha,revision,fingerprint:await fingerprint(cwd),prs:[],stages:[],risks:[]};
 const harnessRevision=await git(['rev-parse','HEAD'],harnessRoot);
 const harnessFingerprint=await fingerprint(harnessRoot);
 run.harnessRevision??=harnessRevision;
 run.harnessFingerprint??=harnessFingerprint;
 dir??=path.join(cwd,'test-results','validation',run.id);await mkdir(dir,{recursive:true});const site=path.join(dir,'site');
 const stage={id:`stage-${stageIndex}`,index:stageIndex,title:stageIndex?`Merge point ${stageIndex}`:'Baseline / local validation',head:revision,base:baseSha,status:'running',checks:[],items:[],unmapped:selection.unmapped,visualReviewed:false,sourceClean:!(await git(['status','--porcelain'],cwd))};run.stages=run.stages.filter(s=>s.index!==stageIndex);run.stages.push(stage);
 Object.assign(stage,{harnessRevision,harnessFingerprint,fingerprint:await fingerprint(cwd)});
 const file=path.join(dir,'run.json');const save=async()=>{await saveJSON(file,run);await renderReport(run,site);};await save();
 const lock=lockPath;let locked=false;
 try{await mkdir(lock);locked=true;await saveJSON(path.join(lock,'owner.json'),{pid:process.pid,run:run.id,cwd});
  const env={RIGHELT_VALIDATION_TARGET_ROOT:cwd,RIGHELT_VALIDATION:'1',RIGHELT_E2E_WEB_PORT:'9888',RIGHELT_EVIDENCE_DIR:site,RIGHELT_EVIDENCE_JSON:path.join(dir,`evidence-${stageIndex}.json`),PLAYWRIGHT_OUTPUT_DIR:path.join(dir,`debug-${stageIndex}`),...(persistRoot?{RIGHELT_E2E_PERSIST_ROOT:persistRoot}:{}),...(continuityInput?{RIGHELT_CONTINUITY_INPUT:continuityInput}:{}),...(continuityOutput?{RIGHELT_CONTINUITY_FILE:continuityOutput}:{})};
  await rm(env.RIGHELT_EVIDENCE_JSON+'.adjacent',{force:true});
  const capabilities=await candidateCapabilities(cwd);
  if(accountContinuityInput&&!capabilities.accounts)throw Error('Account capability disappeared after retained account proof');
  if(capabilities.accounts){
   if(accountContinuityInput)for(const name of ['mobile','mid-wide','full-wide'])await readFile(`${accountContinuityInput}.account-${name}`);
   Object.assign(env,{RIGHELT_ACCOUNT_CANDIDATE_ROOT:cwd,RIGHELT_ACCOUNT_PERSIST_ROOT:accountPersistRoot||await mkdtemp(path.join(dir,'fresh-account-')),...(accountContinuityInput?{RIGHELT_ACCOUNT_CONTINUITY_INPUT:accountContinuityInput}:{}),...((accountLegacyContinuityInput||(!accountContinuityInput&&continuityInput))?{RIGHELT_LEGACY_CONTINUITY_INPUT:accountLegacyContinuityInput||continuityInput}:{})});
   stage.accountContract={phase:accountContinuityInput?'retained':'introduced',legacy:env.RIGHELT_LEGACY_CONTINUITY_INPUT?'Prior guest history remains public; authenticated account cannot claim guest seats':'Fresh local legacy fixture',cutover:capabilities.cutover?'Permanent local activation with acknowledged synthetic canary':'Pre-activation account protocol'};
   await rm(env.RIGHELT_EVIDENCE_JSON+'.account',{force:true});
  }
  const candidateScripts=(await readJSON(path.join(cwd,'package.json'),{})).scripts??{};
  const authChecks=typeof candidateScripts['test:e2e:auth']==='string'&&candidateScripts['test:e2e:auth'].trim()?[['Auth E2E',['pnpm','test:e2e:auth']]]:[];
  if(capabilities.accounts&&!authChecks.length)throw Error('Account UI requires its candidate Auth E2E script');
  const accountChecks=capabilities.accounts?[['Account responsive proof',['node',path.join(harnessRoot,'node_modules/@playwright/test/cli.js'),'test','--config',path.join(harnessRoot,'playwright.validation-account.config.mjs')]]]:[];
  const checks=[['Typecheck',['pnpm','typecheck']],['Generated runtime',['pnpm','check:web-engine-generated']],['Unit',['pnpm','test:unit']],['Integration',['pnpm','test:integration']],['E2E',['pnpm','test:e2e',...(full?[]:selection.files)]],...authChecks,['Responsive proof',['node',path.join(harnessRoot,'node_modules/@playwright/test/cli.js'),'test','--config',path.join(harnessRoot,'playwright.validation.config.mjs')]],...accountChecks,['Report viewer',['node',path.join(harnessRoot,'scripts/validation/test/report-browser.mjs')]]];
  for(const [name,argv]of checks){
   if(name==='Account responsive proof'&&accountPersistRoot&&persistRoot&&!accountContinuityInput)await initializeAccountUpgrade({sourcePersistRoot:path.join(persistRoot,'api-state'),accountPersistRoot});
   console.log(`[validation] ${stage.title}: ${name}`);const r=await execute(argv,{cwd,env:{...env,...(name==='Account responsive proof'?{RIGHELT_EVIDENCE_JSON:env.RIGHELT_EVIDENCE_JSON+'.account'}:{}),PLAYWRIGHT_OUTPUT_DIR:path.join(dir,`debug-${stageIndex}`,name.replaceAll(' ','-')),...(['E2E','Auth E2E'].includes(name)?{CI:'1'}:{})},log:path.join(dir,`stage-${stageIndex}-${name.replaceAll(' ','-')}.log`),allowFailure:true});stage.checks.push({name,status:r.code?'failed':'passed',duration:r.duration});await save();}
  stage.items=[...await readJSON(env.RIGHELT_EVIDENCE_JSON,[]),...await readJSON(env.RIGHELT_EVIDENCE_JSON+'.ui',[]),...await readJSON(env.RIGHELT_EVIDENCE_JSON+'.adjacent',[]),...await readJSON(env.RIGHELT_EVIDENCE_JSON+'.account',[])];
  if(capabilities.accounts){
   try{
    const accountItems=await readJSON(env.RIGHELT_EVIDENCE_JSON+'.account',[]);
    verifyAccountEvidence(accountItems,{retained:Boolean(accountContinuityInput),capabilities,legacy:Boolean(env.RIGHELT_LEGACY_CONTINUITY_INPUT)});
    if(continuityOutput)for(const name of ['mobile','mid-wide','full-wide']){
     const fixture=JSON.parse(await readFile(`${continuityOutput}.account-${name}`,'utf8'));
     if(fixture.version!==1||!fixture.account?.id||!fixture.storage||!fixture.gameURL)throw Error('Incomplete account continuity fixture');
    }
    stage.checks.push({name:'Account evidence completeness',status:'passed'});
   }catch(error){stage.checks.push({name:'Account evidence completeness',status:'failed'});await saveJSON(path.join(dir,`account-evidence-error-${stageIndex}.json`),{error:error.message});}
  }
  try{await verifyEvidenceImages(run.stages,site);stage.checks.push({name:'Evidence image integrity',status:'passed'});}catch(error){stage.checks.push({name:'Evidence image integrity',status:'failed'});await saveJSON(path.join(dir,`evidence-integrity-${stageIndex}.json`),{error:error.message});}
  stage.status=stage.checks.every(c=>c.status==='passed')&&stage.items.length>0&&!selection.unmapped.length?'passed':'failed';
 }catch(error){stage.status='failed';stage.checks.push({name:'Validation startup',status:'failed'});run.risks.push('Validation could not finish. Inspect the private startup log.');await saveJSON(path.join(dir,'startup-error.json'),{error:error.message});}
 finally{if(locked)await rm(lock,{recursive:true});}
 if(stage.fingerprint!==await fingerprint(cwd)||revision!==await git(['rev-parse','HEAD'],cwd)){stage.status='stale';stage.sourceClean=false;run.risks.push('Source files changed during validation. Rerun before relying on this evidence.');}
 if(run.harnessRevision!==await git(['rev-parse','HEAD'],harnessRoot)||run.harnessFingerprint!==await fingerprint(harnessRoot)){stage.status='stale';run.risks.push('Validation harness changed during this run.');}
 await save();
 if(publishReport){try{await publish(run,site,config,{cwd});}catch(e){run.publication={status:'failed',error:e.message};}await saveJSON(file,run);}
 console.log(`Report: ${path.join(site,'index.html')}\nRun: ${file}`);return {run,dir,stage};
}
