import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {command,saveJSON} from './io.mjs';
import {evidenceKey,fileDigest} from './reuse.mjs';

const SHA=/^[a-f0-9]{40}$/;
const supported={Typecheck:'typecheck',Generated:'check:web-engine-generated','Generated runtime':'check:web-engine-generated',Unit:'test:unit',Integration:'test:integration',E2E:'test:e2e',Auth:'test:e2e:auth','Auth E2E':'test:e2e:auth'};
const cleanLog=text=>text.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').replace(/^\uFEFF/,'').split(/\r?\n/).map(line=>line.replace(/^\d{4}-\d\d-\d\dT\S+\s+/,''));
export function checkoutCommit(log){
 const lines=cleanLog(log),commits=[];
 for(let i=0;i<lines.length;i++)if(/^\[command\].*\/git log -1 --format=%H$/.test(lines[i])&&SHA.test(lines[i+1]?.trim()))commits.push(lines[i+1].trim());
 if(new Set(commits).size!==1)throw Error('Actual checkout SHA is missing or ambiguous');return commits[0];
}
// Deliberately supports this repository's indented workflow, not arbitrary YAML or shell programs.
export function workflowJobs(text){
 const section=text.split(/^jobs:\s*$/m)[1];if(!section||!/^\s*\n  [a-z][a-z0-9-]*:\n/.test(section))throw Error('Workflow jobs must begin with a job mapping');
 const jobs=[];const blocks=section.matchAll(/^  ([a-z][a-z0-9-]*):\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:\n|$(?![\s\S]))/gm);
 for(const [,id,body] of blocks){
  const name=/^    name: (.+)$/m.exec(body)?.[1],runner=/^    runs-on: (.+)$/m.exec(body)?.[1];if(!name||!runner)continue;
  const steps=[];
  for(const [,stepName,stepBody] of body.matchAll(/^      - name: (.+)\n([\s\S]*?)(?=^      - name: |$(?![\s\S]))/gm)){
   const run=/^        run: (.+)$/m.exec(stepBody)?.[1];let commands=[];
   if(run==='|')commands=[...stepBody.matchAll(/^          (.+)$/gm)].map(match=>match[1]).filter(line=>!/^\w+: /.test(line));
   else if(run)commands=[run];
   steps.push({name:stepName,commands,body:stepBody});
  }
  jobs.push({id,name,runner,nodeMajor:/node-version: ["']?(\d+)/.exec(body)?.[1],pnpmMajor:/corepack prepare pnpm@(\d+) --activate/.exec(body)?.[1],steps,body});
 }
 return jobs;
}
function normalizeTestCommand(value){return value.replace(/ -- --reporter spec --reporter junit --reporter-destination stdout --reporter-destination [\w/.-]+\.xml$/,'');}
function requiredCommands(argv,pkg,seen=new Set()){
 if(!Array.isArray(argv)||argv.some(v=>typeof v!=='string')||argv.length!==2||argv[0]!=='pnpm')throw Error('Unsupported local command');
 const script=argv[1];if(!pkg.scripts?.[script])throw Error(`Unknown package script ${script}`);
 if(!['test:unit','test:integration'].includes(script))return [argv.join(' ')];
 if(seen.has(script))throw Error('Cyclic command chain');seen.add(script);
 return pkg.scripts[script].split(' && ').flatMap(part=>{
  const m=/^pnpm ([\w:-]+)$/.exec(part);return m?requiredCommands(['pnpm',m[1]],pkg,new Set(seen)):[part];
 });
}
function environment(job,log){
 const lines=cleanLog(log);const version=lines.find(line=>/^node: v\d+\./.test(line));
 if(!version||!version.startsWith(`node: v${job.nodeMajor}.`))throw Error('Actual Node version does not match workflow');
 if(!lines.some(line=>line.includes(`corepack prepare pnpm@${job.pnpmMajor} --activate`)))throw Error('pnpm setup not confirmed in log');
 const install=job.steps.flatMap(s=>s.commands).find(c=>c.startsWith('pnpm install '));
 const browser=job.steps.flatMap(s=>s.commands).find(c=>c.startsWith('pnpm exec playwright install --with-deps '));
 return {runner:job.runner,nodeMajor:job.nodeMajor,pnpmMajor:job.pnpmMajor,dependencyPolicy:install==='pnpm install --frozen-lockfile'?'frozen':install==='pnpm install --frozen-lockfile=false'?'manifest-compatible-unfrozen':'unsupported',browserInstall:browser?browser.slice('pnpm exec playwright install --with-deps '.length).split(' '):[]};
}
export async function importCI({repository,runId,cwd,outDir,expected,execute=command}){
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository)||!Number.isSafeInteger(Number(runId))||Number(runId)<1)throw Error('Invalid repository or run ID');
 await mkdir(outDir,{recursive:true,mode:0o700});
 const call=async argv=>(await execute(argv,{cwd})).output;
 const api=async endpoint=>JSON.parse(await call(['gh','api',`repos/${repository}/${endpoint}`]));
 const run=await api(`actions/runs/${runId}`);
 if(run.repository?.full_name!==repository||run.id!==Number(runId)||run.status!=='completed'||!['pull_request','push'].includes(run.event)||run.path!=='.github/workflows/ci.yml')throw Error('Run repository, state, event or workflow mismatch');
 const candidateTree=(await call(['git','rev-parse','HEAD^{tree}'])).trim();
 if(!SHA.test(candidateTree)||(await call(['git','status','--porcelain','--untracked-files=normal'])).trim())throw Error('Candidate must have a clean exact tree');
 const pkg=JSON.parse(await readFile(path.join(cwd,'package.json'),'utf8'));
 const workflowAtHead=await api(`contents/.github/workflows/ci.yml?ref=${run.head_sha}`);
 const workflow=Buffer.from(workflowAtHead.content??'','base64').toString('utf8');if(!workflow)throw Error('Workflow source unavailable');
 const definitions=workflowJobs(workflow);
 const jobsPage=await api(`actions/runs/${runId}/jobs?filter=latest&per_page=100`);
 if(jobsPage.total_count>100)throw Error('Unsupported job pagination');
 const artifactPage=await api(`actions/runs/${runId}/artifacts?per_page=100`);
 if(artifactPage.total_count>100)throw Error('Unsupported artifact pagination');
 const receipts={},rejected={},verified=new Map();
 async function verifyJob(def){
  if(verified.has(def.name))return verified.get(def.name);
  const matches=jobsPage.jobs.filter(job=>job.name===def.name);if(matches.length!==1)throw Error(`Missing or ambiguous job ${def.name}`);
  const job=matches[0];if(job.run_id!==Number(runId)||job.status!=='completed'||job.conclusion!=='success')throw Error(`Job ${def.name} is not successful`);
  if(!job.steps?.some(step=>step.name==='Checkout'&&step.conclusion==='success'))throw Error('Successful checkout step missing');
  const logPath=path.join(outDir,`job-${job.id}.log`);
  await execute(['gh','api',`repos/${repository}/actions/jobs/${job.id}/logs`,'--allow-escape-sequences'],{cwd,log:logPath,maxOutputBytes:1024});
  const log=await readFile(logPath,'utf8'),checkout=checkoutCommit(log);const commit=await api(`git/commits/${checkout}`);
  if(commit.sha!==checkout||commit.tree?.sha!==candidateTree)throw Error('Actual tested checkout tree differs from candidate');
  const testedWorkflow=await api(`contents/.github/workflows/ci.yml?ref=${checkout}`);
  if(Buffer.from(testedWorkflow.content??'','base64').toString('utf8')!==workflow)throw Error('Run-head and actual-checkout workflows differ');
  const localWorkflow=await readFile(path.join(cwd,'.github/workflows/ci.yml'),'utf8');if(localWorkflow!==workflow)throw Error('Candidate workflow differs');
  const attempt=job.run_attempt??run.run_attempt;
  const artifacts=artifactPage.artifacts.filter(a=>a.name===`ci-provenance-${def.id}-${attempt}`&&!a.expired);
  if(artifacts.length!==1)throw Error('Exact dependency/runtime provenance artifact unavailable');
  const artifact=artifacts[0];if(artifact.workflow_run?.id!==run.id||artifact.workflow_run?.head_sha!==run.head_sha)throw Error('Artifact run/head provenance mismatch');
  const archive=path.join(outDir,`provenance-${artifact.id}.zip`);
  await execute(['gh','api',`repos/${repository}/actions/artifacts/${artifact.id}/zip`],{cwd,log:archive,maxOutputBytes:1024,logStdoutOnly:true});
  const members=(await call(['unzip','-Z1',archive])).trim().split('\n');
  if(members.length!==1||members[0]!==`${def.id}.json`)throw Error('Unexpected provenance archive entries');
  const provenance=JSON.parse(await call(['unzip','-p',archive,members[0]]));
  if(provenance.version!==1||provenance.repository!==repository||provenance.runId!==run.id||provenance.attempt!==attempt||provenance.job!==def.id||provenance.checkout!==checkout||provenance.testedTree!==candidateTree)throw Error('Provenance artifact identity mismatch');
  const record={job,checkout,logPath,log,archive,provenance,environment:environment(def,log)};verified.set(def.name,record);return record;
 }
 for(const [name,request] of Object.entries(expected??{})){
  try{
   if(!supported[name]||JSON.stringify(request.argv)!==JSON.stringify(['pnpm',supported[name]]))throw Error('Unsupported named check or command');
   const commands=requiredCommands(request.argv,pkg);const evidence=[];
   for(const needed of commands){
    const alias=/^pnpm ([\w:-]+)$/.exec(needed);const alternatives=[needed,...(alias&&pkg.scripts[alias[1]]?[pkg.scripts[alias[1]]]:[])];
    const candidates=definitions.flatMap(def=>def.steps.flatMap(step=>step.commands.filter(c=>alternatives.includes(normalizeTestCommand(c))).map(actual=>({def,step,actual}))));
    if(candidates.length!==1)throw Error(`Missing or ambiguous workflow coverage for ${needed}`);
    const {def,step,actual}=candidates[0],record=await verifyJob(def);
    if(!record.job.steps.some(s=>s.name===step.name&&s.conclusion==='success'))throw Error(`Required step did not succeed: ${step.name}`);
    if(!cleanLog(record.log).some(line=>line===actual||line===`##[group]Run ${actual}`||normalizeTestCommand(line.replace(/^##\[group\]Run /,''))===normalizeTestCommand(actual)))throw Error(`Executed command not found in primary log: ${needed}`);
    // Cross-platform reuse is never inferred. Caller must explicitly request the actual CI environment.
    const requestedEnvironment=request.environments?.[def.name]??request.environment;
    if(!requestedEnvironment||evidenceKey(record.environment)!==evidenceKey(requestedEnvironment))throw Error(`Explicit environment mismatch for ${def.name}`);
    if(record.environment.dependencyPolicy==='unsupported')throw Error('Unsupported dependency installation policy');
    if(!request.dependencies||evidenceKey(record.provenance.dependencies)!==evidenceKey(request.dependencies))throw Error('Actual resolved dependencies differ or expected identity missing');
    if(!request.runtime||evidenceKey(record.provenance.runtime)!==evidenceKey(request.runtime))throw Error('Actual browser/runtime identity differs or expected identity missing');
    evidence.push({jobId:record.job.id,jobName:def.name,checkout:record.checkout,command:needed,environment:record.environment,log:record.logPath,logHash:await fileDigest(record.logPath),provenance:record.provenance,archive:record.archive,archiveHash:await fileDigest(record.archive)});
   }
   const importedTime=Date.now(),importedAt=new Date(importedTime).toISOString(),expiresAt=new Date(importedTime+86400000).toISOString();
   const receipt={importedAt,expiresAt,status:'passed',name,source:'github-actions',repository,runId:Number(runId),runAttempt:run.run_attempt,runHead:run.head_sha,testedTree:candidateTree,argv:request.argv,evidence,limitations:[]};
   receipt.integrity=evidenceKey(receipt);receipts[name]=receipt;
  }catch(error){rejected[name]=error.message;}
 }
 const result={run:{id:run.id,head:run.head_sha,attempt:run.run_attempt},receipts,rejected};await saveJSON(path.join(outDir,'ci-import.json'),result);return result;
}

// This verifies previously imported evidence; it never grants merge authority.
export async function loadCIReceipt(file,{name,argv,tree,now=Date.now()}){
 try{
  if(!Number.isFinite(now)||!SHA.test(tree))return null;
  const document=JSON.parse(await readFile(file,'utf8'));const receipt=document.receipts?.[name]??document;
  const {integrity,...body}=receipt;
  const imported=Date.parse(receipt.importedAt),expiry=Date.parse(receipt.expiresAt);
  if(integrity!==evidenceKey(body)||receipt.status!=='passed'||receipt.source!=='github-actions'||receipt.name!==name||receipt.testedTree!==tree||JSON.stringify(receipt.argv)!==JSON.stringify(argv)||!Number.isFinite(imported)||!Number.isFinite(expiry)||imported>now||expiry<=now||expiry<=imported||expiry-imported>86400000||!Array.isArray(receipt.evidence)||!receipt.evidence.length)return null;
  for(const evidence of receipt.evidence){
   if(!evidence.provenance||evidence.provenance.testedTree!==tree||evidence.provenance.checkout!==evidence.checkout||await fileDigest(evidence.log)!==evidence.logHash||await fileDigest(evidence.archive)!==evidence.archiveHash)return null;
  }
  return receipt;
 }catch{return null;}
}
