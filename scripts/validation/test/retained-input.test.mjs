import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,cp,access,realpath} from 'node:fs/promises';
import {retainedInputOptions,restoreRetainedInput,assertRetainedTarget,assertRetainedOutput} from '../retained-input.mjs';
import {createCheckpoint} from '../checkpoints.mjs';
import {saveSuccessfulEvidence,fileDigest} from '../reuse.mjs';
import {saveJSON,readJSON,withRunLock} from '../io.mjs';
import {runInNewContext} from 'node:vm';
import {validatePlan,stagePolicy} from '../plan.mjs';
import {restoreCheckpoint} from '../checkpoints.mjs';
import {loadSuccessfulEvidence} from '../reuse.mjs';
import {publicRun} from '../model.mjs';

const sha=digit=>digit.repeat(40),stopped=async()=>true;
const history={version:1,gameId:'retained',moves:[{moveId:'original-move',action:{type:'pass'},selectionSnapshot:{turnIndex:0},snapshot:{turnIndex:1}}],turns:[{index:0}],board:{state:{turnIndex:1}}};
const storage={cookies:[{name:'session',value:'private-cookie',expires:-1}],origins:[{origin:'http://127.0.0.1:9888',localStorage:[{name:'righelt.identity.id.v1',value:'original-owner'}]}]};
const fixtureJSON={version:2,hash:'#/game/retained',count:1,role:'Both Players',history,storage};
export async function retainedFixture({account=false,index=1,pointers,cookieExpires}={}) {
 const retainedStorage=structuredClone(storage);if(cookieExpires!==undefined)retainedStorage.cookies[0].expires=cookieExpires;
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'retained-transfer-'))),source=path.join(root,'source'),state=path.join(source,'live');
 await mkdir(path.join(state,'guest/api-state/v3/d1/database'),{recursive:true,mode:0o700});
 await writeFile(path.join(state,'guest/api-state/v3/d1/database/original.sqlite'),'original guest database');
 await saveJSON(path.join(state,'continuity.json'),{...fixtureJSON,storage:retainedStorage});
 await saveJSON(path.join(state,'continuity-state.json'),pointers??{continuity:'continuity.json',accountContinuity:account?'continuity.json':null,legacyContinuity:null});
 if(account){
  await mkdir(path.join(state,'account/state/v3/d1/database'),{recursive:true,mode:0o700});
  await writeFile(path.join(state,'account/state/v3/d1/database/original.sqlite'),'original account database');
  await writeFile(path.join(state,'account/hmac-v1.key'),'a'.repeat(64),{mode:0o600});
  for(const viewport of ['mobile','mid-wide','full-wide'])await saveJSON(path.join(state,`continuity.json.account-${viewport}`),{version:2,account:{id:'original-account'},username:'original-user',password:'private-password',gameURL:'https://127.0.0.1:9988/#/game/retained',history,storage:retainedStorage});
 }
 const provenance={version:2,base:sha('1'),tree:sha('3'),prefix:index?[{number:1,head:sha('2')}]:[],policy:{phase:'final'},harnessFingerprint:'original-harness',node:'v22',platform:'darwin',arch:'arm64'};
 const stage={id:`stage-${index}`,index,status:'passed',head:index?sha('2'):sha('1'),aggregateHead:index?sha('4'):sha('1'),checks:[{name:'Original retained proof',status:'passed'}],items:[],checkpoint:path.join(source,'checkpoint'),checkpointProvenance:provenance,evidenceReceipt:path.join(source,'evidence.json')};
 const expiresAt=new Date(Date.now()+3600000).toISOString();
 await createCheckpoint({root:state,destination:stage.checkpoint,provenance,expiresAt,assertStopped:stopped});
 const artifact=path.join(source,'original.log');await writeFile(artifact,'original successful evidence');
 await saveSuccessfulEvidence(stage.evidenceReceipt,{provenance,result:stage,artifacts:[artifact],expiresAt});
 const run={version:2,id:'original-run',mode:'integrated',repository:'owner/repo',base:sha('1'),plan:{base:'main'},prs:index?[{number:1,head:sha('2')}]:[],stages:[stage]};
 const runFile=path.join(source,'run.json');await saveJSON(runFile,run);
 const target=path.join(root,'new');await mkdir(target,{mode:0o700});
 const calls=[];
 const options={input:{runFile,stageId:stage.id},repository:'owner/repo',baseBranch:'main',baseline:sha('5'),cwd:root,destination:path.join(target,'state'),targetRunDir:target,assertStopped:stopped,treeOf:async()=>sha('3'),isAncestor:async()=>true,resolveMerge:async(repository,number)=>{calls.push({repository,number});return{number,state:'MERGED',headRefOid:sha('2'),mergeCommit:{oid:sha('6')},baseRefName:'main'};}};
 return{root,source,state,target,stage,run,runFile,artifact,options,calls,cleanup:()=>rm(root,{recursive:true,force:true})};
}

test('retained flags require unique paired absolute input on a new integrated v2 run',()=>{
 assert.equal(retainedInputOptions({mode:'integrated',args:[],flags:{}}),undefined);
 const valid={mode:'integrated',args:['--retained-run','/private/run.json','--retained-stage','stage-1'],flags:{'retained-run':'/private/run.json','retained-stage':'stage-1'}};
 assert.deepEqual(retainedInputOptions(valid),{runFile:'/private/run.json',stageId:'stage-1'});
 for(const mutate of [value=>value.mode='local',value=>value.flags.resume=true,value=>value.flags.legacy=true,value=>delete value.flags['retained-stage'],value=>value.flags['retained-run']='relative.json',value=>value.flags['retained-stage']='../stage',value=>value.args.push('--retained-run','/other'),value=>value.args.push('--retained-run=/other'),value=>value.args.push('--retained-unknown','x')]){
  const input=structuredClone(valid);mutate(input);assert.throws(()=>retainedInputOptions(input));
 }
});

for(const account of [false,true])test(`original ${account?'account and guest':'guest'} data survives transfer without rewriting provenance or importing check credit`,async()=>{
 const f=await retainedFixture({account});try{
  const before=await fileDigest(f.runFile),originalManifest=await readFile(path.join(f.stage.checkpoint,'manifest.json'));
  const result=await restoreRetainedInput(f.options);
  assert.equal(result.origin.checkCredit,false);assert.equal(result.origin.originalProvenance.harnessFingerprint,'original-harness');assert.equal(result.origin.targetBaseline,sha('5'));
  assert.deepEqual(result.origin.mappings,[{number:1,originalHead:sha('2'),mergeCommit:sha('6')}]);
  assert.deepEqual((await readJSON(result.continuity)).history,history);assert.deepEqual((await readJSON(result.continuity)).storage,storage);
  assert.equal(await readFile(path.join(result.state,'guest/api-state/v3/d1/database/original.sqlite'),'utf8'),'original guest database');
  if(account){assert.equal(await readFile(path.join(result.state,'account/hmac-v1.key'),'utf8'),'a'.repeat(64));assert.equal((await readJSON(`${result.accountContinuity}.account-mobile`)).account.id,'original-account');}
  assert.equal(await fileDigest(f.runFile),before);assert.deepEqual(await readFile(path.join(f.stage.checkpoint,'manifest.json')),originalManifest);
  const published=JSON.stringify(publicRun({stages:[],retainedTransfer:result.origin}));assert.ok(!published.includes(f.root));assert.ok(!published.includes('private-cookie'));assert.ok(!published.includes('private-password'));
 }finally{await f.cleanup();}
});

test('an original main baseline without tested PR prefixes needs ancestry but no merge lookup',async()=>{
 const f=await retainedFixture({index:0});try{await restoreRetainedInput(f.options);assert.deepEqual(f.calls,[]);}finally{await f.cleanup();}
});

test('invalid original evidence, settlement, paths, expiry or services fail closed',async()=>{
 const cases=[
  async f=>{f.options.repository='other/repo';},
  async f=>{f.run.prs[0].head=sha('9');await saveJSON(f.runFile,f.run);},
  async f=>{f.run.stages.push(structuredClone(f.stage));await saveJSON(f.runFile,f.run);},
  async f=>{let calls=0;f.options.assertStopped=async()=>++calls<3;},
  async f=>{f.run.stages[0].status='failed';await saveJSON(f.runFile,f.run);},
  async f=>{await writeFile(f.artifact,'changed');},
  async f=>{await rm(f.stage.evidenceReceipt);},
  async f=>{await writeFile(path.join(f.stage.checkpoint,'state/guest/api-state/v3/d1/database/original.sqlite'),'changed');},
  async f=>{f.options.now=Date.now()+7200000;},
  async f=>{f.options.assertStopped=async()=>false;},
  async f=>{f.options.treeOf=async()=>sha('9');},
  async f=>{f.options.isAncestor=async()=>false;},
  async f=>{f.options.resolveMerge=async()=>({number:1,state:'OPEN',headRefOid:sha('2'),mergeCommit:{oid:sha('6')},baseRefName:'main'});},
  async f=>{f.options.resolveMerge=async()=>({number:1,state:'MERGED',headRefOid:sha('9'),mergeCommit:{oid:sha('6')},baseRefName:'main'});},
  async f=>{f.options.resolveMerge=async()=>({number:1,state:'MERGED',headRefOid:sha('2'),mergeCommit:{oid:sha('6')},baseRefName:'other'});},
  async f=>{f.options.isAncestor=async ancestor=>ancestor!==sha('6');},
  async f=>{f.options.targetRunDir=f.source;f.options.destination=path.join(f.source,'new-state');},
  async f=>{await mkdir(f.options.destination);await writeFile(path.join(f.options.destination,'owned.txt'),'do not overwrite');},
  async f=>{await mkdir(path.join(f.target,'elsewhere'));await symlink(path.join(f.target,'elsewhere'),f.options.destination);},
 ];
 for(const mutate of cases){const f=await retainedFixture();try{await mutate(f);await assert.rejects(()=>restoreRetainedInput(f.options));}finally{await f.cleanup();}}
});

for(const pointers of [{continuity:'../outside.json'},{continuity:'/absolute.json'},{continuity:'missing.json'},{continuity:'continuity.json',unexpected:'state'},{continuity:'continuity.json',accountContinuity:'continuity.json'}])test(`unsafe or incomplete continuity input is rejected: ${JSON.stringify(pointers)}`,async()=>{
 const f=await retainedFixture({pointers});try{await assert.rejects(()=>restoreRetainedInput(f.options));}finally{await f.cleanup();}
});

for(const invalid of [false,true])test(`actual bounded orchestration ${invalid?'never fresh-seeds invalid explicit input':'reruns baseline with original retained data and zero source check credit'}`,async()=>{
 const f=await retainedFixture({account:true});try{
  const code=(await readFile(new URL('../integrated-bounded.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('export async function ','async function ').replaceAll('export function ','function ');
  const calls=[],candidate=path.join(f.root,'candidate'),out=path.join(f.root,'receiving'),harnessRoot=path.join(f.root,'harness');await mkdir(candidate);await mkdir(harnessRoot);
  let fetched=sha('5');
  const git=async(args,cwd)=>{
   if(args[0]==='fetch'){fetched=args[2].startsWith('pull/')?sha('7'):sha('5');return '';}
   if(args[0]==='rev-parse')return args[1]==='HEAD^{tree}'?sha('9'):cwd===harnessRoot?sha('8'):args[1]==='FETCH_HEAD'?fetched:sha('5');
   if(args[0]==='worktree'){await mkdir(args.at(-2),{recursive:true});return '';}
   if(args[0]==='merge')return '';
   if(args[0]==='diff')return 'apps/web/change.js';
   if(args[0]==='ls-remote')return `${sha('5')}\trefs/heads/main`;
   throw Error(`Unexpected orchestration Git request ${args[0]}`);
  };
  const command=async args=>args[0]==='lsof'?{code:1,output:''}:{code:0,output:JSON.stringify({number:2,title:'Next product',url:'https://github.com/owner/repo/pull/2',headRefOid:sha('7'),headRefName:'feature',baseRefName:'main',baseRefOid:sha('5'),state:'OPEN',isDraft:false})};
  const localRun=async options=>{
   calls.push(options);
   assert.ok(options.continuityInput.startsWith(out+path.sep));assert.ok(options.accountContinuityInput.startsWith(out+path.sep));
   assert.deepEqual((await readJSON(options.continuityInput)).history,history);
   assert.equal(await readFile(path.join(options.accountPersistRoot,'hmac-v1.key'),'utf8'),'a'.repeat(64));
   await saveJSON(options.continuityOutput,fixtureJSON);
   for(const viewport of ['mobile','mid-wide','full-wide'])await writeFile(`${options.continuityOutput}.account-${viewport}`,await readFile(`${options.accountContinuityInput}.account-${viewport}`));
   await mkdir(path.join(options.dir,'site'),{recursive:true});
   return{run:{risks:[]},stage:{id:`stage-${options.stageIndex}`,index:options.stageIndex,status:'passed',head:sha('5'),checks:[{name:'New baseline retained proof',status:'passed'}],items:[]}};
  };
  const context={path,mkdir,cp,assertRetainedOutput,command,git,readJSON,saveJSON,hash:JSON.stringify,validatePlan,stagePolicy,localRun,harnessRoot,fingerprint:async()=> 'receiving-harness',candidateCapabilities:async()=>({accounts:true}),ensureInstallation:async()=>{},loadSuccessfulEvidence,saveSuccessfulEvidence,createCheckpoint,restoreCheckpoint,restoreRetainedInput:options=>restoreRetainedInput({...options,treeOf:f.options.treeOf,isAncestor:f.options.isAncestor,resolveMerge:f.options.resolveMerge}),renderReport:async()=>{},publish:async()=>{},Date,JSON,process,structuredClone};
  runInNewContext(`${code};globalThis.execute=boundedIntegratedRun;`,context);
  const result=await context.execute({spec:{version:2,repository:'owner/repo',base:'main',prs:[{number:2}],questions:[{id:'next',description:'Next retained contract',paths:['apps/'],checks:['Responsive proof']}]},cwd:candidate,dir:out,config:{},retainedInput:{...f.options.input,...(invalid?{stageId:'stage-99'}:{})}});
  if(invalid){assert.equal(result.run.complete,false);assert.equal(result.run.orchestration,'failed');assert.equal(calls.length,0);}
  else{
   assert.equal(result.run.complete,true,JSON.stringify(await readJSON(path.join(out,'attempts',String(result.run.attempt),'startup-error.json'),null)));assert.equal(calls.length,2);assert.equal(calls[0].stageIndex,0);
   assert.equal(result.run.base,sha('5'));assert.equal(result.run.harnessFingerprint,'receiving-harness');assert.equal(result.run.retainedTransfer.originalBase,sha('1'));assert.equal(result.run.retainedTransfer.checkCredit,false);
   for(const stage of result.run.stages){assert.deepEqual([...stage.checks].map(check=>check.name),['New baseline retained proof']);assert.equal(stage.reusedFrom,undefined);}
   assert.deepEqual((await readJSON(path.join(f.state,'continuity.json'))).history,history);
   const resumed=await context.execute({spec:{version:2,repository:'owner/repo',base:'main',prs:[{number:2}],questions:[{id:'next',description:'Next retained contract',paths:['apps/'],checks:['Responsive proof']}]},cwd:candidate,dir:out,config:{},resume:true});
   assert.equal(resumed.run.complete,true);assert.equal(calls.length,2,'Resume may reuse only the new exact-target proof, never original source checks');
   assert.equal(resumed.run.retainedTransfer.originalBase,sha('1'));assert.equal(resumed.run.attempts.at(-1).retainedTransfer.originalBase,sha('1'));
  }
 }finally{await f.cleanup();}
});


test('an unexpired evidence receipt cannot extend the original cookie-bound checkpoint deadline',async()=>{
 const f=await retainedFixture({cookieExpires:Math.floor((Date.now()+1800000)/1000)});
 try{f.options.now=Date.now()+2700000;await assert.rejects(()=>restoreRetainedInput(f.options),/expiry/);}finally{await f.cleanup();}
});

test('an existing destination and original identity remain untouched on rejection',async()=>{
 const f=await retainedFixture();try{
  await mkdir(f.options.destination);const owned=path.join(f.options.destination,'owned.txt');await writeFile(owned,'unrelated owner data');
  await assert.rejects(()=>restoreRetainedInput(f.options),/Destination already exists/);
  assert.equal(await readFile(owned,'utf8'),'unrelated owner data');assert.equal((await readJSON(path.join(f.state,'continuity.json'))).storage.origins[0].localStorage[0].value,'original-owner');
 }finally{await f.cleanup();}
});


test('receiving-run overlap is rejected before creating files or contacting GitHub',()=>{
 const input={runFile:'/private/original/run.json',stageId:'stage-1'};
 for(const destination of ['/private/original','/private/original/new','/private'])assert.throws(()=>assertRetainedTarget(input,destination),/separate/);
 assert.doesNotThrow(()=>assertRetainedTarget(input,'/private/new-run'));
});


test('symlink aliases, existing run records and attempt state are rejected before any output write',async()=>{
 const f=await retainedFixture();try{
  const original=await fileDigest(f.runFile),alias=path.join(f.root,'source-alias');await symlink(f.source,alias);
  await assert.rejects(()=>assertRetainedOutput(f.options.input,path.join(alias,'new')),/real|symlink/);
  await assert.rejects(()=>access(path.join(f.source,'new')));
  assert.equal(await fileDigest(f.runFile),original);
  for(const name of ['run.json','attempts']){
   const target=path.join(f.root,`existing-${name}`);await mkdir(target);
   if(name==='attempts')await mkdir(path.join(target,name));else await writeFile(path.join(target,name),'existing run history');
   await assert.rejects(()=>assertRetainedOutput(f.options.input,target),/refusing overwrite/);
   if(name==='run.json')assert.equal(await readFile(path.join(target,name),'utf8'),'existing run history');
  }
  await assertRetainedOutput(f.options.input,path.join(f.root,'new-output'));
  await assert.rejects(()=>access(path.join(f.root,'new-output')));
 }finally{await f.cleanup();}
});


test('unrelated receiving files and sites are preserved and only the CLI-owned lock may coexist with empty output',async()=>{
 const f=await retainedFixture();try{
  for(const directory of [false,true]){
   const out=path.join(f.root,directory?'unrelated-site':'unrelated-file');await mkdir(out);
   const file=directory?path.join(out,'site','report.html'):path.join(out,'notes.txt');
   if(directory)await mkdir(path.dirname(file));await writeFile(file,'unrelated content must survive');
   await assert.rejects(()=>assertRetainedOutput(f.options.input,out),/refusing overwrite/);
   assert.equal(await readFile(file,'utf8'),'unrelated content must survive');
  }
  const out=path.join(f.root,'empty-receiving');await mkdir(out);await assertRetainedOutput(f.options.input,out);
  await withRunLock(path.join(out,'run.json'),async()=>{
   await assert.rejects(()=>assertRetainedOutput(f.options.input,out),/refusing overwrite/);
   await assertRetainedOutput(f.options.input,out,{allowOwnedLock:true});
   await saveJSON(path.join(out,'run.json.lock','owner.json'),{pid:process.pid+1,startedAt:new Date().toISOString()});
   await assert.rejects(()=>assertRetainedOutput(f.options.input,out,{allowOwnedLock:true}),/not owned/);
  });
 }finally{await f.cleanup();}
});
