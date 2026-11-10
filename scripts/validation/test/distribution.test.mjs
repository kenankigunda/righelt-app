import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {installValidationTools,resolveRelease,validationAdapter,shippingSkillPolicy} from '../../install-validation-tools.mjs';
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
  assert.match(adapter,/Only the exact current-head PR validation \/ pr-gate profile blocks CI readiness/);
  assert.match(adapter,/nightly-full is advisory even when failed, pending or missing/);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('Righelt shipping policy is scoped, idempotent and preserves other repository instructions',()=>{
 const original='# Ship\n\nOther repositories require their complete suite.\n';
 const updated=shippingSkillPolicy(original);
 assert.ok(updated.startsWith(original));
 assert.match(updated,/For Righelt only/);
 assert.match(updated,/sole blocking CI aggregate/);
 assert.match(updated,/Other repositories retain their own required checks/);
 assert.equal(shippingSkillPolicy(updated),updated);
 assert.throws(()=>shippingSkillPolicy(original+'<!-- righelt-pr-gate-policy:start -->'),/Malformed/);
});
test('shipping policy installation is opt-in and preserves custom skills',()=>{
 const f=fixture();try{
  const shipping=path.join(f.skillRoot,'ship-worktree/SKILL.md');mkdirSync(path.dirname(shipping),{recursive:true});
  const original='# Custom shipping\nPreserve this private repository guidance.\n';writeFileSync(shipping,original);
  installValidationTools({...f,install:true});assert.equal(readFileSync(shipping,'utf8'),original);
  installValidationTools({...f,install:true,updateShippingSkills:true});
  assert.equal(readFileSync(shipping,'utf8'),shippingSkillPolicy(original));
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('a clean checkout from another repository cannot be updated',()=>{
 const f=fixture(),foreign=fixture();try{
  installValidationTools({...foreign,install:true});
  assert.throws(()=>installValidationTools({...f,destination:foreign.destination,install:true,update:true}),/another repository/);
  assert.equal(git(foreign.destination,'rev-parse','HEAD'),foreign.head);
 }finally{rmSync(f.dir,{recursive:true,force:true});rmSync(foreign.dir,{recursive:true,force:true});}
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
