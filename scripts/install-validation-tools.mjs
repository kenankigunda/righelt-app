#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,lstatSync,copyFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export function resolveRelease(source,revision='origin/main'){
 const head=git(source,'rev-parse','--verify',`${revision}^{commit}`);
 const main=git(source,'rev-parse','--verify','origin/main^{commit}');
 git(source,'merge-base','--is-ancestor',head,main);
 for(const file of ['scripts/validation/cli.mjs','skills/validate-and-shepherd/SKILL.md'])git(source,'cat-file','-e',`${head}:${file}`);
 return {head,main};
}
export function validationAdapter(destination){
 const skill=path.join(destination,'skills/validate-and-shepherd/SKILL.md');
 return `---\nname: righelt-validation\ndescription: Validate and shepherd Righelt changes using the installed, pinned release of the repository validation tools.\n---\n\nRead [the released validation skill](${skill}) and its references. Use this released checkout as the harness, with an explicit candidate path for every run. Never execute tooling from a candidate branch merely because it is current.\n\nOnly the exact current-head PR validation / pr-gate profile blocks CI readiness. Full validation is retired; nightly-full is advisory even when failed, pending or missing. Preserve explicit feature acceptance, independent review, retained-state proof, authorization and deployment verification separately.\n\nFirst inspect \`plan --candidate /absolute/path\` using the released CLI. Version 3 plans reuse compatible proof, require a reason for extra checks, and stop when acceptance is complete. Read docs/ai/VALIDATION_EVIDENCE_POLICY.md in that release. CI narrowing remains separate.\n\nCommand: \`node ${JSON.stringify(path.join(destination,'scripts/validation/cli.mjs'))} local --candidate /absolute/candidate/path\`. Use \`integrated --candidate /absolute/repository/path --manifest /absolute/manifest.json\` for an ordered feature set. Follow the released skill for authorization, paused scheduling, and evidence reuse. Publishing is paused by default until explicitly resumed; use --no-publish and deliver the local evidence.md with key inspected screenshot embeds in the Codex task.\n`;
}
const shippingPolicyStart='<!-- righelt-pr-gate-policy:start -->';
const shippingPolicyEnd='<!-- righelt-pr-gate-policy:end -->';
export function shippingSkillPolicy(original){
 const section=`${shippingPolicyStart}\n## Righelt CI policy\n\nFor Righelt only, PR validation over the exact current-head pr-gate profile is the sole blocking CI aggregate. Full validation is retired and must not be awaited. Failed, pending or missing nightly-full results are advisory and do not independently block merge or deployment. Use the pinned released righelt-validation skill. Preserve targeted feature acceptance, independent review, retained-state proof, authorization and deployed-identity verification. Inspect the released plan first. Use version 3 evidence reuse, run additional checks only for mapped correctness risks, and recheck only invalidated proof after repairs. Continue independent work while CI runs unless the user explicitly requested waiting. CI narrowing remains separate. Other repositories retain their own required checks.\n${shippingPolicyEnd}`;
 const start=original.indexOf(shippingPolicyStart),end=original.indexOf(shippingPolicyEnd);
 if(start!==-1||end!==-1){
  if(start===-1||end<start||original.indexOf(shippingPolicyStart,start+1)!==-1||original.indexOf(shippingPolicyEnd,end+1)!==-1)throw Error('Malformed Righelt shipping policy markers');
  return original.slice(0,start)+section+original.slice(end+shippingPolicyEnd.length);
 }
 return original+'\n'+section+'\n';
}
function installFile(file,contents){
 mkdirSync(path.dirname(file),{recursive:true});
 if(existsSync(file)){
  if(lstatSync(file).isSymbolicLink())throw Error(`Refusing to replace symlink: ${file}`);
  if(readFileSync(file,'utf8')===contents)return;
  const backup=`${file}.before-${Date.now()}`;
  copyFileSync(file,backup);
 }
 writeFileSync(file,contents,{mode:0o600});
}
export function installValidationTools({source=repository,destination=path.join(path.dirname(source),'righelt-validation-tools'),skillRoot=path.join(os.homedir(),'.codex/skills'),revision='origin/main',install=false,update=false,updateGhWatch=false,updateShippingSkills=false}={}){
 source=path.resolve(source);destination=path.resolve(destination);skillRoot=path.resolve(skillRoot);
 if(source===destination)throw Error('Released tools must have a dedicated checkout');
 if(install)git(source,'fetch','origin','main');
 const release=resolveRelease(source,revision);
 const adapter=path.join(skillRoot,'righelt-validation/SKILL.md');
 const watcher=path.join(skillRoot,'gh-watch-and-repair-pr/SKILL.md');
 const shipping=path.join(skillRoot,'ship-worktree/SKILL.md');
 const plan={source,destination,...(updateShippingSkills?{shipping}:{}),revision:release.head,mergedMain:release.main,adapter,...(updateGhWatch?{watcher}:{}),install};
 if(!install)return plan;
 if(existsSync(destination)){
  if(lstatSync(destination).isSymbolicLink())throw Error('Refusing a symlink tools checkout');
  if(git(destination,'status','--porcelain','--untracked-files=all'))throw Error('Installed tools have local changes; preserve them before updating');
  if(realpathSync(path.resolve(destination,git(destination,'rev-parse','--git-common-dir')))!==realpathSync(path.resolve(source,git(source,'rev-parse','--git-common-dir'))))throw Error('Installed tools belong to another repository');
  if(git(destination,'rev-parse','--abbrev-ref','HEAD')!=='HEAD')throw Error('Installed tools must remain detached');
  if(git(destination,'rev-parse','HEAD')!==release.head){
   if(!update)throw Error('Different tools revision already installed; explicitly use --update');
   git(destination,'checkout','--detach',release.head);
  }
 }else git(source,'worktree','add','--detach',destination,release.head);
 installFile(adapter,validationAdapter(destination));
 if(updateGhWatch){
  const template=git(source,'show',`${release.head}:docs/ai/GH_WATCH_AND_REPAIR_PR_SKILL.template.md`);
  installFile(watcher,template.replaceAll('__VALIDATION_TOOLS__',destination)+'\n');
 }
 if(updateShippingSkills&&existsSync(shipping)){
  const original=readFileSync(shipping,'utf8');
  installFile(shipping,shippingSkillPolicy(original.replace('rerun the full visual suite, and amend the feature commit.', 'rerun affected visual checks and the repository-required final pass, crediting compatible existing evidence, and amend the feature commit.')));
 }
 return plan;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const options={};const keys={'--source':'source','--destination':'destination','--skill-root':'skillRoot','--revision':'revision'};
  for(let i=2;i<process.argv.length;i++){
   const arg=process.argv[i];
   if(arg==='--install')options.install=true;
   else if(arg==='--update')options.update=true;
   else if(arg==='--update-gh-watch')options.updateGhWatch=true;
   else if(arg==='--update-shipping-skills')options.updateShippingSkills=true;
   else if(keys[arg]){if(!process.argv[i+1]||process.argv[i+1].startsWith('--'))throw Error(`Missing value for ${arg}`);options[keys[arg]]=process.argv[++i];}
   else throw Error(`Unknown option ${arg}; default is a read-only plan. Use --install only after release and explicit authorization.`);
  }
  console.log(JSON.stringify(installValidationTools(options),null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
