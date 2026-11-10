import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const registry=JSON.parse(await readFile(new URL('./ci-layout-profiles.json',import.meta.url),'utf8'));
// Installed policy owns these fixed records. Candidate JavaScript is never imported.
export async function expectedCILayout(cwd,id='guest-2-v1') {
 if(id==='auto'){
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const catalog=digest(await readFile(path.join(cwd,'scripts/testing/catalog.mjs'))),workflow=digest(await readFile(path.join(cwd,'.github/workflows/ci.yml')));
  const matches=registry.profiles.filter(p=>p.catalogSourceSHA256===catalog&&p.workflowSourceSHA256===workflow);
  if(matches.length!==1)throw Error('Candidate does not match one pinned CI layout; unknown workflow cannot earn reuse credit');
  return structuredClone(matches[0]);
 }
 const profile=registry.profiles.find(p=>p.id===id);
 if(!profile)throw Error('Unknown expected CI layout');
 const source=await readFile(path.join(cwd,'scripts/testing/catalog.mjs'));
 if(createHash('sha256').update(source).digest('hex')!==profile.catalogSourceSHA256)
  throw Error('Candidate catalog source differs from expected CI layout');
 const workflow=await readFile(path.join(cwd,'.github/workflows/ci.yml'));
 if(createHash('sha256').update(workflow).digest('hex')!==profile.workflowSourceSHA256)
  throw Error('Candidate workflow source differs from expected CI layout');
 return structuredClone(profile);
}
