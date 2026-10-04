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
import {loadCIReceipt} from './ci-evidence.mjs';
import {executeCheck,checkProvenance,createAuthLane} from './execution.mjs';
import {assertHistorySnapshot} from './history-continuity.mjs';
export async function fingerprint(cwd){const tracked=await git(['ls-files','-z'],cwd);const untracked=await git(['ls-files','--others','--exclude-standard','-z'],cwd);const entries=[];for(const p of [...new Set((tracked+'\0'+untracked).split('\0').filter(Boolean))].sort()){try{entries.push([p,hash((await lstat(path.join(cwd,p))).isSymbolicLink()?await readlink(path.join(cwd,p)):await readFile(path.join(cwd,p)))]);}catch(e){if(e.code==='ENOENT')entries.push([p,'deleted']);else throw e;}}return hash(entries);}
export async function verifyEvidenceImages(stages,site){
 for(const stage of stages)for(const item of stage.items??[])for(const image of item.images??[]){
  if(!/^images\/[a-zA-Z0-9_.-]+$/.test(image.src)||!/^images\/[a-zA-Z0-9_.-]+$/.test(image.thumbnail??''))throw Error('Evidence image or thumbnail path is invalid');
  if(hash(await readFile(path.join(site,image.src)))!==image.digest)throw Error(`Evidence changed after capture: ${image.src}`);
  await readFile(path.join(site,image.thumbnail));
 }
}
export function verifyGeneralEvidence(items,{retained=false,viewports=['mobile','mid-wide','full-wide']}={}){
 const flows=['create, move, viewer live update, reload and reconnect',...(retained?['previous-stage identity and game survive migrations']:[])];
 for(const viewport of viewports)for(const flow of flows){
  const matches=items.filter(i=>i.viewport===viewport&&i.title?.endsWith(flow));
  if(matches.length!==1||matches[0].status!=='passed')throw Error(`Missing current behavioral proof: ${viewport} / ${flow}`);
 }
}
export async function localRun({cwd=process.cwd(),dir,base='origin/main',full=false,config={},publishReport=true,run,stageIndex=0,persistRoot,continuityInput,continuityOutput,accountPersistRoot,accountContinuityInput,accountLegacyContinuityInput,execute=command,policy,cacheDir,ciEvidence,lockPath=path.join(os.tmpdir(),'righelt-validation-9888.lock')}={}){
 cwd=path.resolve(cwd);
 const revision=await git(['rev-parse','HEAD'],cwd);const baseSha=await git(['rev-parse',base],cwd);
 const changed=(await git(['diff','--name-only',baseSha],cwd)+'\n'+await git(['ls-files','--others','--exclude-standard'],cwd)).split('\n').filter(Boolean);const selection=coverage(changed);if(policy)selection.unmapped=[...new Set([...selection.unmapped,...(policy.unmapped??[])])];
 run??={version:VERSION,id:`${Date.now()}-${revision.slice(0,8)}`,startedAt:new Date().toISOString(),mode:'local',base:baseSha,revision,fingerprint:await fingerprint(cwd),prs:[],stages:[],risks:[]};
 const harnessRevision=await git(['rev-parse','HEAD'],harnessRoot);
 const harnessFingerprint=await fingerprint(harnessRoot);
 if(policy){run.version=2;run.mergeMethod??='squash';}
 run.harnessRevision??=harnessRevision;
 run.harnessFingerprint??=harnessFingerprint;
 dir??=path.join(cwd,'test-results','validation',run.id);await mkdir(dir,{recursive:true});const site=path.join(dir,'site');
 const stage={id:`stage-${stageIndex}`,index:stageIndex,title:stageIndex?`Merge point ${stageIndex}`:'Baseline / local validation',head:revision,base:baseSha,status:'running',checks:[],items:[],unmapped:selection.unmapped,visualReviewed:false,sourceClean:!(await git(['status','--porcelain'],cwd))};if(run.stages.some(s=>s.index===stageIndex))(run.history??=[]).push(...run.stages.filter(s=>s.index===stageIndex).map(s=>structuredClone(s)));run.stages=run.stages.filter(s=>s.index!==stageIndex);run.stages.push(stage);
 if(policy)Object.assign(stage,{phase:policy.phase,visualRequired:policy.visualMode!=='none',questions:policy.questions?.map(q=>({id:q.id,description:q.description})),policyVersion:2});
 Object.assign(stage,{harnessRevision,harnessFingerprint,fingerprint:await fingerprint(cwd)});
 const file=path.join(dir,'run.json');const save=async()=>{await saveJSON(file,run);await renderReport(run,site);};await save();
 const lock=lockPath;let locked=false;
 try{await mkdir(lock);locked=true;await saveJSON(path.join(lock,'owner.json'),{pid:process.pid,run:run.id,cwd});
  const env={...(policy?{RIGHELT_VISUAL_MODE:policy.visualMode,RIGHELT_VALIDATION_VIEWPORTS:JSON.stringify(policy.coverageViewports??['mobile','mid-wide','full-wide']),RIGHELT_VISUAL_VIEWPORTS:JSON.stringify(policy.viewports),...(policy.checkpoints?{RIGHELT_VISUAL_CHECKPOINTS:JSON.stringify(policy.checkpoints)}:{})}:{}),RIGHELT_VALIDATION_TARGET_ROOT:cwd,RIGHELT_VALIDATION:'1',RIGHELT_E2E_WEB_PORT:'9888',RIGHELT_EVIDENCE_DIR:site,RIGHELT_EVIDENCE_JSON:path.join(dir,`evidence-${stageIndex}.json`),PLAYWRIGHT_OUTPUT_DIR:path.join(dir,`debug-${stageIndex}`),...(persistRoot?{RIGHELT_E2E_PERSIST_ROOT:persistRoot}:{}),...(continuityInput?{RIGHELT_CONTINUITY_INPUT:continuityInput}:{}),...(continuityOutput?{RIGHELT_CONTINUITY_FILE:continuityOutput}:{})};
  await rm(env.RIGHELT_EVIDENCE_JSON,{force:true});
  await rm(env.RIGHELT_EVIDENCE_JSON+'.ui',{force:true});
  await rm(env.RIGHELT_EVIDENCE_JSON+'.adjacent',{force:true});
  await rm(env.RIGHELT_EVIDENCE_JSON+'.account',{force:true});
  const capabilities=await candidateCapabilities(cwd);
  if(accountContinuityInput&&!capabilities.accounts)throw Error('Account capability disappeared after retained account proof');
  if(capabilities.accounts){
   if(accountContinuityInput)for(const name of (policy?.coverageViewports??['mobile','mid-wide','full-wide'])){
    const fixture=JSON.parse(await readFile(`${accountContinuityInput}.account-${name}`,'utf8'));
    if(fixture.version!==2)throw Error('Regenerate pre-upgrade account evidence');
    assertHistorySnapshot(fixture.history);
   }
   Object.assign(env,{RIGHELT_ACCOUNT_CANDIDATE_ROOT:cwd,RIGHELT_ACCOUNT_PERSIST_ROOT:accountPersistRoot||await mkdtemp(path.join(dir,'fresh-account-')),...(accountContinuityInput?{RIGHELT_ACCOUNT_CONTINUITY_INPUT:accountContinuityInput}:{}),...((accountLegacyContinuityInput||(!accountContinuityInput&&continuityInput))?{RIGHELT_LEGACY_CONTINUITY_INPUT:accountLegacyContinuityInput||continuityInput}:{})});
   stage.accountContract={phase:accountContinuityInput?'retained':'introduced',legacy:env.RIGHELT_LEGACY_CONTINUITY_INPUT?'Prior guest history remains public; authenticated account cannot claim guest seats':'Fresh local legacy fixture',cutover:capabilities.cutover?'Permanent local activation with acknowledged synthetic canary':'Pre-activation account protocol'};
  }
  const candidateScripts=(await readJSON(path.join(cwd,'package.json'),{})).scripts??{};
  const authChecks=typeof candidateScripts['test:e2e:auth']==='string'&&candidateScripts['test:e2e:auth'].trim()?[['Auth E2E',['pnpm','test:e2e:auth']]]:[];
  if(capabilities.accounts&&!authChecks.length)throw Error('Account UI requires its candidate Auth E2E script');
  const accountChecks=capabilities.accounts?[['Account responsive proof',['node',path.join(harnessRoot,'node_modules/@playwright/test/cli.js'),'test','--config',path.join(harnessRoot,'playwright.validation-account.config.mjs')]]]:[];
  let checks=[['Typecheck',['pnpm','typecheck']],['Generated runtime',['pnpm','check:web-engine-generated']],['Unit',['pnpm','test:unit']],['Integration',['pnpm','test:integration']],['E2E',['pnpm','test:e2e',...(full?[]:selection.files)]],...authChecks,['Responsive proof',['node',path.join(harnessRoot,'node_modules/@playwright/test/cli.js'),'test','--config',path.join(harnessRoot,'playwright.validation.config.mjs')]],...accountChecks,['Report viewer',['node',path.join(harnessRoot,'scripts/validation/test/report-browser.mjs')]]];
  if(policy){
   checks=checks.filter(([name])=>policy.selected.includes(name));
   if(policy.tests?.length)checks.splice(2,0,['Boundary E2E',['pnpm','test:e2e',...policy.tests,'--project=chromium']]);
  }
  // Changed AI tooling requires its candidate-owned checks. Missing scripts fail
  // through pnpm; never turn absent coverage into a successful skipped lane.
  const aiChecks=[...(selection.areas.includes('ai-trainer')?[['Trainer checks',['pnpm','test:trainer']]]:[]),...(selection.areas.includes('ai-benchmark')?[['AI benchmark checks',['pnpm','test:ai-benchmark']]]:[])];
  checks.push(...aiChecks);
  const prerequisites=new Set(['Typecheck','Generated runtime']);
  let prerequisiteFailure=null;
  const runCheck=async(name,argv,checkCwd=cwd)=>{
   const browser=['E2E','Auth E2E','Boundary E2E'].includes(name);
   const checkEnv={...env,...(name==='Account responsive proof'?{RIGHELT_EVIDENCE_JSON:env.RIGHELT_EVIDENCE_JSON+'.account'}:{}),PLAYWRIGHT_OUTPUT_DIR:path.join(dir,`debug-${stageIndex}`,name.replaceAll(' ','-')),...(browser?{CI:'1'}:{})};
   if(policy?.phase==='final'&&name==='E2E'){delete checkEnv.RIGHELT_E2E_PERSIST_ROOT;delete checkEnv.RIGHELT_CONTINUITY_INPUT;delete checkEnv.RIGHELT_CONTINUITY_FILE;}
   if(checkCwd!==cwd){checkEnv.RIGHELT_VALIDATION_TARGET_ROOT=checkCwd;checkEnv.RIGHELT_ACCOUNT_CANDIDATE_ROOT=checkCwd;checkEnv.RIGHELT_AUTH_E2E_WEB_PORT='9988';}
   const provenance=policy?await checkProvenance(checkCwd,argv,checkEnv,{name,fingerprint:stage.fingerprint,phase:name==='Auth E2E'?'fresh-auth':policy?.phase==='final'&&name==='E2E'?'fresh-general':persistRoot?'retained':'fresh'}):null;
   const log=path.join(dir,`stage-${stageIndex}-${name.replaceAll(' ','-')}.log`);
   if(policy&&ciEvidence&&['Typecheck','Generated runtime','Unit','Integration','E2E','Auth E2E'].includes(name)){
    const receipt=await loadCIReceipt(ciEvidence,{name,argv,tree:provenance.tree});
    if(receipt)return {name,status:'passed',duration:0,reused:true,source:'github-actions',provenance,receipt,reason:'Exact CI coverage credited; retained-state proof remains local'};
   }
   console.log(`[validation] ${stage.title}: ${name}`);
   if(!policy){const r=await execute(argv,{cwd:checkCwd,env:checkEnv,log,allowFailure:true});return {name,status:r.code?'failed':'passed',duration:r.duration};}
   return executeCheck({cwd:checkCwd,argv,env:checkEnv,name,log,execute,cacheDir,provenance,reuse:['Typecheck','Generated runtime','Unit','Integration','Auth E2E'].includes(name)||name==='E2E'&&(!persistRoot||policy.phase==='final')});
  };
  for(let position=0;position<checks.length;position++){
   const [name,argv]=checks[position];
   if(policy&&prerequisiteFailure&&name!=='Report viewer'){
    stage.checks.push({name,status:'blocked',reason:`Prerequisite failed: ${prerequisiteFailure}`});await save();continue;
   }
   if(name==='Account responsive proof'&&accountPersistRoot&&persistRoot&&!accountContinuityInput)await initializeAccountUpgrade({sourcePersistRoot:path.join(persistRoot,'api-state'),accountPersistRoot});
   if(policy?.lanes===2&&name==='E2E'&&checks[position+1]?.[0]==='Auth E2E'&&stage.sourceClean&&execute===command){
    const lane=await createAuthLane(cwd,path.join(dir,`lanes-${stageIndex}`));
    const before=await fingerprint(lane);stage.activeChecks=[name,checks[position+1][0]];await save();
    const results=await Promise.allSettled([runCheck(name,argv),runCheck(...checks[position+1],lane)]);
    for(let i=0;i<results.length;i++){const r=results[i];stage.checks.push(r.status==='fulfilled'?r.value:{name:checks[position+i][0],status:'failed',reason:'Execution failed; inspect private logs'});}
    if(before!==await fingerprint(lane))stage.checks.push({name:'Account lane source integrity',status:'failed'});
    position++;stage.activeChecks=[];await save();continue;
   }
   stage.activeChecks=[name];await save();const record=await runCheck(name,argv);stage.activeChecks=[];stage.checks.push(record);
   if(record.status==='failed'&&prerequisites.has(name))prerequisiteFailure=name;
   await save();
  }
  stage.items=[...await readJSON(env.RIGHELT_EVIDENCE_JSON,[]),...await readJSON(env.RIGHELT_EVIDENCE_JSON+'.ui',[]),...await readJSON(env.RIGHELT_EVIDENCE_JSON+'.adjacent',[]),...(capabilities.accounts?await readJSON(env.RIGHELT_EVIDENCE_JSON+'.account',[]):[])];
  if(policy){try{verifyGeneralEvidence(stage.items,{retained:Boolean(continuityInput),viewports:policy.coverageViewports});stage.checks.push({name:'Behavioral evidence completeness',status:'passed'});}catch(error){stage.checks.push({name:'Behavioral evidence completeness',status:'failed'});await saveJSON(path.join(dir,'behavioral-evidence-error.json'),{error:error.message});}}
  if(capabilities.accounts){
   try{
    const accountItems=await readJSON(env.RIGHELT_EVIDENCE_JSON+'.account',[]);
    verifyAccountEvidence(accountItems,{retained:Boolean(accountContinuityInput),capabilities,legacy:Boolean(env.RIGHELT_LEGACY_CONTINUITY_INPUT),...(policy?{visualMode:policy.visualMode,viewports:policy.coverageViewports??['mobile','mid-wide','full-wide'],visualViewports:policy.viewports,checkpoints:policy.checkpoints}:{})});
    if(continuityOutput)for(const name of (policy?.coverageViewports??['mobile','mid-wide','full-wide'])){
     const fixture=JSON.parse(await readFile(`${continuityOutput}.account-${name}`,'utf8'));
     if(fixture.version!==2||!fixture.account?.id||!fixture.storage||!fixture.gameURL)throw Error('Incomplete account continuity fixture');
     assertHistorySnapshot(fixture.history);
    }
    stage.checks.push({name:'Account evidence completeness',status:'passed'});
   }catch(error){stage.checks.push({name:'Account evidence completeness',status:'failed'});await saveJSON(path.join(dir,`account-evidence-error-${stageIndex}.json`),{error:error.message});}
  }
  try{await verifyEvidenceImages(run.stages,site);stage.checks.push({name:'Evidence image integrity',status:'passed'});}catch(error){stage.checks.push({name:'Evidence image integrity',status:'failed'});await saveJSON(path.join(dir,`evidence-integrity-${stageIndex}.json`),{error:error.message});}
  if(policy)for(const q of policy.questions??[]){const required=policy.phase==='final'?q.checks:(q.boundaryChecks??[]);if(required.length)stage.checks.push({name:`Release question: ${q.id}`,status:required.every(name=>stage.checks.some(c=>c.name===name&&c.status==='passed'))?'passed':'failed',coverage:required});}
  stage.status=stage.checks.every(c=>c.status==='passed')&&stage.items.length>0&&!selection.unmapped.length?'passed':'failed';
 }catch(error){stage.status='failed';stage.checks.push({name:'Validation startup',status:'failed'});run.risks.push('Validation could not finish. Inspect the private startup log.');await saveJSON(path.join(dir,'startup-error.json'),{error:error.message});}
 finally{stage.activeChecks=[];if(locked)await rm(lock,{recursive:true});}
 if(stage.fingerprint!==await fingerprint(cwd)||revision!==await git(['rev-parse','HEAD'],cwd)){stage.status='stale';stage.sourceClean=false;run.risks.push('Source files changed during validation. Rerun before relying on this evidence.');}
 if(run.harnessRevision!==await git(['rev-parse','HEAD'],harnessRoot)||run.harnessFingerprint!==await fingerprint(harnessRoot)){stage.status='stale';run.risks.push('Validation harness changed during this run.');}
 await save();
 if(publishReport){try{await publish(run,site,config,{cwd});}catch(e){run.publication={status:'failed',error:e.message};}await saveJSON(file,run);}
 console.log(`Report: ${path.join(site,'index.html')}\nRun: ${file}`);return {run,dir,stage};
}
