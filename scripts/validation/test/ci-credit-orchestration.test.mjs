import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {git,saveJSON} from '../io.mjs';
import {localRun} from '../local.mjs';
import {evidenceKey,fileDigest} from '../reuse.mjs';

const groups={'Browser integration':'test:browser:integration',Tooling:'test:tooling',Performance:'test:performance'};
async function fixture(t,fault){
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'ci-credit-orchestration-'))),cwd=path.join(root,'candidate');
  t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(cwd);
  await saveJSON(path.join(cwd,'package.json'),{scripts:Object.fromEntries(Object.values(groups).map(script=>[script,'fixture command']))});
  await git(['init','-b','main'],cwd);await git(['config','user.name','Validation test'],cwd);await git(['config','user.email','test@example.invalid'],cwd);
  await git(['add','.'],cwd);await git(['commit','-m','candidate fixture'],cwd);
  const tree=await git(['rev-parse','HEAD^{tree}'],cwd),checkout=await git(['rev-parse','HEAD'],cwd),receipts={};
  for(const[name,script]of Object.entries(groups)){
    const log=path.join(root,`${script.replaceAll(':','-')}.log`),archive=`${log}.zip`;
    await writeFile(log,'verified primary CI log');await writeFile(archive,'verified CI artifact bytes');
    const receipt={name,status:'passed',source:'github-actions',testedTree:fault==='tree'?'a'.repeat(40):tree,argv:['pnpm',fault==='command'?'different-command':script],importedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),evidence:[{checkout,provenance:{testedTree:tree,checkout},log,logHash:await fileDigest(log),archive,archiveHash:await fileDigest(archive)}]};
    receipt.integrity=evidenceKey(receipt);receipts[name]=receipt;
    if(fault==='artifact')await writeFile(archive,'changed after verified import');
  }
  const ciEvidence=path.join(root,'ci-import.json');await saveJSON(ciEvidence,{receipts});
  return{root,cwd,ciEvidence};
}

for(const fault of [null,'tree','command','artifact'])test(`CI credit orchestration ${fault?`rejects ${fault} mismatch`:'reuses all three additional verified groups'}`,async t=>{
  const{root,cwd,ciEvidence}=await fixture(t,fault),executed=[];
  const policy={version:2,phase:'final',lanes:1,visualMode:'none',viewports:['mobile'],coverageViewports:['mobile'],questions:[],unmapped:[],selected:[...Object.keys(groups),'Responsive proof']};
  const{stage}=await localRun({cwd,base:'HEAD',dir:path.join(root,'run'),lockPath:path.join(root,'lock'),policy,ciEvidence,publishReport:false,execute:async(argv,{env})=>{
    executed.push(argv);
    await saveJSON(env.RIGHELT_EVIDENCE_JSON,[{viewport:'mobile',title:'create, move, viewer live update, reload and reconnect',status:'passed',images:[]}]);
    return{code:0,duration:1};
  }});
  for(const[name,script]of Object.entries(groups)){
    const check=stage.checks.find(check=>check.name===name);assert.equal(check.status,'passed');
    assert.equal(check.reused===true,!fault);
    assert.equal(executed.some(argv=>argv[1]===script),Boolean(fault));
    if(!fault){assert.equal(check.source,'github-actions');assert.equal(check.receipt.name,name);assert.equal(check.receipt.testedTree,check.provenance.tree);}
  }
  // Browser/retained behavior is never inferred from these suite receipts.
  assert.ok(executed.some(argv=>argv.some(part=>part.endsWith('playwright.validation.config.mjs'))));
  assert.equal(stage.status,'passed');
});
