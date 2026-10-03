#!/usr/bin/env node
import path from 'node:path';
import {readJSON,saveJSON,configPath,withRunLock} from './io.mjs';
import {localRun,fingerprint} from './local.mjs';
import {git} from './io.mjs';
import {integratedRun} from './integrated.mjs';
import {renderReport} from './report.mjs';
import {publish} from './publish.mjs';
import {applyReply} from './model.mjs';
import {refreshPR,mergeAuthorized} from './merge.mjs';
const [mode,...args]=process.argv.slice(2);const flags={};for(let i=0;i<args.length;i++){if(args[i]==='--')continue;if(!args[i].startsWith('--'))throw Error(`Unexpected argument ${args[i]}`);flags[args[i].slice(2)]=args[i+1]&&!args[i+1].startsWith('--')?args[++i]:true;}
try{
 const config=await readJSON(configPath(),{});
 if(mode==='configure'){if(typeof flags.recipient!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(flags.recipient))throw Error('Provide --recipient email');await saveJSON(configPath(),{...config,version:1,recipient:flags.recipient,pagesProject:flags.project??config.pagesProject??'righelt-validation'});console.log('Environment settings saved.');}
 else if(mode==='local'||mode==='integrated'){
  if(!config.recipient&&!flags['no-email'])throw Error('Recipient not configured. Ask upfront, then run configure --recipient EMAIL, or explicitly use --no-email.');
  console.log('Email is connector-managed: the invoking skill must check availability and send the consolidated digest.');
  if(mode==='integrated'&&!flags.manifest)throw Error('Provide --manifest FILE');
  const options={base:flags.base??'origin/main',dir:flags.out,full:Boolean(flags.full),config,publishReport:!flags['no-publish'],manifest:flags.manifest,resume:Boolean(flags.resume)};
  if(mode==='local'&&flags.resume){const prior=await readJSON(path.resolve(flags.resume));options.run=prior;options.dir=path.dirname(path.resolve(flags.resume));options.run.fingerprint=await fingerprint(process.cwd());options.run.revision=await git(['rev-parse','HEAD'],process.cwd());options.run.base=await git(['rev-parse',options.base],process.cwd());}
  const execute=()=>mode==='local'?localRun(options):integratedRun(options);
  const result=options.dir?await withRunLock(path.join(path.resolve(options.dir),'run.json'),execute):await execute();
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
 }else console.log('Modes: configure, local, integrated, report, review, publish, reply, refresh, merge. See skill references for invocation.');
}catch(error){console.error(error.message);process.exitCode=1;}
