import path from 'node:path';
import {readJSON} from './io.mjs';

export const CHECKS = ['Typecheck','Generated runtime','Unit','Integration','E2E','Auth E2E','Responsive proof','Account responsive proof','Report viewer'];
export function validatePlan(spec) {
  if (spec.version !== 2) throw Error('Bounded validation requires manifest version 2');
  if (!Array.isArray(spec.questions) || !spec.questions.length) throw Error('Map release questions before validation');
  const ids = new Set();
  for (const q of spec.questions) {
    if (!q.id || ids.has(q.id) || !q.description || !Array.isArray(q.paths) || !q.paths.length || !Array.isArray(q.checks) || !q.checks.length || q.checks.some(c=>!CHECKS.includes(c))) throw Error('Each unique release question needs description, paths and known checks');
    if(q.boundaryChecks&&(!Array.isArray(q.boundaryChecks)||q.boundaryChecks.some(c=>!CHECKS.includes(c))))throw Error('Unknown boundary check');
    ids.add(q.id);
  }
  if (spec.lanes !== undefined && ![1,2].includes(spec.lanes)) throw Error('Use one or two isolated lanes');
  if (spec.visual?.viewports?.some(v=>!['mobile','mid-wide','full-wide'].includes(v))) throw Error('Unknown visual viewport');
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
  const final=index===(spec.prs?.length??0), phase=index===0&&!final?'baseline':final?'final':'boundary';
  const coverage=questionsForFiles(spec,changed);
  if(final)coverage.questions=spec.questions;
  const reportChanged=spec.validateReportViewer===true||changed.some(f=>/^scripts\/validation\/(?:assets\/|report\.mjs|model\.mjs|test\/report-browser\.mjs)/.test(f));
  const visualMode=final?'walkthrough':'none';
  const tests=phase==='boundary'?(spec.prs?.[index-1]?.tests??[]):[];
  const boundaryChecks=[...new Set(coverage.questions.flatMap(q=>q.boundaryChecks??[]))];
  if(phase==='boundary'&&coverage.questions.length&&!tests.length&&!boundaryChecks.length)coverage.unmapped.push('Explicit boundary tests or boundaryChecks are required for changed release questions');
  return {version:2,phase,visualMode,lanes:spec.lanes??2,questions:coverage.questions,unmapped:coverage.unmapped,
    tests,coverageViewports:['mobile','mid-wide','full-wide'],viewports:spec.visual?.viewports??['mobile','mid-wide'],checkpoints:spec.visual?.checkpoints,
    selected:phase==='final'?CHECKS.filter(c=>(accounts||!['Auth E2E','Account responsive proof'].includes(c))&&(c!=='Report viewer'||reportChanged)):
      [...new Set(['Typecheck','Generated runtime',...boundaryChecks,...(tests.length?['Boundary E2E']:[]),'Responsive proof',...(accounts?['Account responsive proof']:[])])],
    rationale:spec.prs?.[index-1]?.rationale??(final?'Broad final candidate and retained continuity':'Focused boundary and continuity; broad proof belongs to final candidate')};
}
export async function defaultLocalPlan(cwd) {
  const custom=await readJSON(path.join(cwd,'validation-plan.json'),null);
  return custom??{version:2,lanes:2,questions:[{id:'changed-behavior',description:'Changed product behavior and adjacent regression contracts',paths:['apps/','packages/','db/','e2e/'],checks:['Unit','Integration','E2E','Responsive proof']}]};
}
