import path from 'node:path';
import {lstat,realpath,readFile,readdir} from 'node:fs/promises';
import {command,git,readJSON,withRunLock} from './io.mjs';
import {evidenceKey,fileDigest,loadSuccessfulEvidence} from './reuse.mjs';
import {restoreCheckpoint} from './checkpoints.mjs';
import {assertHistorySnapshot} from './history-continuity.mjs';

const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const overlaps=(a,b)=>a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);
const inside=(root,file)=>file.startsWith(root+path.sep);

export function retainedInputOptions({mode,args,flags}) {
 const names=['retained-run','retained-stage'];
 if(args.some(arg=>arg.startsWith('--retained-')&&!names.some(name=>arg===`--${name}`||arg.startsWith(`--${name}=`))))throw Error('Unknown retained input flag');
 for(const name of names)if(args.filter(arg=>arg===`--${name}`||arg.startsWith(`--${name}=`)).length>1)throw Error('Retained input flags must be unique');
 if(!names.some(name=>Object.hasOwn(flags,name)||args.some(arg=>arg.startsWith(`--${name}=`))))return undefined;
 if(mode!=='integrated'||flags.legacy||flags.resume)throw Error('Retained input requires a new integrated v2 run without resume or legacy mode');
 if(args.some(arg=>/^--retained-(run|stage)=/.test(arg))||typeof flags['retained-run']!=='string'||!path.isAbsolute(flags['retained-run'])||typeof flags['retained-stage']!=='string'||!/^stage-(0|[1-9]\d*)$/.test(flags['retained-stage']))throw Error('Provide paired --retained-run ABSOLUTE_RUN_JSON --retained-stage stage-N');
 return {runFile:flags['retained-run'],stageId:flags['retained-stage']};
}

export function assertRetainedTarget(input,targetRunDir) {
 if(!input||typeof input.runFile!=='string'||!path.isAbsolute(input.runFile)||!/^stage-(0|[1-9]\d*)$/.test(input.stageId??''))throw Error('Invalid retained input selection');
 if(overlaps(path.dirname(path.resolve(input.runFile)),path.resolve(targetRunDir)))throw Error('Retained source and receiving run must be separate');
}

// Run before the CLI creates its output lock or the orchestrator writes run.json.
export async function assertRetainedOutput(input,targetRunDir,{allowOwnedLock=false}={}) {
 assertRetainedTarget(input,targetRunDir);
 await fileDigest(path.resolve(input.runFile));
 let ancestor=path.resolve(targetRunDir);
 for(;;){
  try{await realDirectory(ancestor);break;}
  catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(ancestor);if(parent===ancestor)throw error;ancestor=parent;}
 }
 let entries;
 try{entries=await readdir(targetRunDir);}catch(error){if(error.code==='ENOENT')return;throw error;}
 for(const name of entries){
  if(name!=='run.json.lock'||!allowOwnedLock)throw Error('Retained input requires an empty receiving run; refusing overwrite');
  const lock=path.join(targetRunDir,name);await realDirectory(lock);
  const files=await readdir(lock);
  if(files.length!==1||files[0]!=='owner.json')throw Error('Receiving run lock is not owned by this CLI');
  await fileDigest(path.join(lock,'owner.json'));const owner=await readJSON(path.join(lock,'owner.json'));
  if(owner.pid!==process.pid||!Number.isFinite(Date.parse(owner.startedAt)))throw Error('Receiving run lock is not owned by this CLI');
 }
}

async function realDirectory(directory) {
 if(!(await lstat(directory)).isDirectory()||await realpath(directory)!==path.resolve(directory))throw Error('Retained directories must be real and contain no symlinks');
}
async function realFileWithin(root,file) {
 if(!inside(root,file))throw Error('Retained source reference escapes its run');
 return fileDigest(file);
}
const defaultAncestor=async(ancestor,descendant,cwd)=>{
 const result=await command(['git','merge-base','--is-ancestor',ancestor,descendant],{cwd,allowFailure:true});
 if(result.code>1)throw Error('Cannot verify retained source ancestry');
 return result.code===0;
};
const defaultMerge=async(repository,number,cwd)=>JSON.parse((await command(['gh','pr','view',String(number),'--repo',repository,'--json','number,state,headRefOid,mergeCommit,baseRefName'],{cwd})).output);

async function continuityPaths(state,files) {
 const pointers=await readJSON(path.join(state,'continuity-state.json'));
 if(!pointers||Object.keys(pointers).some(key=>!['continuity','accountContinuity','legacyContinuity'].includes(key))||typeof pointers.continuity!=='string')throw Error('Malformed retained continuity pointers');
 const result={};
 for(const name of ['continuity','accountContinuity','legacyContinuity']) {
  const relative=pointers[name];
  if(relative===null||relative===undefined){result[name]=undefined;continue;}
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.includes('\\')||relative.includes('\0')||relative.split('/').some(part=>part==='..'||part==='.'||part===''))throw Error('Unsafe retained continuity path');
  const file=path.resolve(state,relative);
  if(!inside(state,file)||!Object.hasOwn(files,relative))throw Error('Retained continuity file missing from checkpoint');
  await fileDigest(file);result[name]=file;
 }
 const hasDatabase=prefix=>Object.keys(files).some(file=>file.startsWith(prefix)&&file.endsWith('.sqlite'));
 if(!hasDatabase('guest/api-state/v3/d1/'))throw Error('Retained guest database is missing');
 await realDirectory(path.join(state,'guest','api-state','v3','d1'));
 for(const file of new Set([result.continuity,result.legacyContinuity].filter(Boolean))) {
  const fixture=await readJSON(file);
  if(fixture.version!==2||typeof fixture.hash!=='string'||!/^#\/game\/[^?#/]+$/.test(fixture.hash)||!fixture.storage||!Array.isArray(fixture.storage.cookies)||!Array.isArray(fixture.storage.origins))throw Error('Malformed retained guest fixture');
  assertHistorySnapshot(fixture.history);
  if(!fixture.storage.origins.some(origin=>origin.localStorage?.some(item=>item.name==='righelt.identity.id.v1'&&typeof item.value==='string'&&item.value)))throw Error('Retained guest identity is missing');
 }
 if(result.accountContinuity) {
  const key='account/hmac-v1.key';
  if(!Object.hasOwn(files,key)||!hasDatabase('account/state/v3/d1/'))throw Error('Retained account key or database is missing');
  await fileDigest(path.join(state,key));
  if(!/^[a-f0-9]{64}$/.test((await readFile(path.join(state,key),'utf8')).trim()))throw Error('Malformed retained account fixture key');
  await realDirectory(path.join(state,'account','state','v3','d1'));
  for(const viewport of ['mobile','mid-wide','full-wide']) {
   const file=`${result.accountContinuity}.account-${viewport}`,relative=path.relative(state,file);
   if(!Object.hasOwn(files,relative))throw Error('Retained account viewport fixture is missing');
   await fileDigest(file);const fixture=await readJSON(file);
   if(fixture.version!==2||!fixture.account?.id||typeof fixture.username!=='string'||!fixture.storage||!Array.isArray(fixture.storage.cookies)||!Array.isArray(fixture.storage.origins)||typeof fixture.gameURL!=='string')throw Error('Malformed retained account fixture');
   assertHistorySnapshot(fixture.history);
  }
 }
 return result;
}

// Transfer original private data, never source check results. The receiving
// baseline has its own actual provenance and must prove retained behavior anew.
export async function restoreRetainedInput({input,repository,baseBranch,baseline,cwd,destination,targetRunDir,assertStopped,now=Date.now(),resolveMerge=defaultMerge,isAncestor=defaultAncestor,treeOf=(revision,root)=>git(['rev-parse',`${revision}^{tree}`],root)}) {
 assertRetainedTarget(input,targetRunDir);
 if(!sha(baseline))throw Error('Invalid retained target baseline');
 const runFile=path.resolve(input.runFile),sourceRoot=path.dirname(runFile);
 destination=path.resolve(destination);targetRunDir=path.resolve(targetRunDir);
 if(overlaps(sourceRoot,targetRunDir)||!inside(targetRunDir,destination))throw Error('Retained source and receiving run must be separate');
 await fileDigest(runFile);await realDirectory(sourceRoot);
 if(typeof assertStopped!=='function'||await assertStopped()!==true)throw Error('Retained transfer requires stopped source and target services');
 return withRunLock(runFile,async()=>{
  const sourceRunDigest=await fileDigest(runFile),source=await readJSON(runFile);
  if(source.version!==2||typeof source.id!=='string'||!source.id||source.mode!=='integrated'||source.repository!==repository||source.plan?.base!==baseBranch||!sha(source.base)||!Array.isArray(source.stages)||!Array.isArray(source.prs))throw Error('Retained source must be a matching integrated v2 repository');
  const selected=source.stages.filter(stage=>stage.id===input.stageId);
  if(selected.length!==1)throw Error('Retained source stage must be unique');
  const stage=selected[0],provenance=stage.checkpointProvenance;
  if(stage.status!=='passed'||!Array.isArray(stage.checks)||!stage.checks.length||stage.checks.some(check=>check.status!=='passed')||!stage.checkpoint||!stage.evidenceReceipt||!provenance||provenance.version!==2||typeof provenance.harnessFingerprint!=='string'||!provenance.harnessFingerprint||provenance.base!==source.base||!sha(provenance.tree)||!sha(stage.head)||!sha(stage.aggregateHead)||!Number.isSafeInteger(stage.index)||stage.index<0||!Array.isArray(provenance.prefix)||provenance.prefix.length!==stage.index)throw Error('Retained stage is not an original successful checkpoint');
  const checkpoint=path.resolve(stage.checkpoint),receipt=path.resolve(stage.evidenceReceipt);
  if(!inside(sourceRoot,checkpoint))throw Error('Retained checkpoint escapes its source run');
  await realDirectory(checkpoint);
  const manifestDigest=await realFileWithin(sourceRoot,path.join(checkpoint,'manifest.json')),receiptDigest=await realFileWithin(sourceRoot,receipt);
  const verified=await loadSuccessfulEvidence(receipt,provenance,{now});
  if(!verified||!Array.isArray(verified.checks)||!verified.checks.length||verified.checks.some(check=>check.status!=='passed')||verified.id!==stage.id||verified.index!==stage.index||verified.head!==stage.head||verified.aggregateHead!==stage.aggregateHead||verified.checkpoint!==stage.checkpoint||evidenceKey(verified.checkpointProvenance)!==evidenceKey(provenance))throw Error('Original retained stage evidence no longer verifies');
  if((stage.index===0&&stage.aggregateHead!==source.base)||await treeOf(stage.aggregateHead,cwd)!==provenance.tree||!await isAncestor(source.base,stage.aggregateHead,cwd)||!await isAncestor(source.base,baseline,cwd))throw Error('Retained source tree or baseline ancestry does not verify');
  const expected=source.prs.slice(0,stage.index).map(pr=>({number:pr.number,head:pr.head}));
  if(expected.length!==stage.index||evidenceKey({prefix:expected})!==evidenceKey({prefix:provenance.prefix})||stage.head!==(stage.index?expected.at(-1).head:source.base))throw Error('Retained source prefix does not match original inputs');
  const mappings=[];
  for(const prior of expected) {
   if(!Number.isSafeInteger(prior.number)||prior.number<1||!sha(prior.head)||mappings.some(item=>item.number===prior.number)||!await isAncestor(prior.head,stage.aggregateHead,cwd))throw Error('Invalid retained PR prefix');
   const merged=await resolveMerge(repository,prior.number,cwd);
   if(merged.number!==prior.number||merged.state!=='MERGED'||merged.headRefOid!==prior.head||merged.baseRefName!==baseBranch||!sha(merged.mergeCommit?.oid)||!await isAncestor(merged.mergeCommit.oid,baseline,cwd))throw Error('Retained PR has not settled with its exact original head on this baseline');
   mappings.push({number:prior.number,originalHead:prior.head,mergeCommit:merged.mergeCommit.oid});
  }
  const manifest=await readJSON(path.join(checkpoint,'manifest.json'));
  await restoreCheckpoint({checkpoint,destination,provenance,now,assertStopped});
  const paths=await continuityPaths(destination,manifest.files);
  if(sourceRunDigest!==await fileDigest(runFile)||manifestDigest!==await fileDigest(path.join(checkpoint,'manifest.json'))||receiptDigest!==await fileDigest(receipt))throw Error('Retained source changed during transfer');
  if(!await loadSuccessfulEvidence(receipt,provenance,{now:Math.max(now,Date.now())}))throw Error('Original retained evidence changed or expired during transfer');
  return {state:destination,...paths,origin:{version:1,kind:'retained-data-transfer',sourceRun:runFile,sourceRunId:source.id,sourceRunDigest,sourceStage:stage.id,originalBase:source.base,originalHead:stage.head,originalAggregateHead:stage.aggregateHead,originalProvenance:provenance,checkpointManifestDigest:manifestDigest,evidenceReceiptDigest:receiptDigest,checkpointExpiresAt:manifest.expiresAt,mappings,targetBaseline:baseline,transferredAt:new Date(now).toISOString(),checkCredit:false}};
 });
}
