import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {installValidationTools,resolveRelease,validationAdapter} from '../../install-validation-tools.mjs';
const git=(cwd,...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture(){
 const dir=mkdtempSync(path.join(os.tmpdir(),'validation release spaces '));const source=path.join(dir,'source');mkdirSync(source);
 git(source,'init','-b','main');
 for(const [file,text] of Object.entries({'scripts/validation/cli.mjs':'// fixture CLI','skills/validate-and-shepherd/SKILL.md':'released skill','docs/ai/GH_WATCH_AND_REPAIR_PR_SKILL.template.md':'Use __VALIDATION_TOOLS__'})){
  mkdirSync(path.dirname(path.join(source,file)),{recursive:true});writeFileSync(path.join(source,file),text);
 }
 git(source,'add','.');git(source,'commit','-m','released');git(source,'remote','add','origin',source);git(source,'fetch','origin','main');
 return {dir,source,destination:path.join(dir,'tools with spaces'),skillRoot:path.join(dir,'personal skills'),head:git(source,'rev-parse','HEAD')};
}
test('installer plan writes nothing and adapter uses explicit candidate and released path',()=>{
 const f=fixture();try{
  const plan=installValidationTools(f);assert.equal(plan.revision,f.head);assert.equal(existsSync(f.destination),false);assert.equal(existsSync(f.skillRoot),false);
  const adapter=validationAdapter(f.destination);assert(adapter.includes('--candidate /absolute/candidate/path'));assert(adapter.includes(path.join(f.destination,'skills/validate-and-shepherd/SKILL.md')));
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('unmerged tooling is rejected; explicit install pins detached release and preserves local edits',()=>{
 const f=fixture();try{
  git(f.source,'checkout','-b','feature');writeFileSync(path.join(f.source,'unmerged'),'private');git(f.source,'add','.');git(f.source,'commit','-m','unmerged');
  assert.throws(()=>resolveRelease(f.source,'HEAD'));
  installValidationTools({...f,revision:f.head,install:true});assert.equal(git(f.destination,'rev-parse','HEAD'),f.head);assert.equal(git(f.destination,'rev-parse','--abbrev-ref','HEAD'),'HEAD');
  assert.equal(existsSync(path.join(f.skillRoot,'gh-watch-and-repair-pr')),false);
  writeFileSync(path.join(f.destination,'local-work'),'preserve');
  assert.throws(()=>installValidationTools({...f,revision:f.head,install:true,update:true}),/local changes/);assert.equal(readFileSync(path.join(f.destination,'local-work'),'utf8'),'preserve');
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('personal watcher changes require the explicit option and leave other skills alone',()=>{
 const f=fixture();try{
  const other=path.join(f.skillRoot,'other/SKILL.md');mkdirSync(path.dirname(other),{recursive:true});writeFileSync(other,'untouched');
  installValidationTools({...f,install:true,updateGhWatch:true});assert.equal(readFileSync(other,'utf8'),'untouched');
  assert.equal(readFileSync(path.join(f.skillRoot,'gh-watch-and-repair-pr/SKILL.md'),'utf8'),`Use ${f.destination}\n`);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
