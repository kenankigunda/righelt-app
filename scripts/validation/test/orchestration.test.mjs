import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {git,command} from '../io.mjs';import {fingerprint} from '../local.mjs';import {applyReply,canMerge} from '../model.mjs';
test('aggregate source branches, isolate worktree, and detect post-proof edits',async()=>{
 const cwd=await mkdtemp(path.join(os.tmpdir(),'righelt-orchestration-'));await git(['init','-b','main'],cwd);await git(['config','user.email','test@example.invalid'],cwd);await git(['config','user.name','Validation test'],cwd);await writeFile(path.join(cwd,'base'),'base');await git(['add','.'],cwd);await git(['commit','-m','base'],cwd);const base=await git(['rev-parse','HEAD'],cwd);
 await git(['switch','-c','first'],cwd);await writeFile(path.join(cwd,'one'),'one');await git(['add','.'],cwd);await git(['commit','-m','first'],cwd);const first=await git(['rev-parse','HEAD'],cwd);
 await git(['switch','-c','second',base],cwd);await writeFile(path.join(cwd,'two'),'two');await git(['add','.'],cwd);await git(['commit','-m','second'],cwd);const second=await git(['rev-parse','HEAD'],cwd);const tree=cwd+'-aggregate';await git(['worktree','add','--detach',tree,base],cwd);
 await git(['merge','--no-edit','--no-ff',first],tree);assert.equal(await readFile(path.join(tree,'one'),'utf8'),'one');await git(['merge','--no-edit','--no-ff',second],tree);assert.equal(await readFile(path.join(tree,'two'),'utf8'),'two');const before=await fingerprint(tree);await writeFile(path.join(tree,'one'),'unported fix');assert.notEqual(await fingerprint(tree),before);assert.equal(await git(['rev-parse','HEAD'],cwd),second);
});
test('late grant cannot override a cancellation',()=>{const run={startedAt:'2026-01-01',emailThreads:['t'],prs:[{number:1,base:'main'}]};const m={threadId:'t',from:'x@example.com',labels:['SENT']};applyReply(run,{...m,id:'cancel',internalDate:'2026-03-01',text:'cancel merge 1'},m.from,m.from);applyReply(run,{...m,id:'old',internalDate:'2026-02-01',text:'merge 1'},m.from,m.from);assert.equal(run.prs[0].authorization.state,'cancelled');});
test('resume identity includes candidate order, target and external harness contents',async()=>{
 const {inputSignature}=await import('../integrated.mjs');const prs=[{number:1,head:'one',base:'main'},{number:2,head:'two',base:'main',dependsOn:[1]}];
 const key=inputSignature('o/r','base',prs,'harness','contents');
 for(const args of [['o/r','new',prs,'harness','contents'],['o/r','base',prs,'new-harness','contents'],['o/r','base',prs,'harness','new-contents'],['o/r','base',[...prs].reverse(),'harness','contents'],['o/r','base',prs.map(p=>({...p,base:'release'})),'harness','contents']])assert.notEqual(inputSignature(...args),key);
 assert.equal(inputSignature('o/r','base',prs,'harness','contents'),key);
});
test('retained-state validation rejects candidate edits and a changed sequence harness',async()=>{
 const {localRun}=await import('../local.mjs');const {saveJSON}=await import('../io.mjs');
 const root=await mkdtemp(path.join(os.tmpdir(),'validation-mutation-'));const cwd=path.join(root,'repo');await import('node:fs/promises').then(fs=>fs.mkdir(cwd));
 await git(['init','-b','main'],cwd);await git(['config','user.email','test@example.invalid'],cwd);await git(['config','user.name','Validation test'],cwd);await writeFile(path.join(cwd,'file'),'original');await git(['add','.'],cwd);await git(['commit','-m','base'],cwd);const base=await git(['rev-parse','HEAD'],cwd);
 for(const kind of ['candidate','harness']){
  await writeFile(path.join(cwd,'file'),'original');let n=0;let e2eArtifact;
  const run={version:1,id:kind,mode:'integrated',base,stages:[],prs:[],risks:[],...(kind==='harness'?{harnessRevision:'old',harnessFingerprint:'old'}:{})};
  const result=await localRun({cwd,base,dir:path.join(root,kind),run,publishReport:false,lockPath:path.join(root,'lock'),execute:async(argv,{env})=>{if(argv[1]==='test:e2e')assert.equal(env.CI,'1','candidate E2E must disable legacy server reuse');if(argv[1]==='test:e2e'||argv[2]==='test'){await rm(env.PLAYWRIGHT_OUTPUT_DIR,{recursive:true,force:true});await mkdir(env.PLAYWRIGHT_OUTPUT_DIR,{recursive:true});if(argv[1]==='test:e2e'){e2eArtifact=path.join(env.PLAYWRIGHT_OUTPUT_DIR,'failure-trace.zip');await writeFile(e2eArtifact,'retained E2E failure');}}await saveJSON(env.RIGHELT_EVIDENCE_JSON,[{id:'proof',status:'passed',images:[]}]);if(kind==='candidate'&&n++===0)await writeFile(path.join(cwd,'file'),'unported change');return {code:0,duration:1};}});
  assert.equal(await readFile(e2eArtifact,'utf8'),'retained E2E failure','responsive checks must not erase earlier failure artifacts');assert.equal(result.stage.status,'stale');if(kind==='candidate')assert.equal(result.stage.sourceClean,false);else assert.equal(run.harnessFingerprint,'old');
 }
});
