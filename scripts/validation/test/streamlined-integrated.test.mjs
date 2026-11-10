import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdir,cp,mkdtemp,rm,realpath,readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {readJSON,saveJSON} from '../io.mjs';
import {validatePlan,stagePolicy} from '../plan.mjs';
import {createCheckpoint,restoreCheckpoint} from '../checkpoints.mjs';
import {saveSuccessfulEvidence,loadSuccessfulEvidence} from '../reuse.mjs';
import {requireRetainedResumeBaseline} from '../retained-resume.mjs';
import {hash,finalProofReady} from '../model.mjs';
const sha=n=>String(n).repeat(40);
async function fixture(t,{retained=false}={}){
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'streamlined-integrated-')));t.after(()=>rm(root,{recursive:true,force:true}));const cwd=path.join(root,'candidate'),harnessRoot=path.join(root,'harness'),dir=path.join(root,'out');await mkdir(cwd);await mkdir(harnessRoot);
 const code=(await readFile(new URL('../integrated-bounded.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('export async function ','async function ').replaceAll('export function ','function ');
 let fetched=sha(1),merged=false;const calls=[],installs=[];
 const git=async(args,at)=>{
  if(args[0]==='fetch'){fetched=args[2].startsWith('pull/')?sha(2):sha(1);return '';}
  if(args[0]==='rev-parse')return args[1]==='FETCH_HEAD'?fetched:args[1].endsWith('^{tree}')?sha(merged?4:3):at===harnessRoot?sha(5):sha(1);
  if(args[0]==='worktree'){await mkdir(args.at(-2),{recursive:true});merged=false;return '';}
  if(args[0]==='merge'){merged=true;return '';}
  if(args[0]==='diff')return 'docs/help.md';
  if(args[0]==='ls-remote')return sha(1)+'\trefs/heads/main';throw Error('Unexpected Git '+args);
 };
 const command=async args=>args[0]==='lsof'?{code:1,output:''}:{code:0,output:JSON.stringify({number:1,title:'Docs',url:'https://github.com/o/r/pull/1',headRefOid:sha(2),headRefName:'feature',baseRefName:'main',baseRefOid:sha(1),state:'OPEN',isDraft:false})};
 const localRun=async options=>{
  calls.push(options);await mkdir(path.join(options.dir,'site'),{recursive:true});
  return {run:{risks:[]},stage:{id:'stage-'+options.stageIndex,index:options.stageIndex,base:sha(1),head:sha(merged?2:1),sourceClean:true,status:'passed',policyVersion:3,phase:options.policy.phase,visualRequired:false,visualReviewed:false,unmapped:[],checks:options.policy.selected.map(name=>({name,status:'passed',...(name==='PR gate'?{reused:true,source:'github-actions'}:{})})),items:[]}};
 };
 const context={path,os,mkdir,cp,mkdtemp,rm,realpath,requireRetainedResumeBaseline,assertRetainedOutput:async()=>{},command,git,readJSON,saveJSON,hash,validatePlan,stagePolicy,localRun,harnessRoot,fingerprint:async()=> 'stable-harness',candidateCapabilities:async()=>({accounts:true}),ensureInstallation:async()=>installs.push(true),loadSuccessfulEvidence,saveSuccessfulEvidence,createCheckpoint,restoreCheckpoint,restoreRetainedInput:async()=>({continuity:path.join(dir,'guest.json'),accountContinuity:retained?path.join(dir,'account.json'):undefined,origin:{checkCredit:false}}),renderReport:async()=>{},publish:async()=>{},Date,JSON,process,structuredClone};
 runInNewContext(`${code};globalThis.execute=boundedIntegratedRun;`,context);
 const spec={version:3,repository:'o/r',base:'main',prs:[{number:1}],questions:[]};
 return {root,cwd,dir,calls,installs,spec,execute:extra=>context.execute({spec,cwd,dir,config:{},...extra})};
}
test('integrated v3 creates no baseline test repeat, reuses exact final CI and resumes both checkpoints',async t=>{
 const f=await fixture(t);const first=await f.execute();assert.equal(first.run.complete,true);assert.equal(f.calls.length,2);assert.deepEqual([...f.calls[0].policy.selected],[]);assert.deepEqual([...f.calls[1].policy.selected],['PR gate']);assert.equal(f.installs.length,1);assert.equal(first.run.stages[1].checks[0].source,'github-actions');assert.equal(finalProofReady(first.run,sha(1)),true);
 const second=await f.execute({resume:true});assert.equal(second.run.complete,true);assert.equal(f.calls.length,2);assert(second.run.stages.every(s=>s.reusedFrom));
});
for(const retained of [false,true])test(`explicit restored ${retained?'guest/account':'guest'} state cannot be omitted from a v3 plan`,async t=>{
 const f=await fixture(t,{retained});const result=await f.execute({retainedInput:{runFile:'/private/original/run.json',stageId:'stage-1'}});assert.equal(result.run.complete,false);assert.equal(result.run.orchestration,'failed');assert.equal(f.calls.length,0);assert.match((await readJSON(path.join(f.dir,'attempts',String(result.run.attempt),'startup-error.json'))).error,/requires all restored/);
});
