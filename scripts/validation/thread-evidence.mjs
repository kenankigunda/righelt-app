import {mkdir,writeFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {publicRun} from './model.mjs';

const text=value=>String(value??'unknown').replace(/[\\`*_{}\[\]<>|!#]/g,'\\$&').replace(/[\r\n]+/g,' ');
const target=value=>`<${value.replaceAll('%','%25').replaceAll('>','%3E').replaceAll('<','%3C').replaceAll('\n','%0A')}>`;

// Use the same allowlisted evidence as the local viewer; never serialize private run state.
export async function renderThreadEvidence(run,site){
 site=path.resolve(site);
 await mkdir(site,{recursive:true});
 const root=await realpath(site),data=publicRun(run);
 const lines=[`# Validation evidence: ${text(data.id)}`,'',
  'Evidence is local. Publishing is paused unless explicitly resumed in the shared settings.', '',
  `Candidate: ${text(data.revision)}. Base: ${text(data.base)}.`,
  `Harness: ${text(data.harnessRevision)}. Working-tree fingerprint: ${text(data.fingerprint)}.`, '',
  `[Full local report](${target(path.join(site,'index.html'))})`, '',
  'This summary does not grant merge or deployment authorization.'];
 for(const pr of data.prs){
  lines.push('',`- PR #${pr.number}: ${text(pr.title)} — ${text(pr.readiness)}. Revision: ${text(pr.head)}. Authorization: ${text(pr.authorization??'not recorded')}.`);
  for(const waiting of pr.waiting)lines.push(`  - Waiting: ${text(waiting)}`);
 }
 for(const stage of data.stages){
  lines.push('',`## ${text(stage.title??stage.id)}: ${text(stage.status)}`,'',
   `Revision: ${text(stage.head)}. Base: ${text(stage.base)}. Screenshot inspection: ${stage.visualReviewed===true?'recorded':stage.visualRequired===false?'not required':'pending'}.`,'');
  for(const check of stage.checks){
   lines.push(`- ${text(check.name)}: ${text(check.status)}${check.reused?' (reused evidence)':''}${check.reason?` — ${text(check.reason)}`:''}.`);
   if(check.reused&&check.source)lines.push(`  - Provenance: ${text(JSON.stringify(check.source))}`);
  }
  for(const gap of stage.unmapped)lines.push(`- Coverage gap: ${text(gap)}`);
  for(const item of stage.items){
   lines.push('',`- ${text(item.title??item.id)}: ${text(item.status)}.`);
   for(const behavior of item.behaviors)lines.push(`  - ${text(behavior.label)}${behavior.checkpoint?`: ${text(behavior.checkpoint)}`:''}`);
   for(const assertion of item.assertions)lines.push(`  - ${text(assertion)}`);
   for(const finding of item.findings)lines.push(`  - Finding: ${text(finding)}`);
  }
  // Show failures first, then one image per behavior/viewport before additional views.
  const candidates=stage.items.flatMap(item=>item.images.map(image=>({item,image})));
  candidates.sort((a,b)=>Number(b.item.status==='failed')-Number(a.item.status==='failed'));
  const groups=new Set(),selected=[],extras=[];
  for(const entry of candidates){const key=`${entry.item.id}:${entry.image.viewport??entry.item.viewport}`;if(groups.has(key))extras.push(entry);else{groups.add(key);selected.push(entry);}}
  const chosen=[...selected,...extras].slice(0,8);
  lines.push('',`Screenshots: ${chosen.length} selected from ${candidates.length}; the full local report retains all report evidence.`);
  for(const {item,image} of chosen){
   lines.push('',`### ${text(item.title??item.id)} (${text(image.viewport??item.viewport)})`,'',`${text(image.caption??image.checkpoint??item.title)}. Result: ${text(item.status)}.`);
   for(const assertion of item.assertions)lines.push(`- ${text(assertion)}`);
   for(const finding of item.findings)lines.push(`- Finding: ${text(finding)}`);
   try{
    if(typeof image.src!=='string'||path.isAbsolute(image.src))throw Error('invalid source');
    const file=await realpath(path.resolve(site,image.src));
    if(!file.startsWith(root+path.sep)||!(await stat(file)).isFile())throw Error('outside report');
    lines.push('',`![${text(image.caption??item.title??'Screenshot')}](${target(file)})`);
   }catch{lines.push('','Screenshot unavailable or outside the report directory; inspect the raw evidence before claiming visual review.');}
   if(image.digest)lines.push('',`Original digest: ${text(image.digest)}.`);
  }
 }
 for(const [label,values] of [['Findings',data.findings],['Risks',data.risks]])if(values.length)lines.push('',`## ${label}`,'',...values.map(v=>`- ${text(v)}`));
 if(data.history.length)lines.push('',`Historical attempts retained: ${data.history.length}. See the full local report; earlier failures are not overwritten by this summary.`);
 const file=path.join(path.dirname(site),'evidence.md');
 await writeFile(file,lines.join('\n')+'\n',{mode:0o600});
 return file;
}
