#!/usr/bin/env node
import path from 'node:path';
import {readJSON,saveJSON,configPath,withRunLock} from './io.mjs';
import {localRun,fingerprint} from './local.mjs';
import {git} from './io.mjs';
import {integratedRun} from './integrated.mjs';
import {renderReport} from './report.mjs';
import {publish} from './publish.mjs';
import {applyReply} from './model.mjs';
import {importCI} from './ci-evidence.mjs';
import {compactStatus} from './status.mjs';
import {defaultLocalPlan,stagePolicy} from './plan.mjs';
import {candidateCapabilities} from './capabilities.mjs';
import {refreshPR,mergeAuthorized} from './merge.mjs';
const [mode,...args]=process.argv.slice(2);const flags={};for(let i=0;i<args.length;i++){if(args[i]==='--')continue;if(!args[i].startsWith('--'))throw Error(`Unexpected argument ${args[i]}`);flags[args[i].slice(2)]=args[i+1]&&!args[i+1].startsWith('--')?args[++i]:true;}
try{
 const config=await readJSON(configPath(),{});
 if(mode==='status'){if(!flags.run)throw Error('Provide --run');console.log(JSON.stringify(compactStatus(await readJSON(path.resolve(flags.run)),{afterCursor:flags.cursor})));}
 else if(mode==='import-ci'){if(!flags.repository||!flags['run-id']||!flags.expected||!flags.out||!flags.candidate)throw Error('Provide --repository --run-id --expected JSON --out DIRECTORY --candidate PATH');const r=await importCI({repository:flags.repository,runId:Number(flags['run-id']),cwd:path.resolve(flags.candidate),outDir:path.resolve(flags.out),expected:await readJSON(flags.expected)});console.log(JSON.stringify({run:r.run,credited:Object.keys(r.receipts),rejected:r.rejected}));}
 else if(mode==='configure'){if(typeof flags.recipient!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(flags.recipient))throw Error('Provide --recipient email');await saveJSON(configPath(),{...config,version:1,recipient:flags.recipient,pagesProject:flags.project??config.pagesProject??'righelt-validation'});console.log('Environment settings saved.');}
 else if(mode==='local'||mode==='integrated'){
  if(!config.recipient&&!flags['no-email'])throw Error('Recipient not configured. Ask upfront, then run configure --recipient EMAIL, or explicitly use --no-email.');
  console.log('Email is connector-managed: the invoking skill must check availability and send the consolidated digest.');
  if(mode==='integrated'&&!flags.manifest)throw Error('Provide --manifest FILE');
  const candidate=path.resolve(flags.candidate??process.cwd());
  const options={cwd:candidate,base:flags.base??'origin/main',dir:flags.out??path.join(process.cwd(),'test-results','validation',`${mode}-${Date.now()}-${process.pid}`),full:Boolean(flags.full),ciEvidence:flags['ci-evidence']?path.resolve(flags['ci-evidence']):undefined,config,publishReport:!flags['no-publish'],manifest:flags.manifest,resume:Boolean(flags.resume)};
  if(mode==='integrated'&&!flags.legacy&&(await readJSON(flags.manifest)).version!==2)throw Error('Use a version 2 release-question manifest; --legacy is only for historical reproduction');
  if(mode==='local'&&!flags.legacy){const spec=flags.plan?await readJSON(flags.plan):await defaultLocalPlan(candidate);const changed=(await git(['diff','--name-only',options.base],candidate)).split('\n').filter(Boolean);options.policy=stagePolicy(spec,0,{accounts:(await candidateCapabilities(candidate)).accounts,changed});options.cacheDir=path.join(path.resolve(options.dir),'check-cache');}
  if(mode==='local'&&flags.resume){options.dir=path.dirname(path.resolve(flags.resume));options.cacheDir=path.join(options.dir,'check-cache');}
  const execute=async()=>{
   if(mode==='local'&&flags.resume){options.run=await readJSON(path.resolve(flags.resume));options.run.fingerprint=await fingerprint(candidate);options.run.revision=await git(['rev-parse','HEAD'],candidate);options.run.base=await git(['rev-parse',options.base],candidate);delete options.run.harnessRevision;delete options.run.harnessFingerprint;}
   return mode==='local'?localRun(options):integratedRun(options);
  };
  const result=await withRunLock(path.join(path.resolve(options.dir),'run.json'),execute);
  process.exitCode=(mode!=='integrated'||result.run.complete===true)&&result.run.stages.length&&result.run.stages.every(s=>s.status==='passed')&&(!options.publishReport||result.run.publication?.status==='published')?0:1;
 }
 else if(['publish','report','review','reply','sync-replies','refresh','merge'].includes(mode)){
  if(!flags.run)throw Error('Provide --run path/to/run.json');const file=path.resolve(flags.run);await withRunLock(file,async()=>{const run=await readJSON(file),dir=path.dirname(file);
  if(mode==='refresh'){for(const p of run.prs)await refreshPR(run,p.number);}
  if(mode==='merge'){if(!flags.pr)throw Error('Provide --pr NUMBER');await mergeAuthorized(run,Number(flags.pr));}
  if(mode==='review'){if(!flags.stage||!flags.note)throw Error('After inspecting images, provide --stage ID --note FINDINGS');const s=run.stages.find(s=>s.id===flags.stage);if(!s)throw Error('Unknown stage');s.visualReviewed=true;(run.findings??=[]).push(String(flags.note));}
  if(mode==='sync-replies'){
   if(!flags.envelope)throw Error('Provide --envelope PRIVATE_CONNECTOR_JSON');
   const envelope=await readJSON(flags.envelope);
   const checked=Date.parse(envelope.checkedAt);
   if(!Number.isFinite(checked)||checked>Date.now()||Date.now()-checked>60_000||!Array.isArray(envelope.messages)||!Array.isArray(envelope.threads)||(run.emailThreads??[]).some(t=>!envelope.threads.includes(t)))throw Error('A fresh, complete tracked-thread read is required');
   if(envelope.mailbox?.toLowerCase()!==config.recipient?.toLowerCase())throw Error('Mailbox does not match recipient');
   for(const message of [...envelope.messages].sort((a,b)=>Date.parse(a.internalDate)-Date.parse(b.internalDate)))applyReply(run,message,config.recipient,envelope.mailbox);
   run.replyCheckedAt=envelope.checkedAt;
  }
  if(mode==='reply'){if(!flags.message||!flags.mailbox)throw Error('Provide connector-verified --message FILE --mailbox EMAIL');applyReply(run,await readJSON(flags.message),config.recipient,flags.mailbox);}
  await renderReport(run,path.join(dir,'site'));
  if(mode==='publish')await publish(run,path.join(dir,'site'),config);
  await saveJSON(file,run);console.log(path.join(dir,'site','index.html'));});
 }else console.log('Modes: status, import-ci, configure, local, integrated, report, review, publish, reply, refresh, merge. See skill references for invocation.');
}catch(error){console.error(error.message);process.exitCode=1;}
