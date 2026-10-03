import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {git,saveJSON} from '../io.mjs';
import {localRun} from '../local.mjs';
async function candidate(){
 const dir=await mkdtemp(path.join(os.tmpdir(),'account-orchestration-')),cwd=path.join(dir,'repo');
 await mkdir(path.join(cwd,'apps/web/shell'),{recursive:true});
 await writeFile(path.join(cwd,'apps/web/shell/account-controller.js'),'// account capability');
 await saveJSON(path.join(cwd,'package.json'),{scripts:{'test:e2e:auth':'test-auth'}});
 await git(['init','-b','main'],cwd);await git(['config','user.email','test@example.invalid'],cwd);await git(['config','user.name','Test'],cwd);
 await git(['add','.'],cwd);await git(['commit','-m','account candidate'],cwd);
 return {dir,cwd,base:await git(['rev-parse','HEAD'],cwd)};
}
test('fresh account lanes get separate roots and missing proof blocks readiness despite passing commands',async()=>{
 const {dir,cwd,base}=await candidate(),roots=[];
 for(let i=0;i<2;i++){
  let guestPath,accountPath;
  const result=await localRun({cwd,base,dir:path.join(dir,'attempt'),publishReport:false,lockPath:path.join(dir,'lock'),execute:async(argv,{env})=>{
   if(argv.some(x=>x.endsWith('playwright.validation-account.config.mjs'))){
    roots.push(env.RIGHELT_ACCOUNT_PERSIST_ROOT);accountPath=env.RIGHELT_EVIDENCE_JSON;
    assert.equal(env.RIGHELT_ACCOUNT_CANDIDATE_ROOT,cwd);assert.equal(env.RIGHELT_ACCOUNT_CONTINUITY_INPUT,undefined);
    await saveJSON(accountPath,[]);
   }else{guestPath=env.RIGHELT_EVIDENCE_JSON;await saveJSON(guestPath,[{id:'guest',status:'passed',images:[]}]);}
   return {code:0,duration:1};
  }});
  assert.notEqual(guestPath,accountPath);assert.ok(accountPath.endsWith('.account'));
  assert.equal(result.stage.checks.find(c=>c.name==='Account evidence completeness').status,'failed');
  assert.equal(result.stage.status,'failed');
 }
 assert.notEqual(roots[0],roots[1],'a rerun cannot inherit the previous fresh account database');
});
test('missing retained sidecars fails before any account commands can silently create new users',async()=>{
 const {dir,cwd,base}=await candidate();let calls=0;
 const result=await localRun({cwd,base,dir:path.join(dir,'run'),publishReport:false,lockPath:path.join(dir,'lock'),accountContinuityInput:path.join(dir,'missing'),execute:async()=>{calls++;return {code:0,duration:1};}});
 assert.equal(calls,0);assert.equal(result.stage.status,'failed');
});
