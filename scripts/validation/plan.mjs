import path from 'node:path';
import {readJSON} from './io.mjs';
import {SUITES,prGateLanes} from '../testing/catalog.mjs';

export const CHECKS = ['PR gate','Typecheck','Generated runtime','Unit','Integration','E2E','Auth E2E','Responsive proof','Account responsive proof','Report viewer','Browser integration','Tooling','Performance','Trainer checks','AI benchmark checks'];
export function validatePlan(spec) {
  if (![2,3].includes(spec.version)) throw Error('Bounded validation requires manifest version 2 or 3');
  if (!Array.isArray(spec.questions) || (spec.version===2&&!spec.questions.length)) throw Error('Map release questions before validation');
  const ids = new Set();
  for (const q of spec.questions) {
    if (!q.id || ids.has(q.id) || !q.description || !Array.isArray(q.paths) || !q.paths.length || !Array.isArray(q.checks) || !q.checks.length || q.checks.some(c=>!CHECKS.includes(c))) throw Error('Each unique release question needs description, paths and known checks');
    if(q.boundaryChecks&&(!Array.isArray(q.boundaryChecks)||q.boundaryChecks.some(c=>!CHECKS.includes(c))))throw Error('Unknown boundary check');
    if(spec.version===3){
      if(!Array.isArray(q.evidence)||!q.evidence.length)throw Error('Version 3 questions require explicit evidence bindings');
      for(const binding of q.evidence){
        if(!q.checks.includes(binding.check)&&binding.check!=='Boundary E2E')throw Error('Evidence must bind a selected question check');
        if(binding.check==='Boundary E2E'){
          if(!binding.files?.length||binding.files.some(f=>!/^e2e\/[\w./-]+\.spec\.mjs$/.test(f)||f.includes('..')))throw Error('Bind explicit candidate test files');
        }else if(binding.check==='PR gate'){
          const requirements=new Set(SUITES.filter(s=>prGateLanes().some(l=>l.suite===s.id)).flatMap(s=>s.requirements));
          if(!binding.requirements?.length||binding.requirements.some(r=>!requirements.has(r)))throw Error('Bind catalog requirements actually covered by the PR gate');
        }else if(!binding.workflows?.length||binding.workflows.some(w=>typeof w!=='string'||!w.trim()))throw Error('Bind exact behavioral evidence workflow titles');
      }
      if(q.continuity?.some(kind=>!['guest','account'].includes(kind)))throw Error('Unknown continuity contract');
    }
    ids.add(q.id);
  }
  if (spec.lanes !== undefined && ![1,2].includes(spec.lanes)) throw Error('Use one or two isolated lanes');
  if (spec.visual?.viewports?.some(v=>!['mobile','mid-wide','full-wide'].includes(v))) throw Error('Unknown visual viewport');
  if(spec.version===3&&(spec.prs??[]).some(p=>p.tests?.length))throw Error('Version 3 binds candidate files through question evidence, not legacy prs.tests');
  for (const p of spec.prs ?? []) if (p.tests && (!Array.isArray(p.tests) || p.tests.some(f=>typeof f!=='string'||!/^e2e\/[\w./-]+\.spec\.mjs$/.test(f)||f.includes('..')))) throw Error('Boundary tests must be explicit candidate E2E files');
  return spec;
}
export function questionsForFiles(spec, files) {
  const relevant = files.filter(f=>/^(apps\/|packages\/|db\/|e2e\/)/.test(f));
  const matched = q=>relevant.some(f=>q.paths.some(prefix=>f.startsWith(prefix)));
  return {questions:spec.questions.filter(matched),unmapped:relevant.filter(f=>!spec.questions.some(q=>q.paths.some(prefix=>f.startsWith(prefix))))};
}
export function stagePolicy(spec,index,{accounts=false,changed=[]}={}) {
  validatePlan(spec);
  if(spec.version===3)return streamlinedPolicy(spec,index,{accounts,changed});
  const final=index===(spec.prs?.length??0), phase=index===0&&!final?'baseline':final?'final':'boundary';
  const coverage=questionsForFiles(spec,changed);
  if(final)coverage.questions=spec.questions;
  const reportChanged=spec.validateReportViewer===true||changed.some(f=>/^scripts\/validation\/(?:assets\/|report\.mjs|model\.mjs|test\/report-browser\.mjs)/.test(f));
  const visualMode=final?'walkthrough':'none';
  const tests=phase==='final'?[...new Set((spec.prs??[]).flatMap(pr=>pr.tests??[]))]:phase==='boundary'?(spec.prs?.[index-1]?.tests??[]):[];
  const boundaryChecks=[...new Set(coverage.questions.flatMap(q=>q.boundaryChecks??[]))];
  if(phase==='boundary'&&coverage.questions.length&&!tests.length&&!boundaryChecks.length)coverage.unmapped.push('Explicit boundary tests or boundaryChecks are required for changed release questions');
  return {version:2,phase,visualMode,lanes:spec.lanes??2,questions:coverage.questions,unmapped:coverage.unmapped,
    tests,coverageViewports:['mobile','mid-wide','full-wide'],viewports:spec.visual?.viewports??['mobile','mid-wide'],checkpoints:spec.visual?.checkpoints,
    selected:phase==='final'?[...new Set(['PR gate',...(tests.length?['Boundary E2E']:[]),'Responsive proof',...(accounts?['Account responsive proof']:[]),...(reportChanged?['Report viewer']:[]),...coverage.questions.flatMap(q=>phase==='boundary'?(q.boundaryChecks??q.checks.filter(c=>c!=='PR gate')):q.checks)])]:
      [...new Set(['Typecheck','Generated runtime',...boundaryChecks,...(tests.length?['Boundary E2E']:[]),'Responsive proof',...(accounts?['Account responsive proof']:[])])],
    rationale:spec.prs?.[index-1]?.rationale??(final?'PR gate, explicit release questions and fresh/retained continuity':'Focused explicit boundary and continuity; PR gate and release questions at final candidate')};
}
function streamlinedPolicy(spec,index,{accounts,changed}){
 const final=index===(spec.prs?.length??0),phase=index===0&&!final?'baseline':final?'final':'boundary';
 const coverage=questionsForFiles(spec,changed);
 if(final||phase==='baseline')coverage.questions=spec.questions;
 const continuity=[...new Set((phase==='boundary'?coverage.questions:spec.questions).flatMap(q=>q.continuity??[]))];
 if(continuity.includes('account')&&!accounts)coverage.unmapped.push('Required account continuity capability is absent');
 const questions=phase==='baseline'?coverage.questions.filter(q=>q.continuity?.length):coverage.questions;
 const tests=phase==='baseline'?[]:[...new Set(questions.flatMap(q=>q.evidence.filter(e=>e.check==='Boundary E2E').flatMap(e=>e.files)))];
 const selected=[...new Set([...(final?['PR gate']:[]),...(phase==='baseline'?[]:questions.flatMap(q=>phase==='boundary'?(q.boundaryChecks??q.checks.filter(c=>c!=='PR gate')):q.checks)),...(tests.length?['Boundary E2E']:[]),...(continuity.includes('guest')?['Responsive proof']:[]),...(continuity.includes('account')?['Account responsive proof']:[]),...(phase!=='baseline'&&changed.some(f=>/^scripts\/validation\/(?:assets\/|report\.mjs|model\.mjs|test\/report-browser\.mjs)/.test(f))?['Report viewer']:[])])];
 if(phase==='boundary'&&coverage.questions.length&&!selected.length)coverage.unmapped.push('Changed boundary has no acceptance evidence');
 const visualMode=phase!=='baseline'&&spec.visual?'walkthrough':'none';
 if(visualMode!=='none'&&!selected.some(c=>['Responsive proof','Account responsive proof'].includes(c)))coverage.unmapped.push('Visual review requires a selected visual evidence producer');
 return {version:3,phase,lanes:1,questions,unmapped:coverage.unmapped,selected,tests,continuity,visualMode,coverageViewports:['mobile','mid-wide','full-wide'],viewports:spec.visual?.viewports??['mobile','mid-wide'],checkpoints:spec.visual?.checkpoints,reasons:Object.fromEntries(selected.map(name=>[name,name==='PR gate'?'Required stable PR profile':questions.filter(q=>q.checks.includes(name)||q.evidence.some(e=>e.check===name)).map(q=>q.description).join('; ')||'Explicit retained-state contract'])),rationale:'Required protection plus explicitly bound acceptance evidence'};
}
export function questionEvidencePassed(question,checks,items){
 return question.checks.every(name=>checks.some(c=>c.name===name&&c.status==='passed'))&&question.evidence.every(binding=>{
  const check=checks.find(c=>c.name===binding.check&&c.status==='passed');if(!check)return false;
  if(binding.check==='PR gate')return true; // validatePlan verifies these catalog requirements, exact profile verification remains mandatory.
  if(binding.check==='Boundary E2E')return binding.files.every(f=>check.provenance?.argv?.includes(f));
  return binding.workflows.every(title=>items.some(i=>i.status==='passed'&&i.title?.split(' / ').at(-1)===title));
 });
}
export async function defaultLocalPlan(cwd) {
  const custom=await readJSON(path.join(cwd,'validation-plan.json'),null);
  return custom??{version:3,questions:[]};
}
